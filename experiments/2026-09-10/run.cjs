// Offline-only comparison. Reads the public Bangumi API and never modifies account data.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Core = require("../../src/core.cjs");

const root = __dirname;
const snapshot = JSON.parse(
  fs.readFileSync(path.join(root, "../2026-09-07/snapshot.json"), "utf8"),
);
const detailsPath = path.join(root, "rating-details.json");
const candidateDetailsPath = path.join(root, "candidate-details.json");
const resultsPath = path.join(root, "results.json");
const reportPath = path.join(root, "REPORT.md");
const API_BASE = "https://api.bgm.tv";
const USER_AGENT = "wylt-bupt/bangumi-personal-recommender (offline rating-rubric experiment)";

const SHRINKAGE = {
  tag: 4, meta: 4, director: 2.5, studio: 4, creator: 3, series: 3,
  script: 3, music: 4, cv: 7, decade: 8, format: 6,
};
const MIN_SUPPORT = {
  tag: 4, meta: 3, director: 2, studio: 3, creator: 2, series: 2,
  script: 2, music: 3, cv: 4, decade: 4, format: 3,
};

const mean = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

function ratingDistribution(subject) {
  const counts = subject?.rating?.count || {};
  let total = 0;
  let weighted = 0;
  let squared = 0;
  for (let rating = 1; rating <= 10; rating += 1) {
    const count = Number(counts[rating] || 0);
    total += count;
    weighted += rating * count;
    squared += rating * rating * count;
  }
  if (!total) return null;
  const publicMean = weighted / total;
  const standardDeviation = Math.sqrt(Math.max(0, squared / total - publicMean ** 2));
  return { total, publicMean, standardDeviation };
}

function personalUtility(rate) {
  return Core.clamp((Number(rate) - 7) / 3, -1, 1);
}

function preferenceSignal(rate, distribution, variant) {
  const utility = personalUtility(rate);
  if (!utility || variant === "B") return utility;
  if (!distribution?.standardDeviation) return utility;
  const z = Core.clamp(
    (Number(rate) - distribution.publicMean) /
      Math.max(1, distribution.standardDeviation),
    -2,
    2,
  );
  const alignedDifference = Math.sign(utility) * z;
  const adjustment = 1 + 0.15 * Math.tanh(alignedDifference);
  return utility * adjustment;
}

async function requestSubject(id) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}/v0/subjects/${id}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function loadRatingDetails(collections) {
  fs.mkdirSync(root, { recursive: true });
  const saved = fs.existsSync(detailsPath)
    ? JSON.parse(fs.readFileSync(detailsPath, "utf8"))
    : { subjects: {}, errors: {} };
  const ids = [...new Set(collections.filter((item) => item.rate > 0).map((item) => item.subjectId))];
  const missing = ids.filter((id) => !saved.subjects[id] && !saved.errors[id]);
  let cursor = 0;
  let completed = 0;
  const persist = () => fs.writeFileSync(detailsPath, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    subjects: saved.subjects,
    errors: saved.errors,
  }));
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < missing.length) {
      const id = missing[cursor];
      cursor += 1;
      try {
        const subject = await requestSubject(id);
        saved.subjects[id] = {
          id,
          name: subject.name_cn || subject.name,
          rating: subject.rating,
        };
      } catch (error) {
        saved.errors[id] = String(error?.message || error);
      }
      completed += 1;
      if (completed % 50 === 0 || completed === missing.length) {
        persist();
        console.log(`rating distributions ${completed}/${missing.length}`);
      }
      await sleep(80);
    }
  }));
  if (!missing.length) console.log("rating distributions loaded from cache");
  return saved;
}

