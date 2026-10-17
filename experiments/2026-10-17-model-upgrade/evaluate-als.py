"""Offline iALS matrix-factorization experiment, same series-fold protocol as
the production builder's CV. Implicit confidence scales with rating strength;
held-out own rows stay out of training and are ranked like the ridge CV.
This experiment does not decide anything by itself: a switch only happens if
iALS beats the ridge gates in the build CV, and the production builder keeps
its numpy-only stack (no new runtime dependency)."""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent


def identifier(row):
    return int(row.get("subjectId") or row.get("subject_id") or 0)


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def shrunk_site_score(subject):
    rating = subject.get("rating") or {}
    total = int(rating.get("total") or 0)
    value = float(rating.get("score") or 0)
    if value <= 0 or total <= 0:
        return 6.8
    return (value * total + 6.8 * 10) / (total + 10)


def build_inputs(data):
    own = [row for row in data["own"] if int(row.get("rate") or 0) > 0]
    own_ids = np.array([identifier(row) for row in own], dtype=np.int64)
    truth = np.array([int(row["rate"]) for row in own], dtype=np.float64)
    own_site = np.array([shrunk_site_score(row["subject"]) for row in own])
    peers = [dict(peer["rated"]) for peer in data.get("peers", [])]
    subjects = data["subjects"]
    return own, own_ids, truth, own_site, peers, subjects


def implicit_matrix(own_ids, truth, own, peers, subjects):
    """Users x items observed-rating matrix over the animation universe that
    any of them actually rated, plus the full ranked catalog for candidates."""
    item_ids = sorted({int(sid) for sid in subjects if (subjects[sid].get("type") or 2) == 2}
                      | {int(i) for i in own_ids}
                      | {int(i) for peer in peers for i in peer})
    item_index = {item_id: index for index, item_id in enumerate(item_ids)}
    rows = np.full((1 + len(peers), len(item_ids)), 0.0, dtype=np.float32)
    for index, item_id in enumerate(own_ids):
        rows[0, item_index[int(item_id)]] = float(truth[index])
    for column, peer in enumerate(peers):
        for item_id, rate in peer.items():
            cursor = item_index.get(int(item_id))
            if cursor is not None:
                rows[column + 1, cursor] = float(rate)
    # Held-out masking is applied later by zeroing that slice and remembering
    # the true values, so the fold protocol stays identical to the builder's.
    return item_index, rows


def ials(ratings, factors=32, alpha=40.0, reg=0.5, iterations=8):
    """Implicit ALS where confidence = 1 + alpha * rating. ratings[user, item]
    is 0 for unobserved. Returns user and item factor matrices."""
    confidence = 1.0 + alpha * ratings
    users = ratings.shape[0]
    items = ratings.shape[1]
    rng = np.random.default_rng(42)
    x = rng.normal(0, 0.1, (users, factors)).astype(np.float64)
    y = rng.normal(0, 0.1, (items, factors)).astype(np.float64)
    eye = np.eye(factors)
    observed = ratings > 0
    for _ in range(iterations):
        yty = y.T @ y
        # user step: G_u = Y^T Y + sum_obs alpha*r*y y^T ; b_u = sum_obs (1+ar) y
        for u in range(users):
            mask = observed[u]
            if not mask.any():
                x[u] = 0.0
                continue
            yobs = y[mask]
            w = confidence[u, mask] - 1.0
            g = yty + (yobs * w[:, None]).T @ yobs + reg * eye
            b = yobs.T @ confidence[u, mask]
            x[u] = np.linalg.solve(g, b)
        xtx = x.T @ x
        for i in range(items):
            mask = observed[:, i]
            if not mask.any():
                y[i] = 0.0
                continue
            xobs = x[mask]
            w = confidence[mask, i] - 1.0
            g = xtx + (xobs * w[:, None]).T @ xobs + reg * eye
            b = xobs.T @ confidence[mask, i]
            y[i] = np.linalg.solve(g, b)
    return x, y


def ndcg(truth, prediction, k=20):
    order = np.argsort(-prediction)
    gains = (2 ** truth[order[:k]] - 1) / 8.0
    ideal_order = np.argsort(-truth)[:k]
    ideal = (2 ** truth[ideal_order] - 1) / 8.0
    discount = 1.0 / np.log2(np.arange(2, k + 2))
    return float(np.sum(gains * discount) / max(np.sum(ideal * discount), 1e-9))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=str(ROOT / "scripts/.cache/recommendations-input.json"))
    parser.add_argument("--output", default=None)
    parser.add_argument("--variants", default="32:40:0.5,64:40:0.5,32:10:0.2,64:80:1.0")
    args = parser.parse_args()

    data = load(args.input)
    own, own_ids, truth, own_site, peers, subjects = build_inputs(data)
    folds = np.array(json.loads(subprocess.check_output(
        ["node", str(ROOT / "scripts/family-folds.cjs"), args.input], text=True)))
    item_index, ratings = implicit_matrix(own_ids, truth, own, peers, subjects)

    results = {}
    for spec in args.variants.split(","):
        factors, alpha, reg = (float(part) for part in spec.split(":"))
        fold_ndcg, hybrids = [], []
        for fold in range(5):
            user_ratings = ratings.copy()
            test = np.flatnonzero(folds == fold)
            held_positions = np.array([item_index[int(own_ids[index])] for index in test])
            user_ratings[0, held_positions] = 0.0  # mask held-out rows on the own user
            x, y = ials(user_ratings[0:1 + len(peers)], factors=int(factors), alpha=alpha, reg=reg)
            scores = x[0] @ y[held_positions].T
            fold_ndcg.append(ndcg(truth[test], scores))
            # hybrid keeps site evidence: site + bias standardized then fused
            site = own_site[test]
            fused = site + 1.2 * (scores - scores.mean()) / max(scores.std(), 1e-9)
            hybrids.append(ndcg(truth[test], fused))
        results[f"ials f={int(factors)} a={alpha:g} r={reg:g}"] = {
            "ndcg20": round(float(np.mean(fold_ndcg)), 4),
            "ndcg20_hybrid_site": round(float(np.mean(hybrids)), 4),
            "folds": [round(v, 4) for v in fold_ndcg],
        }

    report = {"peerCount": len(peers), "ratedOwn": len(own), "items": len(item_index), "variants": results}
    text = json.dumps(report, indent=2, ensure_ascii=False)
    print(text)
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
