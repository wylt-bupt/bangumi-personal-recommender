const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/core.cjs");

function subject(id, score, tags, extra = {}) {
  return {
    id,
    type: 2,
    name: extra.name || `Subject ${id}`,
    name_cn: extra.nameCn || `条目 ${id}`,
    date: extra.date || "2020-01-01",
    tags: tags.map((name, index) => ({ name, count: 100 - index })),
    rating: { score, total: extra.total || 1000 },
    infobox: extra.infobox || [],
    persons: extra.persons || [],
    characters: extra.characters || [],
  };
}

function collection(id, rate, tags, extra = {}) {
  return {
    subject_id: id,
    type: 2,
    rate,
    tags,
    updated_at: `2026-08-${String(id).padStart(2, "0")}T00:00:00+08:00`,
    subject: subject(id, extra.globalScore || 7, tags, extra),
  };
}

test("matches special recommendation tags across public and personal collection tags", () => {
  const publicTagged = collection(20, 7, ["里番", "纯爱"]);
  const personalTagged = collection(21, 7, ["纯爱"]);
  personalTagged.tags = ["里番"];
  const unrelated = collection(22, 7, ["OVA", "纯爱"]);

  assert.equal(Core.subjectHasTag(publicTagged.subject, "里番"), true);
  assert.equal(Core.collectionHasTag(publicTagged, "里番"), true);
  assert.equal(Core.collectionHasTag(personalTagged, "里番"), true);
  assert.equal(Core.collectionHasTag(unrelated, "里番"), false);
});

test("excludes short-form and repackaged anime candidates", () => {
  assert.equal(Core.candidateExclusion({ name: "日常 ETV版", type: 2 }), "recut-or-remake");
  assert.equal(Core.candidateExclusion({ name: "银魂特别篇", type: 2 }), "movie-or-special");
  assert.equal(Core.candidateExclusion({ name: "普通标题", type: 2, platform: "剧场版" }), "movie-or-special");
  assert.equal(Core.candidateExclusion({ name: "短篇动画", type: 2, eps: 6 }), "under-10-episodes");
  assert.equal(Core.candidateExclusion({ name: "普通季度动画", type: 2, eps: 12, platform: "TV" }), null);
});

test("keeps direct adult tags and requires corroboration for ambiguous rating tags", () => {
  assert.equal(Core.isAdultRecommendationCandidate(subject(30, 7, ["里番", "OVA"])), true);
  assert.equal(Core.isAdultRecommendationCandidate(subject(30, 7, ["里番", "OVA"]), true), true);
  assert.equal(Core.isAdultRecommendationCandidate(subject(31, 7, ["成人动画"])), true);
  assert.equal(Core.isAdultRecommendationCandidate(subject(32, 7, ["R18", "18禁"])), false);
  assert.equal(Core.isAdultRecommendationCandidate(subject(38, 7, ["里番", "18X"])), true);
  assert.equal(Core.isAdultRecommendationCandidate(subject(33, 7, ["R18", "无码"])), true);
  assert.equal(Core.isAdultRecommendationCandidate(subject(36, 7, ["里番", "成人三部曲"])), true);
  assert.equal(Core.isAdultRecommendationCandidate(subject(34, 7, ["R18", "血腥", "猎奇"])), false);
  assert.equal(Core.isAdultRecommendationCandidate(subject(35, 7, ["18X", "OVA", "BL"])), false);
  assert.equal(Core.isAdultRecommendationCandidate(subject(37, 7, ["里番", "治愈", "日本"])), true);
  assert.equal(Core.isAdultRecommendationCandidate({
    ...subject(40, 7, ["里番", "治愈", "日本"]),
    tags: [{ name: "里番", count: 1 }, { name: "治愈", count: 50 }, { name: "日本", count: 50 }],
  }), false);
  assert.equal(Core.normalizeSubject({ ...subject(39, 7, ["里番"]), adultEvidenceVerified: false }).adultEvidenceVerified, false);
});

