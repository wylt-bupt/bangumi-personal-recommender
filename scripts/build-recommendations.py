"""Build a compact personal feed; never publish the input peer rating matrix."""

import argparse
import json
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "scripts/.cache/recommendations-input.json"
DEFAULT_OUTPUT = ROOT / "public/recommendations.json"


def identifier(row):
    return int(row.get("subjectId") or row.get("subject_id") or 0)


def tags(subject):
    return list(dict.fromkeys(
        str(tag.get("name") if isinstance(tag, dict) else tag).strip().casefold()
        for tag in subject.get("tags", [])
        if (tag.get("name") if isinstance(tag, dict) else tag)
    ))


GENERIC_TAGS = {"日本", "动画", "動畫", "anime", "アニメ", "tv", "补番", "補番"}


def meaningful_tag(tag):
    if tag in GENERIC_TAGS:
        return False
    return not re.match(r"^(?:19|20)\d{2}(?:年)?(?:[-./年](?:0?[1-9]|1[0-2])(?:月)?(?:番|新番)?)?$", tag)


def tag_key(tag):
    """Punctuation-normalized identity used to collapse tag spelling variants."""
    return re.sub(r"[\s_·]+", "", tag).casefold()


# Observed duplicates that differ beyond punctuation; map to one display form.
# Keys are `tag_key()`-normalized (spaces/underscores removed, casefolded).
TAG_DISPLAY = {
    "京都アニメーション": "京阿尼",
    "kyotoanimation": "京阿尼",
    "a-1pictures": "A-1 Pictures",
    "a1pictures": "A-1 Pictures",
    "cloverworks": "CloverWorks",
}


def display_tag(tag):
    return TAG_DISPLAY.get(tag_key(tag), tag)


def site_score(subject):
    """Bayesian site score: evidence scales with the number of actual raters.

    Bangumi exposes a legacy ``score`` even when ``total`` is zero (it need not
    come from a single live rating), and a few public notes can carry a 10.0 —
    so candidate scores shrink toward the site prior with the rater count.
    Shrinking ``own`` scores with the same estimator keeps the residual
    decomposition consistent between the training rows and the candidates.
    """
    rating = subject.get("rating") or {}
    total = int(rating.get("total") or 0)
    value = float(rating.get("score") or 0)
    prior, weight = 6.8, 10
    if value <= 0 or total <= 0:
        return prior
    return (value * total + prior * weight) / (total + weight)


def ndcg(truth, predicted, count=20):
    def dcg(indices):
        values = truth[indices[:count]]
        return float(np.sum((2 ** values - 1) / np.log2(np.arange(len(values)) + 2)))
    ideal = dcg(np.argsort(-truth))
    return dcg(np.argsort(-predicted)) / ideal if ideal else 0.0