async function loadCandidateDetails(candidates) {
  const saved = fs.existsSync(candidateDetailsPath)
    ? JSON.parse(fs.readFileSync(candidateDetailsPath, "utf8"))
    : { subjects: {}, errors: {} };
  const missing = candidates.map((subject) => subject.id)
    .filter((id) => !saved.subjects[id] && !saved.errors[id]);
  let cursor = 0;
  let completed = 0;
  const persist = () => fs.writeFileSync(candidateDetailsPath, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    subjects: saved.subjects,
    errors: saved.errors,
  }));
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < missing.length) {
      const id = missing[cursor];
      cursor += 1;
      try {
        const subject = await requestSubject(id);
        saved.subjects[id] = {
          id,
          name: subject.name,
          name_cn: subject.name_cn,
          platform: subject.platform,
          eps: subject.eps,
          total_episodes: subject.total_episodes,
          meta_tags: subject.meta_tags,
          tags: subject.tags,
        };
      } catch (error) {
        saved.errors[id] = String(error?.message || error);
      }
      completed += 1;
      if (completed % 50 === 0 || completed === missing.length) {
        persist();
        console.log(`candidate details ${completed}/${missing.length}`);
      }
      await sleep(80);
    }
  }));
  if (!missing.length) console.log("candidate details loaded from cache");
  return saved;
}

function candidateExclusion(subject, detail) {
  if (!detail) return null;
  const title = Core.normalizeText(`${detail.name || ""} ${detail.name_cn || ""}`);
  const platform = Core.normalizeText(detail.platform || "");
  const tags = Core.normalizeText([
    ...(detail.meta_tags || []),
    ...(detail.tags || []).map((tag) => typeof tag === "string" ? tag : tag?.name),
  ].join(" "));
  const formatText = `${platform} ${tags}`;
  if (/(?:剧场版|劇場版|映画|movie|film|ova|oad|special|特别篇|特別篇|sp\b)/i.test(formatText)) {
    return "movie-or-special";
  }
  if (/(?:总集篇|總集篇|総集編|重制版|重製版|重置版|remake|リメイク|再编辑|再編輯|再編集|re-?edit|recap|digest|etv版)/i.test(`${title} ${tags}`)) {
    return "recut-or-remake";
  }
  const episodes = Number(detail.total_episodes || detail.eps || 0);
  if (episodes > 0 && episodes < 10) return "under-10-episodes";
  return null;
}

function trainExperimental(collectionInputs, details, variant) {
  const collections = collectionInputs.map(Core.normalizeCollection);
  const rated = collections.filter((item) => item.rate > 0);
  const baseline = Core.calculateRatingBaseline(collections);
  const stats = new Map();
  const anchors = [];
  const families = new Set();

  for (const item of rated) {
    const vector = Core.buildFeatureVector(item.subject, item.tags);
    const similarityVector = Core.buildSimilarityVector(item.subject, item.tags);
    const familyKey = Core.seriesFamilyKey(item.subject);
    const distribution = ratingDistribution(details.subjects[item.subjectId]);
    const signal = preferenceSignal(item.rate, distribution, variant);
    families.add(familyKey);
    if (signal !== 0) {
      anchors.push({
        subjectId: item.subjectId,
        name: item.subject.nameCn || item.subject.name,
        rate: item.rate,
        residual: signal,
        features: vector.features,
        similarityFeatures: similarityVector.features,
        familyKey,
      });
    }
    for (const [token, magnitude] of Object.entries(vector.features)) {
      const current = stats.get(token) || {
        families: new Map(),
        label: vector.labels[token] || token,
      };
      const family = current.families.get(familyKey) || { count: 0, weightedSignal: 0 };
      family.count += 1;
      family.weightedSignal += signal * magnitude;
      current.families.set(familyKey, family);
      stats.set(token, current);
    }
  }

  const featureWeights = {};
  const featureSupport = {};
  const featureLabels = {};
  const familyCount = Math.max(1, families.size);
  for (const [token, stat] of stats) {
    const role = token.split(":", 1)[0];
    const support = stat.families.size;
    const configuredMinimum = MIN_SUPPORT[role] || 2;
    const minimumSupport = (role === "tag" || role === "meta")
      ? Math.min(configuredMinimum, familyCount >= 60 ? 4 : familyCount >= 20 ? 3 : 2)
      : configuredMinimum;
    if (support < minimumSupport) continue;
    const mass = [...stat.families.values()]
      .reduce((sum, family) => sum + family.weightedSignal / family.count, 0);
    const idf = Core.clamp(Math.log((familyCount + 1) / (support + 1)) + 1, 1, 2.5);
    featureWeights[token] = mass / ((SHRINKAGE[role] || 4) + support) * idf;
    featureSupport[token] = support;
    featureLabels[token] = stat.label;
  }

  const selectedAnchors = variant === "D"
    ? [...anchors].sort((left, right) => Math.abs(right.residual) - Math.abs(left.residual)).slice(0, 80)
    : anchors;
  return {
    version: `experiment-${variant}`,
    collectionCount: collections.length,
    ratedCount: rated.length,
    baseline,
    featureWeights,
    featureSupport,
    featureLabels,
    anchors: selectedAnchors,
  };
}