test("normalizes staff roles and keeps role identity separate", () => {
  assert.equal(Core.normalizeRole("导演"), "director");
  assert.equal(Core.normalizeRole("アニメーション制作"), "studio");
  assert.equal(Core.normalizeRole("系列构成"), "series");
  assert.equal(Core.normalizeRole("声优"), null);

  const vector = Core.buildFeatureVector(
    subject(1, 8, ["科幻"], {
      persons: [
        { id: 10, name: "某人", relation: "导演" },
        { id: 10, name: "某人", relation: "脚本" },
      ],
    }),
  );
  assert.ok(vector.features["director:10"]);
  assert.ok(vector.features["script:10"]);
});

test("extracts infobox credits and removes verified creative names from content tags", () => {
  const infobox = [
    { key: "动画制作", value: "WHITE FOX" },
    { key: "导演", value: "佐藤卓哉" },
    { key: "脚本", value: "花田十辉(1, 3)、佐藤卓哉(2)" },
  ];
  assert.deepEqual(Core.extractInfoboxCredits(infobox), [
    { role: "studio", label: "WHITE FOX" },
    { role: "director", label: "佐藤卓哉" },
    { role: "script", label: "花田十辉" },
    { role: "script", label: "佐藤卓哉" },
  ]);
  const vector = Core.buildFeatureVector({ ...subject(11, 8, ["科幻", "佐藤卓哉", "WHITE FOX"]), infobox });
  assert.equal(vector.features["studio:name:white fox"], undefined);
  assert.equal(vector.features["tag:佐藤卓哉"], undefined);
  assert.equal(vector.features["tag:whitefox"], undefined);
  assert.ok(vector.features["tag:科幻"]);

  assert.deepEqual(Core.selectContentTags({
    id: 13,
    type: 1,
    name_cn: "人类衰退之后",
    tags: ["濑户口廉也", "人類衰退之後", "致郁", "青春"],
    infobox: [{ key: "作者", value: "唐辺葉介 (瀬戸口廉也)" }],
  }).map((entry) => entry.label), ["致郁", "青春"]);
  assert.deepEqual(Core.selectContentTags({
    id: 14,
    type: 2,
    tags: ["新房昭之", "轻小说", "輕小說", "催泪", "gal改", "恋爱", "校园", "治愈"],
  }).map((entry) => entry.label), ["轻小说", "催泪", "gal改", "恋爱", "校园", "治愈"]);
});

test("learns absolute positive, neutral and negative preference from personal ratings", () => {
  const rows = [
    collection(1, 10, ["科幻", "悬疑"], { globalScore: 7.2 }),
    collection(2, 9, ["科幻", "轮回"], { globalScore: 7.1 }),
    collection(3, 9, ["科幻", "悬疑"], { globalScore: 7.4 }),
    collection(4, 8, ["科幻", "剧情"], { globalScore: 7.0 }),
    collection(5, 4, ["后宫", "异世界"], { globalScore: 7.0 }),
    collection(6, 3, ["后宫", "异世界"], { globalScore: 6.9 }),
    collection(7, 4, ["后宫", "校园"], { globalScore: 7.0 }),
    collection(8, 5, ["后宫", "喜剧"], { globalScore: 6.8 }),
  ];
  const profile = Core.trainProfile(rows);
  assert.ok(profile.featureWeights["tag:科幻"] > 0);
  assert.ok(profile.featureWeights["tag:后宫"] < 0);
  assert.equal(profile.ratedCount, 8);
});

test("treats 7 as neutral and keeps local neighbors out of the ranking score", () => {
  const rows = [
    collection(1, 7, ["中性标签", "科幻"]),
    collection(2, 7, ["中性标签", "悬疑"]),
    collection(3, 7, ["中性标签", "剧情"]),
    collection(4, 7, ["中性标签", "轮回"]),
    collection(5, 9, ["正向标签", "科幻", "悬疑"]),
    collection(6, 9, ["正向标签", "科幻", "悬疑"]),
    collection(7, 9, ["正向标签", "科幻", "剧情"]),
    collection(8, 9, ["正向标签", "科幻", "轮回"]),
  ];
  const profile = Core.trainProfile(rows);
  const scored = Core.scoreSubject(subject(101, 8, ["正向标签", "科幻", "悬疑"]), profile);
  assert.equal(profile.featureWeights["tag:中性标签"], 0);
  assert.ok(profile.featureWeights["tag:正向标签"] > 0);
  assert.ok(scored.similarWorks.length > 0);
  assert.equal(scored.neighborScore, 0);
  assert.ok(Math.abs(scored.normalizedScore - (0.8 * scored.contentScore + 0.2 * scored.qualityScore)) < 1e-12);
});