def train_model(input_data):
    own = [row for row in input_data["own"] if int(row.get("rate") or 0) > 0 and identifier(row)]
    peers = [dict(peer["rated"]) for peer in input_data["peers"]]
    subjects = {int(key): value for key, value in input_data["subjects"].items()}
    own_ids = np.array([identifier(row) for row in own])
    truth = np.array([float(row["rate"]) for row in own])
    own_site = np.array([site_score(row["subject"]) for row in own])
    site_coverage = sum(float((row["subject"].get("rating") or {}).get("score") or 0) > 0 for row in own) / len(own)
    if site_coverage < 0.8:
        raise ValueError(f"Site-rating coverage {site_coverage:.1%} is too low; ranked metadata may be missing")
    # Rater counts feed the shrinkage estimator; a scoped sync that skips the
    # ranked-metadata enrichment leaves every count at zero and silently
    # flattens the score signal. Fail loudly instead.
    rater_coverage = sum(int((row["subject"].get("rating") or {}).get("total") or 0) > 0 for row in own) / len(own)
    if rater_coverage < 0.5:
        raise ValueError(f"Own rater-count coverage is {rater_coverage:.1%}; ranked metadata is missing")
    own_subjects = [row["subject"] for row in own]

    frequency = Counter(tag for subject in own_subjects for tag in set(tags(subject)) if meaningful_tag(tag))
    vocabulary = [tag for tag, count in sorted(frequency.items(), key=lambda item: (-item[1], item[0])) if count >= 8][:200]
    columns = {tag: index for index, tag in enumerate(vocabulary)}

    def content_matrix(subject_rows):
        matrix = np.zeros((len(subject_rows), len(vocabulary) + 1))
        for index, subject in enumerate(subject_rows):
            for tag in tags(subject):
                column = columns.get(tag)
                if column is not None:
                    matrix[index, column] = 1
            year = str(subject.get("date") or "")[:4]
            if year.isdigit():
                matrix[index, -1] = (int(year) - 2000) / 20
        return matrix

    own_content = content_matrix(own_subjects)
    folds = np.array(json.loads(subprocess.check_output(
        ["node", str(ROOT / "scripts/family-folds.cjs"), str(input_data["inputPath"])], text=True
    )))
    if len(folds) != len(own):
        raise ValueError("Series folds do not match the rated collection rows")

    def peer_matrix(train, item_ids, item_site):
        matrix = np.zeros((len(item_ids), len(peers)))
        own_bias = float(np.mean(truth[train] - own_site[train]))
        for column, peer in enumerate(peers):
            paired = [index for index in train if int(own_ids[index]) in peer]
            if len(paired) < 12:
                continue
            bias = float(np.mean([peer[int(own_ids[index])] - own_site[index] for index in paired]))
            for index, item_id in enumerate(item_ids):
                if int(item_id) in peer:
                    matrix[index, column] = peer[int(item_id)] - item_site[index] - bias
        return matrix

    def positive_neighbors(train):
        """Shrink overlap correlations and retain only the closest public raters."""
        own_residual = truth - own_site
        ranked = []
        for column, peer in enumerate(peers):
            overlap = np.array([index for index in train if int(own_ids[index]) in peer], dtype=int)
            if len(overlap) < 12:
                continue
            other_residual = np.array([peer[int(own_ids[index])] for index in overlap]) - own_site[overlap]
            personal_residual = own_residual[overlap]
            if np.std(other_residual) < 0.01 or np.std(personal_residual) < 0.01:
                continue
            correlation = float(np.corrcoef(other_residual, personal_residual)[0, 1])
            if np.isfinite(correlation) and correlation > 0:
                ranked.append((correlation * len(overlap) / (len(overlap) + 50), column))
        return sorted(ranked, reverse=True)[:40]

    def fit(train, test, model, alpha):
        bias = float(np.mean(truth[train] - own_site[train]))
        if model == "baseline":
            prediction = np.clip(own_site[test] + bias, 1, 10)
            return float(np.mean(np.abs(prediction - truth[test]))), ndcg(truth[test], prediction)
        content = own_content
        if model == "joint":
            features = np.column_stack((content, peer_matrix(train, own_ids, own_site)))
        else:
            features = content
        target = truth[train] - own_site[train] - bias
        weights = np.linalg.solve(features[train].T @ features[train] + alpha * np.eye(features.shape[1]), features[train].T @ target)
        prediction = np.clip(own_site[test] + bias + features[test] @ weights, 1, 10)
        return float(np.mean(np.abs(prediction - truth[test]))), ndcg(truth[test], prediction)

    results = {}
    retrieval = []
    for model, alpha in [("baseline", 0), ("content", 10), ("content", 30), ("joint", 20), ("joint", 100)]:
        values = []
        for fold in range(5):
            train = np.flatnonzero(folds != fold)
            test = np.flatnonzero(folds == fold)
            if model == "baseline":
                selected = positive_neighbors(train)
                pool = set(item_id for _, column in selected for item_id in peers[column])
                high = test[truth[test] >= 8]
                retrieval.append({
                    "all": sum(int(own_ids[index]) in pool for index in test) / len(test),
                    "high": sum(int(own_ids[index]) in pool for index in high) / len(high),
                })
            values.append(fit(train, test, model, alpha))
        results[(model, alpha)] = {
            "mae": float(np.mean([value[0] for value in values])),
            "ndcg20": float(np.mean([value[1] for value in values])),
            "folds": values,
        }

    content_key = max((("content", 10), ("content", 30)), key=lambda key: results[key]["ndcg20"])
    joint_key = max((("joint", 20), ("joint", 100)), key=lambda key: results[key]["ndcg20"])
    content_result = results[content_key]
    joint_result = results[joint_key]
    fold_wins = sum(joint[1] > content[1] for joint, content in zip(joint_result["folds"], content_result["folds"]))
    # Collaborative coefficients enter ranking only when their gain is visible
    # beyond the same content model and does not trade away rating accuracy.
    use_joint = (joint_result["ndcg20"] >= content_result["ndcg20"] + 0.005
                 and joint_result["mae"] <= content_result["mae"] + 0.005
                 and fold_wins >= 3)
    selected = joint_key if use_joint else content_key
    model, alpha = selected
    bias = float(np.mean(truth - own_site))
    neighbors = positive_neighbors(np.arange(len(own)))
    if len(neighbors) < 20:
        raise ValueError(f"Only {len(neighbors)} positively aligned public neighbors; preserving previous feed")
    candidate_ids = sorted(set(item_id for _, column in neighbors for item_id in peers[column])
                           - {identifier(row) for row in input_data["own"]})
    candidate_ids = [item_id for item_id in candidate_ids if item_id in subjects and int(subjects[item_id].get("type") or 2) == 2]
    eligibility = json.loads(subprocess.check_output(
        ["node", str(ROOT / "scripts/candidate-eligibility.cjs"), str(input_data["inputPath"])], text=True
    ))
    if eligibility.get("markedFranchiseCount", 0) < 10:
        raise ValueError(f"Only {eligibility.get('markedFranchiseCount', 0)} marked franchises; eligibility input is stale")
    excluded_by = Counter(eligibility["exclusions"].get(str(item_id), "") for item_id in candidate_ids)
    exclusion_stats = {key: int(excluded_by.get(key, 0)) for key in ("origin", "watchedFranchise")}
    candidate_ids = [item_id for item_id in candidate_ids if str(item_id) not in eligibility["exclusions"]]
    if len(candidate_ids) < 150:
        raise ValueError(f"Eligibility rules left only {len(candidate_ids)} candidates; refusing a thin feed")
    candidate_subjects = [subjects[item_id] for item_id in candidate_ids]
    candidate_site = np.array([site_score(subject) for subject in candidate_subjects])
    candidate_content = content_matrix(candidate_subjects)
    if model == "joint":
        own_features = np.column_stack((own_content, peer_matrix(np.arange(len(own)), own_ids, own_site)))
        candidate_peer = peer_matrix(np.arange(len(own)), candidate_ids, candidate_site)
        candidate_features = np.column_stack((candidate_content, candidate_peer))
    else:
        own_features = own_content
        candidate_peer = None
        candidate_features = candidate_content
    target = truth - own_site - bias
    weights = np.linalg.solve(own_features.T @ own_features + alpha * np.eye(own_features.shape[1]), own_features.T @ target)
    predictions = np.clip(candidate_site + bias + candidate_features @ weights, 1, 10)
    lift = candidate_peer @ weights[len(vocabulary) + 1:] if candidate_peer is not None else np.zeros(len(candidate_ids))

    rows = []
    citation_pool = [(row["subject"], int(row["rate"])) for row in own if int(row.get("rate") or 0) > 0]
    own_tagsets = [(subject, rate, {tag_key(display_tag(t)) for t in tags(subject) if meaningful_tag(t)})
                   for subject, rate in citation_pool]
    for index in np.argsort(-predictions):
        subject = candidate_subjects[index]
        title = subject.get("name_cn") or subject.get("nameCn") or subject.get("name")
        if not title:
            continue
        # Weights already express net preference over the site baseline for
        # each tag; dedupe spelling variants so one studio never explains the
        # same candidate twice, and pick the strongest two distinct markers.
        weight_by_key = {tag_key(display_tag(tag)): float(weights[columns[tag]]) for tag in tags(subject) if tag in columns}
        cand_display = {tag_key(display_tag(tag)): display_tag(tag) for tag in tags(subject) if meaningful_tag(tag)}
        cand_keys = set(cand_display)
        positive, seen_keys = [], set()
        for key in sorted(weight_by_key, key=lambda key: weight_by_key[key], reverse=True):
            if key in seen_keys:
                continue
            if weight_by_key[key] <= 0.03 or key not in cand_keys:
                continue
            seen_keys.add(key)
            positive.append(cand_display[key])
            if len(positive) == 2:
                break
        # The most personal explanation available: the public collection row
        # that shares the most weighted-interest tags with this candidate.
        best, best_score, best_shared = None, 0.0, []
        for own_subject, rate, keys in own_tagsets:
            shared = cand_keys & keys
            if not shared:
                continue
            score = sum(1.0 + (0.5 if weight_by_key.get(key, 0.0) > 0 else 0.0) for key in shared)
            if score > best_score or (score == best_score and best is not None and rate > best[1]):
                best, best_score, best_shared = (own_subject, rate), score, \
                    sorted(shared, key=lambda key: weight_by_key.get(key, 0.0), reverse=True)
        reasons = []
        if best is not None and best_score >= 4.0 and (best[0].get("name_cn") or best[0].get("name")):
            cited = [cand_display[key] for key in best_shared[:2] if key in cand_display]
            reasons.append(f"与你评过 {best[1]} 分的《{best[0].get('name_cn') or best[0].get('name')}》题材重合：{'、'.join(cited)}。")
        elif positive:
            reasons.append("你的评分显示，对“" + "、".join(positive) + "”相关作品通常比站内评价更偏爱。")
        if lift[index] > 0.05 and len(reasons) < 2:
            reasons.append("公开用户评分的协同信号提高了这部作品的排序。")
        if not reasons:
            reasons.append("来自与你观看轨迹最接近、评分倾向一致的公开用户的共同作品。")
        rating = subject.get("rating") or {}
        image = subject.get("image") or (subject.get("images") or {}).get("common") or (subject.get("images") or {}).get("medium") or ""
        rows.append({
            "subject": {
                "id": candidate_ids[index], "type": 2,
                "name": str(subject.get("name") or ""), "nameCn": str(subject.get("name_cn") or subject.get("nameCn") or ""),
                "image": image, "tags": tags(subject)[:12],
                "rating": {"score": float(rating.get("score") or 0), "total": int(rating.get("total") or 0)},
            },
            "predicted": round(float(predictions[index]), 3),
            "collaborativeLift": round(float(lift[index]), 3),
            "reasons": reasons,
        })
        if len(rows) >= 500:
            break
    if len(rows) < 100 or len(peers) < 60:
        raise ValueError(f"Insufficient feed coverage: {len(rows)} candidates from {len(peers)} peers")
    feed = {
        "schema": 1, "owner": "wylt", "generatedAt": datetime.now(timezone.utc).isoformat(),
        "peerCount": len(peers), "neighborCount": len(neighbors), "ratedCount": len(own), "model": model,
        "candidates": rows,
    }
    report = {
        "rated": len(own), "peers": len(peers), "positiveNeighbors": len(neighbors), "candidatePool": len(candidate_ids),
        "publishedCandidates": len(rows), "siteCoverage": round(site_coverage, 4),
        "selected": f"{model}:{alpha}", "jointFoldWins": fold_wins,
        "eligibilityExcluded": exclusion_stats, "markedFranchiseCount": eligibility["markedFranchiseCount"],
        "neighborHeldoutRecall": round(float(np.mean([row["all"] for row in retrieval])), 4),
        "neighborHeldoutHighRecall": round(float(np.mean([row["high"] for row in retrieval])), 4),
        "cv": {f"{name}:{regularization}": {key: round(value, 4) for key, value in result.items() if key != "folds"}
               for (name, regularization), result in results.items()},
    }
    return feed, report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8"))
    data["inputPath"] = str(args.input)
    feed, report = train_model(data)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(feed, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