function folds(collections, count = 5) {
  const groups = new Map();
  for (const item of collections) {
    const key = Core.seriesFamilyKey(item.subject);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const result = Array.from({ length: count }, () => []);
  for (const [, members] of [...groups].sort((left, right) =>
    right[1].length - left[1].length || hash(left[0]).localeCompare(hash(right[0])))) {
    const target = result.reduce((best, fold, index) =>
      fold.length < result[best].length ? index : best, 0);
    result[target].push(...members);
  }
  return result;
}

function auc(rows) {
  const positives = rows.filter((row) => row.rate >= 8);
  const negatives = rows.filter((row) => row.rate <= 6);
  let wins = 0;
  let pairs = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      pairs += 1;
      wins += positive.score > negative.score ? 1 : positive.score === negative.score ? 0.5 : 0;
    }
  }
  return pairs ? wins / pairs : 0;
}

function metrics(rows) {
  const ranked = [...rows].sort((left, right) => right.score - left.score);
  const top20 = ranked.slice(0, 20);
  const dcg = (values) => values.reduce((sum, row, index) =>
    sum + (2 ** Math.max(0, row.rate - 7) - 1) / Math.log2(index + 2), 0);
  const ideal = dcg([...rows].sort((left, right) => right.rate - left.rate).slice(0, 20));
  return {
    rows: rows.length,
    aucLikedVsDisliked: auc(rows),
    precision20Liked: mean(top20.map((row) => Number(row.rate >= 8))),
    ndcg20: ideal ? dcg(top20) / ideal : 0,
    meanScoreLiked: mean(rows.filter((row) => row.rate >= 8).map((row) => row.score)),
    meanScoreNeutral: mean(rows.filter((row) => row.rate === 7).map((row) => row.score)),
    meanScoreDisliked: mean(rows.filter((row) => row.rate <= 6).map((row) => row.score)),
  };
}

function crossValidate(collections, details, variant) {
  const partitions = folds(collections);
  const rows = [];
  for (let foldIndex = 0; foldIndex < partitions.length; foldIndex += 1) {
    const held = partitions[foldIndex];
    const heldIds = new Set(held.map((item) => item.subjectId));
    const training = collections.filter((item) => !heldIds.has(item.subjectId));
    const profile = variant === "A"
      ? Core.trainProfile(training)
      : trainExperimental(training, details, variant);
    for (const item of held) {
      const scored = Core.scoreSubject(item.subject, profile, "balanced");
      rows.push({
        id: item.subjectId,
        rate: item.rate,
        fold: foldIndex,
        score: scored.normalizedScore,
      });
    }
  }
  const foldMetrics = partitions.map((unused, index) => metrics(rows.filter((row) => row.fold === index)));
  return {
    overall: metrics(rows),
    foldMean: {
      precision20Liked: mean(foldMetrics.map((entry) => entry.precision20Liked)),
      ndcg20: mean(foldMetrics.map((entry) => entry.ndcg20)),
    },
  };
}

function scoreCandidates(candidates, profile) {
  const raw = candidates
    .map((subject) => Core.scoreSubject(subject, profile, "balanced"))
    .sort((left, right) => right.normalizedScore - left.normalizedScore);
  const mmr = Core.diversify(raw.slice(0, 180), Math.min(180, raw.length), "balanced", "2026-09-10-fixed");
  return { raw, mmr };
}

function compact(scored, rank) {
  return {
    rank,
    id: scored.subject.id,
    name: scored.subject.nameCn || scored.subject.name,
    predicted: scored.predicted,
    score: scored.normalizedScore,
    content: scored.contentScore,
    neighbor: scored.neighborScore,
    quality: scored.qualityScore,
    neighbors: scored.similarWorks.slice(0, 6),
  };
}

