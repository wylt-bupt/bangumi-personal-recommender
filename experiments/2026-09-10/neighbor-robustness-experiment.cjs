"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Core = require("../../src/core.cjs");
const Existing = require("./run.cjs");

const ROOT = path.resolve(__dirname, "../..");
const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "experiments/2026-09-07/snapshot.json"), "utf8"));
const ratingDetails = JSON.parse(fs.readFileSync(path.join(__dirname, "rating-details.json"), "utf8"));
const candidateDetails = JSON.parse(fs.readFileSync(path.join(__dirname, "candidate-details.json"), "utf8"));

// These describe provenance or format, not what a work is about. They must not
// satisfy the "two shared content tags" test for a personal-preference neighbor.
const PROVENANCE = /^(?:原创|原創|游戏改|遊戲改|漫畫改|漫画改|漫改|轻小说改|輕小說改|小说改|小說改|tv|ova|oad|web|剧场版|劇場版)$/i;
const EVALUATIVE = /^(?:神作|佳作|名作|经典|經典|神配乐|神配樂|不坑爹|骗钱大师|騙錢大師)$/i;
const SEMANTIC = /(?:治[愈癒]|致郁|日常|恋爱|愛情|纯爱|校[园園]|青春|成长|百合|耽美|科幻|奇幻|魔幻|悬疑|推理|恐怖|惊悚|猎奇|黑暗|压抑|扭曲|虚无|空虚|孤独|冒险|战争|历史|社会|政治|职场|家庭|亲情|友情|喜剧|搞笑|爆笑|吐槽|电波|意识流|群像|公路|音乐|运动|竞技|偶像|机战|机器人|超能力|异世界|穿越|轮回|时间|末日|灾难|犯罪|侦探|心理|哲学|文学|童话|催泪|感动|热血|萌|美食|旅行|剧情|后宫|ntr|胃[疼痛药]|励志|浪漫|战斗|单元剧|成人|里番|r18)/i;

function alias(value) {
  return Core.normalizeText(value)
    .replace(/^治[愈癒]$/, "治愈")
    .replace(/^校[园園]$/, "校园")
    .replace(/^愛情$/, "爱情")
    .replace(/[\s._・·—–-]+/g, "");
}

function semanticVector(subjectInput, personalTags = []) {
  const subject = Core.normalizeSubject(subjectInput);
  const personal = new Set(Core.normalizeTagList(personalTags).map(alias));
  const rows = [...new Set([...subject.tags, ...subject.metaTags])]
    .filter((tag) => SEMANTIC.test(tag) && !PROVENANCE.test(tag) && !EVALUATIVE.test(tag))
    .map((tag) => ({
      tag,
      key: alias(tag),
      count: Math.max(0, Number(subject.tagCounts[Core.normalizeText(tag)] || 0)),
    }));
  const maxCount = Math.max(1, ...rows.map((row) => row.count));
  const features = {};
  for (const row of rows) {
    // A tag supported by only a small fraction of the work's taggers is weak
    // evidence. A tag explicitly entered by the user remains full-strength.
    const salience = personal.has(row.key)
      ? 1
      : row.count > 0
        ? Math.sqrt(row.count / maxCount)
        : 0.15;
    features[`content:${row.key}`] = Math.max(features[`content:${row.key}`] || 0, salience);
  }
  return features;
}

function attachSemanticAnchors(profile, collections) {
  const byId = new Map(collections.map((item) => [item.subjectId, item]));
  return {
    ...profile,
    anchors: profile.anchors.map((anchor) => {
      const item = byId.get(anchor.subjectId);
      return {
        ...anchor,
        semanticFeatures: semanticVector(item?.subject || {}, item?.tags || []),
      };
    }),
  };
}

function neighborEntries(subject, profile, vectorKind) {
  const candidateFeatures = vectorKind === "semantic"
    ? semanticVector(subject)
    : Core.buildSimilarityVector(subject).features;
  const seenFamilies = new Set();
  const entries = profile.anchors
    .map((anchor) => {
      const anchorFeatures = vectorKind === "semantic"
        ? anchor.semanticFeatures
        : (anchor.similarityFeatures || anchor.features);
      const shared = Object.keys(candidateFeatures).filter((token) => Number(anchorFeatures?.[token] || 0) > 0);
      return {
        anchor,
        shared,
        similarity: shared.length >= 2 ? Core.weightedJaccard(candidateFeatures, anchorFeatures) : 0,
      };
    })
    .filter((entry) => entry.similarity >= 0.04)
    .sort((left, right) => right.similarity - left.similarity)
    .filter((entry) => {
      const key = entry.anchor.familyKey || `subject:${entry.anchor.subjectId}`;
      if (seenFamilies.has(key)) return false;
      seenFamilies.add(key);
      return true;
    });
  return { candidateFeatures, entries };
}