test("scores a matching candidate above a disliked-pattern candidate", () => {
  const rows = [
    collection(1, 10, ["科幻", "悬疑"], { globalScore: 7.2 }),
    collection(2, 9, ["科幻", "轮回"], { globalScore: 7.0 }),
    collection(3, 9, ["科幻", "悬疑"], { globalScore: 7.6 }),
    collection(4, 8, ["科幻", "剧情"], { globalScore: 7.0 }),
    collection(5, 4, ["后宫", "异世界"], { globalScore: 7.0 }),
    collection(6, 3, ["后宫", "异世界"], { globalScore: 6.9 }),
    collection(7, 4, ["后宫", "校园"], { globalScore: 7.0 }),
    collection(8, 5, ["后宫", "喜剧"], { globalScore: 6.8 }),
  ];
  const profile = Core.trainProfile(rows);
  const liked = Core.scoreSubject(subject(101, 7.4, ["科幻", "悬疑", "轮回"]), profile);
  const disliked = Core.scoreSubject(subject(102, 7.4, ["后宫", "异世界", "校园"]), profile);
  assert.ok(liked.predicted > disliked.predicted);
  assert.ok(liked.positiveReasons.some((reason) => reason.label === "科幻"));
  assert.ok(liked.similarWorks.length >= 2);
  assert.ok(liked.similarWorks.length <= 6);
  assert.deepEqual(liked.nearest, liked.similarWorks[0]);
  assert.ok(liked.similarWorks.every((entry) => entry.rate > 0));
  assert.ok(liked.similarWorks.every((entry, index, list) =>
    index === 0 || list[index - 1].similarity >= entry.similarity,
  ));
  const confidenceParts = Object.values(liked.confidenceBreakdown).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(confidenceParts - liked.confidenceScore) < 1e-12);
  assert.ok(liked.confidenceScore >= 0 && liked.confidenceScore <= 1);
  assert.ok(liked.neighborReliability > 0 && liked.neighborReliability < 1);
});

test("requires repeated independent content overlap before using a neighbor", () => {
  const rows = [
    collection(1, 10, ["科幻", "悬疑"], { globalScore: 7.2 }),
    collection(2, 9, ["科幻", "轮回"], { globalScore: 7.1 }),
    collection(3, 8, ["校园", "恋爱"], { globalScore: 7.0 }),
    collection(4, 7, ["日常", "治愈"], { globalScore: 6.9 }),
  ];
  const profile = Core.trainProfile(rows);
  const oneSharedTag = Core.scoreSubject(subject(101, 7.4, ["科幻", "音乐"]), profile);
  const twoSharedTags = Core.scoreSubject(subject(102, 7.4, ["科幻", "悬疑"]), profile);
  assert.equal(oneSharedTag.similarWorks.length, 0);
  assert.ok(twoSharedTags.similarWorks.length > 0);
});

test("counts sequel-heavy tag evidence by inferred series instead of episode count", () => {
  const repeatedSeries = [1, 2, 3].map((id) => collection(id, 8, ["特例标签", "恋爱"], {
    globalScore: 7,
    nameCn: `同一系列 第${id}季`,
  }));
  const profile = Core.trainProfile([
    ...repeatedSeries,
    collection(4, 8, ["特例标签", "校园"], { globalScore: 7, nameCn: "另一部作品" }),
    collection(5, 10, ["稳定标签", "恋爱"], { globalScore: 7, nameCn: "独立甲" }),
    collection(6, 10, ["稳定标签", "恋爱"], { globalScore: 7, nameCn: "独立乙" }),
    collection(7, 10, ["稳定标签", "恋爱"], { globalScore: 7, nameCn: "独立丙" }),
    collection(8, 10, ["稳定标签", "恋爱"], { globalScore: 7, nameCn: "独立丁" }),
    ...Array.from({ length: 60 }, (_, index) => collection(100 + index, 9, [`独立标签${index}`], {
      globalScore: 7,
      nameCn: `填充作品${index}`,
    })),
  ]);
  assert.equal(profile.featureWeights["tag:特例标签"], undefined);
  assert.ok(profile.featureWeights["tag:稳定标签"] > 0);
  assert.equal(profile.featureSupport["tag:稳定标签"], 4);
});

