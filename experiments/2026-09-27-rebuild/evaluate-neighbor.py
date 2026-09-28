"""Check whether a small positive-neighbor cohort helps ranking and recall."""

import json
import subprocess
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
data_path = ROOT / "scripts/.cache/recommendations-input.json"
data = json.loads(data_path.read_text(encoding="utf-8"))
own = [row for row in data["own"] if row["rate"] > 0]
peers = [dict(peer["rated"]) for peer in data["peers"]]
ids = np.array([int(row.get("subject_id") or row.get("subjectId")) for row in own])
truth = np.array([float(row["rate"]) for row in own])
site = np.array([float(row["subject"]["rating"]["score"]) or 6.8 for row in own])
folds = np.array(json.loads(subprocess.check_output(
    ["node", str(ROOT / "scripts/family-folds.cjs"), str(data_path)], text=True
)))
generic = {"日本", "动画", "動畫", "anime", "アニメ", "tv", "补番", "補番"}


def tags(subject):
    return {str(tag).strip().casefold() for tag in subject.get("tags", [])}


frequency = Counter(tag for row in own for tag in tags(row["subject"]) if tag not in generic)
vocabulary = [tag for tag, count in sorted(frequency.items(), key=lambda item: (-item[1], item[0])) if count >= 8][:200]
columns = {tag: index for index, tag in enumerate(vocabulary)}
content = np.zeros((len(own), len(vocabulary) + 1))
for index, row in enumerate(own):
    for tag in tags(row["subject"]):
        if tag in columns:
            content[index, columns[tag]] = 1
    year = str(row["subject"].get("date") or "")[:4]
    if year.isdigit():
        content[index, -1] = (int(year) - 2000) / 20


def ndcg(actual, predicted, count=20):
    def dcg(order):
        values = actual[order[:count]]
        return float(np.sum((2 ** values - 1) / np.log2(np.arange(len(values)) + 2)))
    return dcg(np.argsort(-predicted)) / dcg(np.argsort(-actual))


def neighbors(train, shrink=50):
    bias = np.mean(truth[train] - site[train])
    ranked = []
    for peer in peers:
        overlap = np.array([index for index in train if int(ids[index]) in peer], dtype=int)
        if len(overlap) < 12:
            continue
        other = np.array([peer[int(ids[index])] for index in overlap]) - site[overlap]
        own_residual = truth[overlap] - site[overlap] - bias
        if np.std(other) < 0.01 or np.std(own_residual) < 0.01:
            continue
        correlation = np.corrcoef(other, own_residual)[0, 1]
        if np.isfinite(correlation) and correlation > 0:
            weight = correlation * len(overlap) / (len(overlap) + shrink)
            ranked.append((weight, peer, float(np.mean(other))))
    return sorted(ranked, key=lambda item: -item[0])


def signal(neighbor_rows, item_ids, site_scores):
    result = np.zeros(len(item_ids))
    support = np.zeros(len(item_ids))
    for weight, peer, bias in neighbor_rows:
        for index, item_id in enumerate(item_ids):
            if int(item_id) in peer:
                result[index] += weight * (peer[int(item_id)] - site_scores[index] - bias)
                support[index] += weight
    return result / np.maximum(support, 1)


metrics = {name: [] for name in ["baseline", "content10", "content30", "neighbor10", "neighbor30", "neighbor100"]}
recalls = []
for fold in range(5):
    train, test = np.flatnonzero(folds != fold), np.flatnonzero(folds == fold)
    ranked = neighbors(train)
    selected = ranked[:40]
    pool = set().union(*(set(peer) for _, peer, _ in selected)) if selected else set()
    liked_pool = set().union(*(set(item_id for item_id, rating in peer.items() if rating >= 8)
                               for _, peer, _ in selected)) if selected else set()
    positive = test[truth[test] >= 8]
    random_pool = set().union(*(set(peer) for peer in peers[:40]))
    recalls.append((len(selected), sum(int(ids[index]) in pool for index in test) / len(test),
                    sum(int(ids[index]) in pool for index in positive) / len(positive),
                    sum(int(ids[index]) in random_pool for index in test) / len(test),
                    sum(int(ids[index]) in random_pool for index in positive) / len(positive),
                    sum(int(ids[index]) in liked_pool for index in test) / len(test),
                    sum(int(ids[index]) in liked_pool for index in positive) / len(positive)))
    neighbor_column = signal(selected, ids, site)
    bias = np.mean(truth[train] - site[train])
    for name in metrics:
        if name == "baseline":
            prediction = np.clip(site[test] + bias, 1, 10)
        else:
            alpha = int(name.removeprefix("content").removeprefix("neighbor"))
            features = content if name.startswith("content") else np.column_stack((content, neighbor_column))
            weights = np.linalg.solve(features[train].T @ features[train] + alpha * np.eye(features.shape[1]),
                                      features[train].T @ (truth[train] - site[train] - bias))
            prediction = np.clip(site[test] + bias + features[test] @ weights, 1, 10)
        metrics[name].append((np.mean(np.abs(prediction - truth[test])), ndcg(truth[test], prediction)))

print("recalls", recalls)
full_neighbors = neighbors(np.arange(len(own)))[:40]
print("full_neighbors", len(full_neighbors), "candidate_pool", len(set().union(*(set(peer) for _, peer, _ in full_neighbors)) - set(ids)))
print("liked_candidate_pool", len(set().union(*(set(item_id for item_id, rating in peer.items() if rating >= 8)
                                               for _, peer, _ in full_neighbors)) - set(ids)))
for name, values in metrics.items():
    print(name, round(float(np.mean([value[0] for value in values])), 4),
          round(float(np.mean([value[1] for value in values])), 4),
          "folds", [round(value[1], 4) for value in values])