function rankingSummary(scored) {
  return scored.map((item, index) => compact(item, index + 1));
}

function rankOf(rows, id) {
  const index = rows.findIndex((item) => Number(item.subject.id) === Number(id));
  return index >= 0 ? compact(rows[index], index + 1) : null;
}

async function main() {
  const collections = snapshot.collections.map(Core.normalizeCollection).filter((item) => item.rate > 0);
  const details = await loadRatingDetails(collections);
  const candidateDetails = await loadCandidateDetails(snapshot.candidates);
  const variants = {
    A: Core.trainProfile(collections),
    B: trainExperimental(collections, details, "B"),
    C: trainExperimental(collections, details, "C"),
    D: trainExperimental(collections, details, "D"),
  };
  const evaluation = {};
  for (const variant of Object.keys(variants)) {
    console.log(`cross-validation ${variant}`);
    evaluation[variant] = crossValidate(collections, details, variant);
  }
  const candidateScores = Object.fromEntries(
    Object.entries(variants).map(([variant, profile]) => [variant, scoreCandidates(snapshot.candidates, profile)]),
  );
  const exclusionById = new Map(snapshot.candidates.map((subject) => [
    subject.id,
    candidateExclusion(subject, candidateDetails.subjects[subject.id]),
  ]));
  const filteredCandidates = snapshot.candidates.filter((subject) => !exclusionById.get(subject.id));
  const filteredScores = Object.fromEntries(["B", "C"].map((variant) => [
    variant,
    scoreCandidates(filteredCandidates, variants[variant]),
  ]));
  const excludedCounts = [...exclusionById.values()].filter(Boolean).reduce((counts, reason) => {
    counts[reason] = (counts[reason] || 0) + 1;
    return counts;
  }, {});
  const watched = [1029, 296659, 253, 4216, 822, 270499, 307237];
  const rankings = Object.fromEntries(Object.entries(candidateScores).map(([variant, stages]) => [variant, {
    top20Raw: rankingSummary(stages.raw.slice(0, 20)),
    top20Mmr: rankingSummary(stages.mmr.slice(0, 20)),
    watchedRaw: watched.map((id) => rankOf(stages.raw, id)).filter(Boolean),
    watchedMmr: watched.map((id) => rankOf(stages.mmr, id)).filter(Boolean),
  }]));
  const filteredRankings = Object.fromEntries(Object.entries(filteredScores).map(([variant, stages]) => [variant, {
    top20Raw: rankingSummary(stages.raw.slice(0, 20)),
    top20Mmr: rankingSummary(stages.mmr.slice(0, 20)),
    watchedRaw: watched.map((id) => rankOf(stages.raw, id)).filter(Boolean),
    watchedMmr: watched.map((id) => rankOf(stages.mmr, id)).filter(Boolean),
  }]));
  const excludedTop = candidateScores.B.raw
    .filter((item) => exclusionById.get(item.subject.id))
    .slice(0, 30)
    .map((item) => ({
      id: item.subject.id,
      name: item.subject.nameCn || item.subject.name,
      reason: exclusionById.get(item.subject.id),
      previousRawRank: candidateScores.B.raw.indexOf(item) + 1,
    }));
  const anchorChecks = [454684, 446296, 415166].map((id) => ({
    id,
    name: details.subjects[id]?.name,
    distribution: ratingDistribution(details.subjects[id]),
    rate: collections.find((item) => item.subjectId === id)?.rate,
    signals: Object.fromEntries(["A", "B", "C", "D"].map((variant) => {
      const anchor = variants[variant].anchors.find((item) => item.subjectId === id);
      return [variant, anchor?.residual ?? null];
    })),
  }));
  const aTop20 = new Set(candidateScores.A.mmr.slice(0, 20).map((item) => item.subject.id));
  const overlap = Object.fromEntries(["B", "C", "D"].map((variant) => [
    variant,
    candidateScores[variant].mmr.slice(0, 20).filter((item) => aTop20.has(item.subject.id)).length,
  ]));
  const result = {
    createdAt: new Date().toISOString(),
    snapshotAt: snapshot.at,
    scope: "Offline only; fixed 2026-09-07 Japanese candidate pool and MMR; no production edits.",
    data: {
      rated: collections.length,
      candidates: snapshot.candidates.length,
      distributions: Object.keys(details.subjects).length,
      distributionErrors: Object.keys(details.errors).length,
      candidateDetails: Object.keys(candidateDetails.subjects).length,
      candidateDetailErrors: Object.keys(candidateDetails.errors).length,
      filteredCandidates: filteredCandidates.length,
      excludedCandidates: snapshot.candidates.length - filteredCandidates.length,
      excludedCounts,
    },
    variants: {
      A: "production v0.9.4",
      B: "absolute personal rubric; 7 neutral; all decisive anchors",
      C: "B plus per-title rating-distribution SD adjustment capped at ±15%",
      D: "C with the production-sized 80-anchor neighborhood",
    },
    evaluation,
    anchorChecks,
    overlap,
    rankings,
    candidateFilter: {
      rules: ["exclude movie/OVA/OAD/special", "exclude recap/recut/remake", "exclude known episode count under 10"],
      excludedTop,
      rankings: filteredRankings,
    },
  };
  fs.writeFileSync(resultsPath, JSON.stringify(result, null, 2));

  const f = (value) => Number(value).toFixed(4);
  const rankingTable = (stage) => Array.from({ length: 20 }, (_, index) => {
    const cells = ["A", "B", "C", "D"].map((variant) => {
      const row = rankings[variant][stage][index];
      return row ? `[${row.name}](https://bgm.tv/subject/${row.id}) ${row.predicted.toFixed(3)}` : "—";
    });
    return `| ${index + 1} | ${cells.join(" | ")} |`;
  });
  const metricRows = ["A", "B", "C", "D"].map((variant) => {
    const metric = evaluation[variant];
    return `| ${variant} | ${f(metric.overall.aucLikedVsDisliked)} | ${f(metric.foldMean.precision20Liked)} | ${f(metric.foldMean.ndcg20)} | ${f(metric.overall.meanScoreLiked)} | ${f(metric.overall.meanScoreNeutral)} | ${f(metric.overall.meanScoreDisliked)} |`;
  });
  const watchedRows = watched.flatMap((id) => {
    const name = rankings.A.watchedMmr.find((row) => row.id === id)?.name
      || rankings.B.watchedMmr.find((row) => row.id === id)?.name
      || rankings.C.watchedMmr.find((row) => row.id === id)?.name
      || String(id);
    return [`| ${name} | ${["A", "B", "C", "D"].map((variant) => rankings[variant].watchedMmr.find((row) => row.id === id)?.rank || "—").join(" | ")} |`];
  });
  const filteredTable = (stage) => Array.from({ length: 20 }, (_, index) => {
    const cells = ["B", "C"].map((variant) => {
      const row = filteredRankings[variant][stage][index];
      return row ? `[${row.name}](https://bgm.tv/subject/${row.id}) ${row.predicted.toFixed(3)}` : "—";
    });
    return `| ${index + 1} | ${cells.join(" | ")} |`;
  });
  const report = [
    "# 评分语义与标准差实验 · 2026-09-10",
    "",
    `固定 ${snapshot.at} 的 ${snapshot.candidates.length} 个日本动画候选；使用 ${collections.length} 条已评分动画。没有修改生产代码、浏览器缓存或线上组件。`,
    "",
    "## 实验组",
    "",
    "- A：当前 v0.9.4。个人评分相对站点预期的残差训练标签，并保留绝对残差最大的 80 个近邻锚点。",
    "- B：7 分严格中性，8 分及以上为正向，6 分及以下为负向；标签画像和近邻都使用该绝对偏好；近邻使用所有非中性样本。",
    "- C：B 的信号再由作品自身 1–10 分分布标准差做弱调整；只调整强度且不改变正负，最大幅度 ±15%。",
    "- D：C 的标签画像不变，但把近邻重新限制为 80 个最强非中性锚点，用来判断排序变化是否来自扩大近邻范围。",
    "",
    "## 五折按系列留出",
    "",
    "AUC 只比较 8+ 与 6−，排除 7 分。P@20 与 NDCG@20 为五折平均。三类平均分是留出作品的未映射主排序分。",
    "",
    "| 组 | AUC↑ | P@20↑ | NDCG@20↑ | 8+ 平均 | 7 平均 | 6− 平均 |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...metricRows,
    "",
    "## 三个问题样本",
    "",
    ...anchorChecks.map((item) => `- ${item.name}：你的评分 ${item.rate}；站点均分 ${item.distribution?.publicMean.toFixed(2)}，标准差 ${item.distribution?.standardDeviation.toFixed(2)}；A/B/C/D 信号 ${["A", "B", "C", "D"].map((variant) => item.signals[variant] === null ? "无" : item.signals[variant].toFixed(3)).join(" / ")}。`),
    "",
    "## 统一 MMR 后关注条目名次",
    "",
    "| 条目 | A | B | C | D |",
    "|---|---:|---:|---:|---:|",
    ...watchedRows,
    "",
    `B/C/D 与 A 的前二十重合：${overlap.B}/20、${overlap.C}/20、${overlap.D}/20。`,
    "",
    "## 统一 MMR 后前二十",
    "",
    "| 名次 | A 当前 | B 绝对评分语义 | C 再加标准差弱调整 | D 恢复 80 锚点 |",
    "|---:|---|---|---|---|",
    ...rankingTable("top20Mmr"),
    "",
    "## MMR 前前二十",
    "",
    "| 名次 | A 当前 | B 绝对评分语义 | C 再加标准差弱调整 | D 恢复 80 锚点 |",
    "|---:|---|---|---|---|",
    ...rankingTable("top20Raw"),
    "",
    "完整逐项数据见 results.json。",
    "",
    "## 候选源过滤实验",
    "",
    `取得 ${Object.keys(candidateDetails.subjects).length}/${snapshot.candidates.length} 个候选详情；过滤后剩余 ${filteredCandidates.length} 个，排除 ${snapshot.candidates.length - filteredCandidates.length} 个。详情读取失败的候选不因缺失数据而误删。`,
    "",
    `排除原因：剧场版／OVA／OAD／特别篇 ${excludedCounts["movie-or-special"] || 0} 个；总集／重编／重制 ${excludedCounts["recut-or-remake"] || 0} 个；已知不足 10 集 ${excludedCounts["under-10-episodes"] || 0} 个。`,
    "",
    "规则仅作用于候选召回之后、评分之前；画像、评分权重和全池 MMR 均未改变。",
    "",
    "### 过滤后的统一 MMR 前二十",
    "",
    "| 名次 | B 绝对评分语义 | C 再加标准差弱调整 |",
    "|---:|---|---|",
    ...filteredTable("top20Mmr"),
    "",
    "### 过滤后的 MMR 前原始前二十",
    "",
    "| 名次 | B 绝对评分语义 | C 再加标准差弱调整 |",
    "|---:|---|---|",
    ...filteredTable("top20Raw"),
    "",
    "### 原 B 排序中最靠前的被排除候选",
    "",
    ...excludedTop.slice(0, 20).map((item) => `- 原始第 ${item.previousRawRank}：${item.name}（${item.reason}）`),
  ].join("\n");
  fs.writeFileSync(reportPath, report);
  console.log(JSON.stringify({
    data: result.data,
    evaluation,
    anchorChecks,
    overlap,
    top10Mmr: Object.fromEntries(["A", "B", "C", "D"].map((variant) => [
      variant,
      rankings[variant].top20Mmr.slice(0, 10).map((row) => [row.name, Number(row.predicted.toFixed(3))]),
    ])),
    watchedMmr: Object.fromEntries(["A", "B", "C", "D"].map((variant) => [variant, rankings[variant].watchedMmr.map((row) => [row.name, row.rank])])),
    candidateFilter: {
      counts: result.data,
      excludedCounts,
      excludedTop: excludedTop.slice(0, 12),
      top20Mmr: Object.fromEntries(["B", "C"].map((variant) => [
        variant,
        filteredRankings[variant].top20Mmr.map((row) => [row.name, Number(row.predicted.toFixed(3))]),
      ])),
      watchedMmr: Object.fromEntries(["B", "C"].map((variant) => [
        variant,
        filteredRankings[variant].watchedMmr.map((row) => [row.name, row.rank]),
      ])),
    },
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  candidateExclusion,
  personalUtility,
  preferenceSignal,
  ratingDistribution,
  trainExperimental,
};