test("selects varied recommendation evidence by strength and text budget", () => {
  const item = {
    personalMean: 7.2,
    positiveReasons: [
      { role: "tag", roleLabel: "标签", label: "科幻", value: 0.5, support: 8 },
      { role: "tag", roleLabel: "标签", label: "轮回", value: 0.4, support: 6 },
      { role: "tag", roleLabel: "标签", label: "校园", value: 0.05, support: 12 },
      { role: "studio", roleLabel: "制作", label: "WHITE FOX", value: 0.3, support: 4 },
    ],
    similarWorks: [
      { name: "命运石之门", rate: 10, residual: 0.9, similarity: 0.2 },
      { name: "来自新世界", rate: 9, residual: 0.7, similarity: 0.16 },
      { name: "弱关联作品", rate: 8, residual: 0.3, similarity: 0.05 },
      { name: "低分但超预期", rate: 7, residual: 0.4, similarity: 0.19 },
    ],
  };
  const full = Core.selectRecommendationEvidence(item, 108);
  const compact = Core.selectRecommendationEvidence(item, 40);
  assert.deepEqual(full.map((entry) => entry.kind), ["similarity", "creative"]);
  assert.deepEqual(full.find((entry) => entry.kind === "similarity").works.map((entry) => entry.name), ["命运石之门", "来自新世界"]);
  assert.ok(compact.length < full.length);
});

test("keeps verified credits out of content tags and treats them as weak creative evidence", () => {
  const subjectWithCredits = {
    id: 12,
    type: 2,
    name: "THE IDOLM@STER",
    name_cn: "偶像大师",
    tags: ["日本", "TV", "a-1pictures", "偶像大师", "偶像", "音乐", "青春", "系列"],
    infobox: [{ key: "动画制作", value: "A-1 Pictures" }],
  };
  const positiveReasons = [
    { role: "tag", roleLabel: "标签", label: "a-1pictures", value: 0.4, support: 6 },
    { role: "tag", roleLabel: "标签", label: "偶像", value: 0.2, support: 8 },
    { role: "tag", roleLabel: "标签", label: "日本", value: 0.18, support: 20 },
  ];
  const evidence = Core.selectRecommendationEvidence({
    subject: subjectWithCredits,
    positiveReasons,
    similarWorks: [],
  });
  const tags = Core.selectContentTags(subjectWithCredits, positiveReasons);
  assert.ok(evidence.some((entry) => entry.kind === "creative" && entry.role === "studio"));
  assert.deepEqual(tags.map((entry) => entry.label), ["偶像", "音乐", "青春"]);
});

test("keeps the original normalization while treating supplemental credits as weak evidence", () => {
  const rows = [
    collection(1, 10, ["治愈", "日常"], { globalScore: 7.2 }),
    collection(2, 9, ["治愈", "青春"], { globalScore: 7.1 }),
    collection(3, 4, ["后宫", "异世界"], { globalScore: 7.0 }),
    collection(4, 3, ["后宫", "异世界"], { globalScore: 6.9 }),
  ];
  const profile = Core.trainProfile(rows);
  const candidate = subject(101, 7.4, ["治愈", "日常"], {
    persons: [{ id: 99, name: "陌生导演", relation: "导演" }],
  });
  const vector = Core.buildFeatureVector(candidate);
  const scored = Core.scoreSubject(candidate, profile);
  const raw = Object.entries(vector.features).reduce(
    (sum, [token, magnitude]) => sum + magnitude * Number(profile.featureWeights[token] || 0),
    0,
  );
  const mass = Object.values(vector.features).reduce((sum, value) => sum + Math.abs(value), 0);
  assert.ok(Math.abs(scored.contentScore - Math.tanh((raw / Math.sqrt(Math.max(1, mass))) * 2.2)) < 1e-12);
  assert.equal(Core.ROLE_WEIGHTS.director, 0.35);
  assert.equal(Core.ROLE_WEIGHTS.studio, 0.28);
  assert.equal(Core.ROLE_WEIGHTS.creator, 0.25);
  assert.equal(Core.ROLE_WEIGHTS.script, 0.2);
  assert.equal(Core.ROLE_WEIGHTS.music, 0.15);
  assert.equal(Core.ROLE_WEIGHTS.cv, 0.07);
  assert.ok(Core.ROLE_WEIGHTS.director < Core.ROLE_WEIGHTS.tag / 2);
});