function salientContentScore(subjectInput, profile, exponent = 0.5) {
  const subject = Core.normalizeSubject(subjectInput);
  const vector = Core.buildFeatureVector(subject);
  const tagRows = Object.entries(vector.features)
    .filter(([token]) => token.startsWith("tag:") || token.startsWith("meta:"))
    .map(([token]) => {
      const label = Core.normalizeText(vector.labels[token] || token.slice(token.indexOf(":") + 1));
      return { token, count: Math.max(0, Number(subject.tagCounts[label] || 0)) };
    });
  const maxCount = Math.max(1, ...tagRows.map((row) => row.count));
  const adjusted = {};
  for (const [token, magnitude] of Object.entries(vector.features)) {
    const row = tagRows.find((entry) => entry.token === token);
    const salience = row ? (row.count > 0 ? (row.count / maxCount) ** exponent : 0.15) : 1;
    adjusted[token] = magnitude * salience;
  }
  const mass = Object.values(adjusted).reduce((sum, value) => sum + Math.abs(value), 0);
  const raw = Object.entries(adjusted).reduce(
    (sum, [token, magnitude]) => sum + magnitude * Number(profile.featureWeights[token] || 0),
    0,
  ) / Math.sqrt(Math.max(1, mass));
  return Math.tanh(raw * 2.2);
}

