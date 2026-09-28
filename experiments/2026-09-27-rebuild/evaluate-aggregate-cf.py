"""Test a low-variance neighbor signal before adding it to the product."""
import json
import subprocess
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
snapshot = json.loads((ROOT / "../2026-09-27/snapshot.json").read_text(encoding="utf-8"))
pilot = json.loads((ROOT / "data/peers.json").read_text(encoding="utf-8"))
own = [row for row in snapshot["collections"]["2"] if row["rate"] > 0]
peers = [dict(row["rated"]) for row in pilot["peers"].values()]
ids = np.array([row["subjectId"] for row in own])
site = np.array([row["subject"]["rating"]["score"] or 6.8 for row in own])
truth = np.array([row["rate"] for row in own], dtype=float)
folds = np.array(json.loads(subprocess.check_output(["node", str(ROOT / "family-folds.cjs")], text=True)))
frequency = Counter(tag.casefold() for row in own for tag in set(row["subject"]["tags"]))
vocabulary = [tag for tag, count in frequency.most_common() if count >= 8][:200]
columns = {tag: index for index, tag in enumerate(vocabulary)}
content = np.zeros((len(own), len(vocabulary) + 1))
for index, row in enumerate(own):
    for tag in set(row["subject"]["tags"]):
        if tag.casefold() in columns:
            content[index, columns[tag.casefold()]] = 1
    year = str(row["subject"].get("date", ""))[:4]
    if year.isdigit():
        content[index, -1] = (int(year) - 2000) / 20


def ndcg(y, predictions, count=20):
    def dcg(order):
        values = y[order[:count]]
        return float(np.sum((2 ** values - 1) / np.log2(np.arange(len(values)) + 2)))
    return dcg(np.argsort(-predictions)) / dcg(np.argsort(-y))


def signal(train, shrink=50, positive_only=True):
    own_bias = np.mean(truth[train] - site[train])
    weighted = np.zeros(len(own))
    support = np.zeros(len(own))
    for peer in peers:
        paired = np.array([index for index in train if ids[index] in peer], dtype=int)
        if len(paired) < 12:
            continue
        peer_bias = np.mean([peer[ids[index]] - site[index] for index in paired])
        peer_residual = np.array([peer[ids[index]] - site[index] - peer_bias for index in paired])
        own_residual = truth[paired] - site[paired] - own_bias
        correlation = np.corrcoef(peer_residual, own_residual)[0, 1]
        if not np.isfinite(correlation):
            continue
        if positive_only and correlation <= 0:
            continue
        weight = correlation * len(paired) / (len(paired) + shrink)
        for index, item_id in enumerate(ids):
            if item_id in peer:
                weighted[index] += weight * (peer[item_id] - site[index] - peer_bias)
                support[index] += abs(weight)
    return weighted / np.maximum(support, 1)


for shrink in [20, 50, 100]:
    for positive_only in [True, False]:
        for alpha in [10, 30, 100]:
            mae, ranking = [], []
            for fold in range(5):
                train = np.flatnonzero(folds != fold)
                test = np.flatnonzero(folds == fold)
                x = np.column_stack((content, signal(train, shrink, positive_only)))
                bias = np.mean(truth[train] - site[train])
                weights = np.linalg.solve(x[train].T @ x[train] + alpha * np.eye(x.shape[1]),
                                          x[train].T @ (truth[train] - site[train] - bias))
                prediction = np.clip(site[test] + bias + x[test] @ weights, 1, 10)
                mae.append(np.mean(np.abs(prediction - truth[test])))
                ranking.append(ndcg(truth[test], prediction))
            print(shrink, positive_only, alpha, round(float(np.mean(mae)), 4), round(float(np.mean(ranking)), 4))