test("MMR reduces near-duplicate results", () => {
  const make = (id, normalizedScore, tags) => ({
    subject: { id },
    normalizedScore,
    features: Object.fromEntries(tags.map((tag) => [`tag:${tag}`, 1])),
  });
  const pool = [
    make(1, 1, ["科幻", "轮回", "悬疑"]),
    make(2, 0.99, ["科幻", "轮回", "悬疑"]),
    make(3, 0.93, ["日常", "治愈"]),
    make(4, 0.9, ["喜剧", "校园"]),
  ];
  const selected = Core.diversify(pool, 3, "explore", "test");
  assert.ok([1, 2].includes(selected[0].subject.id));
  assert.ok(selected.some((item) => item.subject.id === 3 || item.subject.id === 4));
});

test("full-pool MMR keeps diversity across pagination boundaries", () => {
  const series = Array.from({ length: 4 }, (_, index) => ({
    subject: { id: 100 + index },
    normalizedScore: 1 - index * 0.01,
    features: { "tag:圣母在上": 1, "tag:校园": 0.8, "tag:百合": 0.8 },
  }));
  const alternatives = Array.from({ length: 12 }, (_, index) => ({
    subject: { id: 200 + index },
    normalizedScore: 0.96 - index * 0.012,
    features: { [`tag:题材${index}`]: 1, [`format:${index % 3}`]: 0.5 },
  }));
  const selected = Core.diversify([...series, ...alternatives], 16, "balanced", "full-pool-test");
  const seriesRanks = selected
    .map((item, index) => (item.subject.id < 200 ? index + 1 : null))
    .filter(Boolean);
  assert.equal(new Set(selected.map((item) => item.subject.id)).size, 16);
  assert.equal(seriesRanks[0], 1);
  assert.ok(seriesRanks[1] > 1);
  assert.ok(seriesRanks[1] <= 5);
});

test("MMR is invariant to the arbitrary scale of relevance scores", () => {
  const pool = Array.from({ length: 8 }, (_, index) => ({
    subject: { id: index + 1 },
    normalizedScore: 0.31 - index * 0.013,
    features: index < 3 ? { "tag:同系列": 1 } : { [`tag:题材${index}`]: 1 },
  }));
  const transformed = pool.map((item) => ({ ...item, normalizedScore: 4 + item.normalizedScore * 0.07 }));
  assert.deepEqual(
    Core.diversify(pool, pool.length, "balanced", "scale-test").map((item) => item.subject.id),
    Core.diversify(transformed, transformed.length, "balanced", "scale-test").map((item) => item.subject.id),
  );
});

test("MMR has no separate same-studio penalty", () => {
  const make = (id, normalizedScore, features) => ({
    subject: { id },
    normalizedScore,
    features,
  });
  const pool = [
    make(1, 1, { "studio:shared": 0.01 }),
    make(2, 0.99, { "studio:shared": 0.01 }),
    make(3, 0.98, { "studio:shared": 0.01 }),
    make(4, 0.97, { "tag:alternative": 1 }),
  ];
  assert.deepEqual(
    Core.diversify(pool, pool.length, "balanced", "studio-test").map((item) => item.subject.id),
    [1, 2, 3, 4],
  );
});

test("supplemental scoring is capped at a weak twenty-percent adjustment", () => {
  const base = {
    personalMean: 7,
    predicted: 7.42,
    normalizedScore: 0.2,
    contentScore: 0.1,
    neighborScore: 0.3,
    qualityScore: 0.4,
    features: { "tag:治愈": 1 },
  };
  const supplemental = {
    ...base,
    predicted: 8.68,
    normalizedScore: 0.8,
    contentScore: 0.7,
    neighborScore: 0.9,
    features: { "tag:治愈": 1, "director:1": 0.35 },
  };
  const blended = Core.blendSupplementalScore(base, supplemental);
  assert.ok(Math.abs(blended.normalizedScore - 0.32) < 1e-12);
  assert.ok(Math.abs(blended.predicted - 7.672) < 1e-12);
  assert.ok(Math.abs(blended.contentScore - 0.22) < 1e-12);
  assert.ok(Math.abs(blended.neighborScore - 0.42) < 1e-12);
  assert.deepEqual(blended.diversityFeatures, base.features);
});

