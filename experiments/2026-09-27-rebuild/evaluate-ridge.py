"""Five-fold diagnostic for a regularized, per-user collaborative residual model."""

import json
import subprocess
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
snapshot = json.loads((ROOT / "../2026-09-27/snapshot.json").read_text(encoding="utf-8"))
pilot = json.loads((ROOT / "data/peers.json").read_text(encoding="utf-8"))
details = json.loads((ROOT / "../2026-09-27/rating-details.json").read_text(encoding="utf-8"))["subjects"]
own = [row for row in snapshot["collections"]["2"] if row["rate"] > 0]
peers = [dict(peer["rated"]) for peer in pilot["peers"].values()]
vote_counts = np.array([details.get(str(row["subjectId"]), {}).get("rating", {}).get("total", 0) for row in own])
quartiles = np.quantile(vote_counts[vote_counts > 0], [0.25, 0.75])


def ndcg(truth, prediction, size=20):
    def dcg(order):
        values = truth[order[:size]]
        return float(np.sum((np.power(2.0, values) - 1.0) / np.log2(np.arange(len(values)) + 2)))

    ideal = dcg(np.argsort(-truth))
    return dcg(np.argsort(-prediction)) / ideal if ideal else 0.0


def fit_predict(train, test, shrinkage):
    train_rows = [own[index] for index in train]
    test_rows = [own[index] for index in test]
    train_site = np.array([row["subject"]["rating"]["score"] or 6.8 for row in train_rows])
    test_site = np.array([row["subject"]["rating"]["score"] or 6.8 for row in test_rows])
    train_truth = np.array([row["rate"] for row in train_rows], dtype=float)
    test_truth = np.array([row["rate"] for row in test_rows], dtype=float)
    own_bias = float(np.mean(train_truth - train_site))
    train_x = np.zeros((len(train), len(peers)))
    test_x = np.zeros((len(test), len(peers)))
    for column, peer in enumerate(peers):
        indexes = [index for index, row in enumerate(train_rows) if row["subjectId"] in peer]
        if len(indexes) < 12:
            continue
        peer_bias = float(np.mean([peer[train_rows[index]["subjectId"]] - train_site[index] for index in indexes]))
        for index, row in enumerate(train_rows):
            rating = peer.get(row["subjectId"])
            if rating is not None:
                train_x[index, column] = rating - train_site[index] - peer_bias
        for index, row in enumerate(test_rows):
            rating = peer.get(row["subjectId"])
            if rating is not None:
                test_x[index, column] = rating - test_site[index] - peer_bias
    target = train_truth - train_site - own_bias
    gram = train_x.T @ train_x + shrinkage * np.eye(len(peers))
    coefficients = np.linalg.solve(gram, train_x.T @ target)
    prediction = np.clip(test_site + own_bias + test_x @ coefficients, 1, 10)
    baseline = np.clip(test_site + own_bias, 1, 10)
    test_votes = vote_counts[test]
    low = (test_votes > 0) & (test_votes <= quartiles[0])
    high = test_votes >= quartiles[1]
    covered = np.any(test_x != 0, axis=1)
    true_residual = test_truth - test_site - own_bias
    predicted_residual = test_x @ coefficients
    residual_corr = float(np.corrcoef(true_residual[covered], predicted_residual[covered])[0, 1]) if np.sum(covered) > 2 else 0
    return {
        "mae": float(np.mean(np.abs(prediction - test_truth))),
        "baseline_mae": float(np.mean(np.abs(baseline - test_truth))),
        "ndcg20": ndcg(test_truth, prediction),
        "baseline_ndcg20": ndcg(test_truth, baseline),
        "nonzero_fraction": float(np.mean(np.any(test_x != 0, axis=1))),
        "residual_correlation": residual_corr if np.isfinite(residual_corr) else 0,
        "low_mae": float(np.mean(np.abs(prediction[low] - test_truth[low]))) if np.any(low) else 0,
        "low_baseline_mae": float(np.mean(np.abs(baseline[low] - test_truth[low]))) if np.any(low) else 0,
        "high_mae": float(np.mean(np.abs(prediction[high] - test_truth[high]))) if np.any(high) else 0,
        "high_baseline_mae": float(np.mean(np.abs(baseline[high] - test_truth[high]))) if np.any(high) else 0,
        "strongest_coefficients": sorted([round(float(value), 3) for value in coefficients], key=abs, reverse=True)[:5],
    }


if __name__ == "__main__":
    folds = np.array(json.loads(subprocess.check_output(["node", str(ROOT / "family-folds.cjs")], text=True)))
    report = {"peers": len(peers), "rated_target": len(own), "folds": 5,
              "vote_quartiles": [round(float(x)) for x in quartiles], "models": {}}
    for shrinkage in (1, 5, 20, 100):
        results = [fit_predict(np.flatnonzero(folds != fold), np.flatnonzero(folds == fold), shrinkage) for fold in range(5)]
        report["models"][str(shrinkage)] = {key: round(float(np.mean([result[key] for result in results])), 4)
                                                for key in ("mae", "baseline_mae", "ndcg20", "baseline_ndcg20", "nonzero_fraction", "residual_correlation",
                                                            "low_mae", "low_baseline_mae", "high_mae", "high_baseline_mae")}
    print(json.dumps(report, indent=2))
