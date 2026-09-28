"""Exploratory model comparison; all variants use the same target holdouts."""

import json
import os
import subprocess
from collections import Counter
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
snapshot = json.loads((ROOT / "../2026-09-27/snapshot.json").read_text(encoding="utf-8"))
pilot = json.loads((ROOT / "data/peers.json").read_text(encoding="utf-8"))
own = [row for row in snapshot["collections"]["2"] if row["rate"] > 0]
peers = [dict(peer["rated"]) for peer in pilot["peers"].values()]
selected_peer_limit = int(os.environ.get("BGM_PILOT_SELECT_PEERS", "0"))
tags = Counter(tag.casefold() for row in own for tag in set(row["subject"]["tags"]))
vocabulary = [tag for tag, frequency in tags.most_common() if frequency >= 8][:200]
tag_columns = {tag: index for index, tag in enumerate(vocabulary)}
tag_matrix = np.zeros((len(own), len(vocabulary) + 1))
for row_index, row in enumerate(own):
    for tag in set(row["subject"]["tags"]):
        column = tag_columns.get(tag.casefold())
        if column is not None:
            tag_matrix[row_index, column] = 1
    year = str(row["subject"].get("date", ""))[:4]
    if year.isdigit():
        tag_matrix[row_index, -1] = (int(year) - 2000) / 20

ids = np.array([row["subjectId"] for row in own])
site = np.array([row["subject"]["rating"]["score"] or 6.8 for row in own], dtype=float)
truth = np.array([row["rate"] for row in own], dtype=float)
folds = np.array(json.loads(subprocess.check_output(["node", str(ROOT / "family-folds.cjs")], text=True)))


def ndcg(true_values, predictions, size=20):
    def dcg(order):
        values = true_values[order[:size]]
        return float(np.sum((2 ** values - 1) / np.log2(np.arange(len(values)) + 2)))

    ideal = dcg(np.argsort(-true_values))
    return dcg(np.argsort(-predictions)) / ideal if ideal else 0.0


def peer_matrix(train_indexes):
    matrix = np.zeros((len(own), len(peers)))
    peer_scores = []
    own_bias = float(np.mean(truth[train_indexes] - site[train_indexes]))
    for column, peer in enumerate(peers):
        paired = np.array([index for index in train_indexes if ids[index] in peer], dtype=int)
        if len(paired) < 12:
            continue
        bias = np.mean([peer[ids[index]] - site[index] for index in paired])
        peer_signal = np.array([peer[ids[index]] - site[index] - bias for index in paired])
        own_signal = truth[paired] - site[paired] - own_bias
        correlation = np.corrcoef(peer_signal, own_signal)[0, 1]
        if np.isfinite(correlation):
            peer_scores.append((abs(correlation) * len(paired) / (len(paired) + 20), column))
        for index in range(len(own)):
            if ids[index] in peer:
                matrix[index, column] = peer[ids[index]] - site[index] - bias
    if selected_peer_limit > 0:
        keep = {column for _, column in sorted(peer_scores, reverse=True)[:selected_peer_limit]}
        for column in range(len(peers)):
            if column not in keep:
                matrix[:, column] = 0
    return matrix


def fit(train, test, features, alpha):
    bias = float(np.mean(truth[train] - site[train]))
    target = truth[train] - site[train] - bias
    columns = features.shape[1]
    weights = np.linalg.solve(features[train].T @ features[train] + alpha * np.eye(columns), features[train].T @ target)
    prediction = np.clip(site[test] + bias + features[test] @ weights, 1, 10)
    baseline = np.clip(site[test] + bias, 1, 10)
    residual = features[test] @ weights
    actual_residual = truth[test] - site[test] - bias
    corr = np.corrcoef(residual, actual_residual)[0, 1]
    return {
        "mae": float(np.mean(np.abs(prediction - truth[test]))),
        "ndcg20": ndcg(truth[test], prediction),
        "baseline_mae": float(np.mean(np.abs(baseline - truth[test]))),
        "baseline_ndcg20": ndcg(truth[test], baseline),
        "residual_corr": float(corr) if np.isfinite(corr) else 0,
    }


if __name__ == "__main__":
    report = {"peers": len(peers), "selected_peer_limit": selected_peer_limit,
              "tag_features": len(vocabulary) + 1, "models": {}}
    paired = {}
    for name, alpha in [("tags", 10), ("tags", 30), ("peers", 20), ("peers", 100),
                        ("joint", 20), ("joint", 100)]:
        fold_results = []
        for fold in range(5):
            train = np.flatnonzero(folds != fold)
            test = np.flatnonzero(folds == fold)
            if name == "tags":
                features = tag_matrix
            elif name == "peers":
                features = peer_matrix(train)
            else:
                features = np.column_stack((tag_matrix, peer_matrix(train)))
            fold_results.append(fit(train, test, features, alpha))
        report["models"][f"{name}:{alpha}"] = {
            key: round(float(np.mean([result[key] for result in fold_results])), 4)
            for key in fold_results[0]
        }
        paired[f"{name}:{alpha}"] = fold_results
    if "joint:20" in paired and "tags:10" in paired:
        differences = [joint["ndcg20"] - tags["ndcg20"]
                       for joint, tags in zip(paired["joint:20"], paired["tags:10"])]
        report["joint20_vs_tags10"] = {
            "ndcg20_fold_differences": [round(value, 4) for value in differences],
            "positive_folds": sum(value > 0 for value in differences),
        }
    print(json.dumps(report, indent=2))