test("collection fingerprints are stable and change with ratings", () => {
  const first = [collection(1, 8, ["科幻"]), collection(2, 7, ["日常"])];
  const reordered = [first[1], first[0]];
  assert.equal(Core.collectionFingerprint(first), Core.collectionFingerprint(reordered));
  const changed = [collection(1, 9, ["科幻"]), collection(2, 7, ["日常"])];
  assert.notEqual(Core.collectionFingerprint(first), Core.collectionFingerprint(changed));
});

test("strictly classifies confirmed Japanese, foreign, and unknown origins", () => {
  const japaneseAnime = Core.classifyJapaneseOrigin({
    id: 201,
    type: 2,
    name: "FLCL",
    infobox: [{ key: "动画制作", value: "GAINAX / Production I.G" }],
  });
  const japaneseBook = Core.classifyJapaneseOrigin({
    id: 202,
    type: 1,
    name: "人類は衰退しました",
    tags: [{ name: "轻小说" }],
  });
  const foreign = Core.classifyJapaneseOrigin({
    id: 203,
    type: 6,
    name: "The Godfather",
    infobox: [{ key: "国家", value: "美国" }],
  });
  const unknown = Core.classifyJapaneseOrigin({ id: 204, type: 4, name: "Untitled Game" });
  assert.equal(japaneseAnime.status, "japanese");
  assert.equal(japaneseBook.status, "japanese");
  assert.equal(foreign.status, "non_japanese");
  assert.equal(unknown.status, "unknown");
});

test("origin metadata filters eligibility without changing recommendation score", () => {
  const rows = [
    collection(1, 10, ["科幻", "悬疑"], { globalScore: 7.2 }),
    collection(2, 9, ["科幻", "轮回"], { globalScore: 7.1 }),
    collection(3, 4, ["后宫", "异世界"], { globalScore: 7.0 }),
    collection(4, 3, ["后宫", "校园"], { globalScore: 6.9 }),
  ];
  const profile = Core.trainProfile(rows);
  const base = subject(205, 7.4, ["科幻", "悬疑"]);
  const enriched = {
    ...base,
    originMetadata: { ...base, infobox: [{ key: "国家", value: "日本" }] },
  };
  assert.equal(Core.scoreSubject(base, profile).normalizedScore, Core.scoreSubject(enriched, profile).normalizedScore);
  assert.equal(Core.classifyJapaneseOrigin(enriched).status, "japanese");
});

test("calendar-like tags never enter profile features", () => {
  const vector = Core.buildFeatureVector(
    subject(301, 8, ["2024-07", "2025夏", "2024年7月番", "7月番", "2020s", "科幻"]),
  );
  const tokens = Object.keys(vector.features).filter((token) => token.startsWith("tag:") || token.startsWith("meta:"));
  assert.ok(tokens.includes("tag:科幻"));
  assert.ok(!tokens.some((token) => /2024|2025|2020s|月番/.test(token)));
});

test("form exclusion respects word boundaries and does not flag NOVA-like titles", () => {
  assert.equal(Core.candidateExclusion({ name: "NOVA Science Now", type: 2, eps: 24 }), null);
  assert.equal(Core.candidateExclusion({ name: "Superpowers!", type: 2, eps: 13 }), null);
  assert.equal(Core.candidateExclusion({ name: "Example OVA", type: 2 }), "movie-or-special");
  assert.equal(Core.candidateExclusion({ name: "Example SP", type: 2 }), "movie-or-special");
});

test("co-productions count both country tokens instead of defaulting to foreign", () => {
  const coProduction = Core.classifyJapaneseOrigin({
    id: 302,
    type: 2,
    name: "Cross Border",
    infobox: [{ key: "国家", value: "日本／美国" }],
  });
  assert.notEqual(coProduction.status, "non_japanese");
  assert.equal(Core.classifyJapaneseOrigin({
    id: 303, type: 2, name: "Pure Import", infobox: [{ key: "国家", value: "美国" }],
  }).status, "non_japanese");
  assert.equal(Core.classifyJapaneseOrigin({
    id: 304, type: 2, name: "Pure Domestic", infobox: [{ key: "国家", value: "日本" }],
  }).status, "japanese");
});