function score(subjectInput, profile, variant) {
  const base = Core.scoreSubject(subjectInput, profile, "balanced");
  if (variant === "B") return base;
  if (variant === "Q") {
    // Delete the local-neighbor correction entirely. The remaining 0.6:0.15
    // ratio is normalized to 0.8:0.2 so the displayed score keeps its range.
    const normalizedScore = 0.8 * base.contentScore + 0.2 * base.qualityScore;
    return {
      ...base,
      neighborScore: 0,
      normalizedScore,
      predicted: Core.clamp(profile.baseline.userMean + normalizedScore * 2.1, 1, 10),
      similarWorks: [],
      neighborDiagnostics: { removed: true },
    };
  }
  if (variant.startsWith("R")) {
    const exponent = variant === "R25" ? 0.25 : variant === "R35" ? 0.35 : 0.5;
    const content = salientContentScore(base.subject, profile, exponent);
    const normalizedScore = 0.8 * content + 0.2 * base.qualityScore;
    return {
      ...base,
      contentScore: content,
      neighborScore: 0,
      normalizedScore,
      predicted: Core.clamp(profile.baseline.userMean + normalizedScore * 2.1, 1, 10),
      similarWorks: [],
      neighborDiagnostics: { removed: true, tagSalience: true },
    };
  }
  const vectorKind = variant === "N" ? "current" : "semantic";
  const robust = variant === "N" || variant === "S";
  const { entries: allEntries } = neighborEntries(base.subject, profile, vectorKind);
  const entries = robust ? allEntries : allEntries.slice(0, 6);
  const weights = entries.map((entry) => robust ? entry.similarity ** 2 : entry.similarity);
  const mass = weights.reduce((sum, value) => sum + value, 0);
  const rawNeighbor = mass
    ? entries.reduce((sum, entry, index) => sum + weights[index] * entry.anchor.residual, 0) / mass
    : 0;
  const effectiveCount = mass
    ? (mass ** 2) / Math.max(1e-9, weights.reduce((sum, value) => sum + value ** 2, 0))
    : 0;
  const reliability = mass
    ? (mass / (mass + (robust ? 0.22 : 0.75))) * Math.min(1, effectiveCount / 4)
    : 0;
  const neighbor = rawNeighbor * reliability;
  const normalizedScore = 0.6 * base.contentScore + 0.25 * neighbor + 0.15 * base.qualityScore;
  return {
    ...base,
    neighborScore: neighbor,
    normalizedScore,
    predicted: Core.clamp(profile.baseline.userMean + normalizedScore * 2.1, 1, 10),
    similarWorks: entries.slice(0, 12).map((entry) => ({
      subjectId: entry.anchor.subjectId,
      name: entry.anchor.name,
      rate: entry.anchor.rate,
      residual: entry.anchor.residual,
      similarity: entry.similarity,
      shared: entry.shared.map((token) => token.slice(8)),
    })),
    neighborDiagnostics: { matchingFamilies: allEntries.length, effectiveCount, rawNeighbor, reliability },
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
  for (const [, members] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    let target = 0;
    for (let index = 1; index < result.length; index += 1) if (result[index].length < result[target].length) target = index;
    result[target].push(...members);
  }
  return result;
}

function metrics(rows) {
  const positives = rows.filter((row) => row.rate >= 8);
  const negatives = rows.filter((row) => row.rate <= 6);
  let wins = 0;
  let pairs = 0;
  for (const positive of positives) for (const negative of negatives) {
    pairs += 1;
    wins += positive.score > negative.score ? 1 : positive.score === negative.score ? 0.5 : 0;
  }
  const ranked = [...rows].sort((a, b) => b.score - a.score);
  const dcg = (values) => values.reduce((sum, row, index) => sum + (2 ** Math.max(0, row.rate - 7) - 1) / Math.log2(index + 2), 0);
  const ideal = dcg([...rows].sort((a, b) => b.rate - a.rate).slice(0, 20));
  return {
    auc: wins / pairs,
    precision20: ranked.slice(0, 20).filter((row) => row.rate >= 8).length / 20,
    ndcg20: dcg(ranked.slice(0, 20)) / ideal,
  };
}

function validate(collections, variant) {
  const rows = [];
  for (const [foldIndex, held] of folds(collections).entries()) {
    const heldIds = new Set(held.map((item) => item.subjectId));
    const training = collections.filter((item) => !heldIds.has(item.subjectId));
    let profile = Existing.trainExperimental(training, ratingDetails, "B");
    profile = attachSemanticAnchors(profile, training);
    for (const item of held) rows.push({ rate: item.rate, score: score(item.subject, profile, variant).normalizedScore, foldIndex });
  }
  const perFold = Array.from({ length: 5 }, (_, foldIndex) => metrics(rows.filter((row) => row.foldIndex === foldIndex)));
  const overall = metrics(rows);
  return {
    ...overall,
    foldPrecision20: perFold.reduce((sum, row) => sum + row.precision20, 0) / 5,
    foldNdcg20: perFold.reduce((sum, row) => sum + row.ndcg20, 0) / 5,
  };
}

function rankCandidates(candidates, profile, variant) {
  const raw = candidates.map((subject) => score(subject, profile, variant)).sort((a, b) => b.normalizedScore - a.normalizedScore);
  const mmr = Core.diversify(raw.slice(0, 180), Math.min(180, raw.length), "balanced", "2026-09-10-fixed");
  return { raw, mmr };
}

function compact(item, rank) {
  return {
    rank,
    id: item.subject.id,
    name: item.subject.nameCn || item.subject.name,
    predicted: Number(item.predicted.toFixed(3)),
    content: Number(item.contentScore.toFixed(4)),
    neighbor: Number(item.neighborScore.toFixed(4)),
    quality: Number(item.qualityScore.toFixed(4)),
    diagnostics: item.neighborDiagnostics,
    neighbors: item.similarWorks.slice(0, 8),
  };
}

function findRank(rows, id) {
  const index = rows.findIndex((row) => Number(row.subject.id) === Number(id));
  return index < 0 ? null : compact(rows[index], index + 1);
}

function main() {
  const collections = snapshot.collections.map(Core.normalizeCollection).filter((item) => item.rate > 0);
  let profile = Existing.trainExperimental(collections, ratingDetails, "B");
  profile = attachSemanticAnchors(profile, collections);
  const candidates = snapshot.candidates.filter((subject) => !Existing.candidateExclusion(subject, candidateDetails.subjects[subject.id]));
  const variants = {
    B: "现有：原标签向量 + 最近6部",
    Q: "奥卡姆方案：删除近邻项，仅全局标签画像80% + 质量20%",
    R: "奥卡姆增强：删除近邻项，并按条目内标签票数校准标签证据",
    R25: "标签显著性弱校准（四次方根）",
    R35: "标签显著性中校准",
    N: "仅扩大：原标签向量 + 全邻域稳健均值",
    T: "仅净化：显著语义标签 + 最近6部",
    S: "单一替换方案：显著语义标签 + 全邻域稳健均值",
  };
  const focusIds = [11577, 253, 799, 1029, 207195, 848, 10391, 307237, 270499];
  const output = { generatedAt: new Date().toISOString(), variants: {}, validation: {} };
  for (const [variant, label] of Object.entries(variants)) {
    const ranked = rankCandidates(candidates, profile, variant);
    output.validation[variant] = validate(collections, variant);
    output.variants[variant] = {
      label,
      top20Raw: ranked.raw.slice(0, 20).map((item, index) => compact(item, index + 1)),
      top20Mmr: ranked.mmr.slice(0, 20).map((item, index) => compact(item, index + 1)),
      focus: Object.fromEntries(focusIds.map((id) => [id, {
        raw: findRank(ranked.raw, id),
        mmr: findRank(ranked.mmr, id),
      }])),
    };
  }
  fs.writeFileSync(path.join(__dirname, "neighbor-robustness-results.json"), JSON.stringify(output, null, 2));
  console.log(JSON.stringify({
    validation: output.validation,
    focus: Object.fromEntries(Object.keys(variants).map((variant) => [variant,
      Object.fromEntries([11577, 253, 799, 1029].map((id) => [id, {
        raw: output.variants[variant].focus[id].raw?.rank,
        mmr: output.variants[variant].focus[id].mmr?.rank,
        predicted: output.variants[variant].focus[id].raw?.predicted,
        neighbor: output.variants[variant].focus[id].raw?.neighbor,
      }]))])),
    top10Mmr: Object.fromEntries(Object.keys(variants).map((variant) => [variant,
      output.variants[variant].top20Mmr.slice(0, 10).map((row) => `${row.rank}. ${row.name} ${row.predicted}`)])),
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  attachSemanticAnchors,
  score,
};
