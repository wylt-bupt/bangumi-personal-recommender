const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/core.cjs");

function subject(id, score, tags, extra = {}) {
  return {
    id,
    type: 2,
    name: `Subject ${id}`,
    name_cn: `条目 ${id}`,
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

test("keeps direct adult tags and requires corroboration for ambiguous rating tags", () => {
  assert.equal(Core.isAdultRecommendationCandidate(subject(30, 7, ["里番", "OVA"])), false);
  assert.equal(Core.isAdultRecommendationCandidate(subject(30, 7, ["里番", "OVA"]), true), true);
  assert.equal(Core.isAdultRecommendationCandidate(subject(31, 7, ["成人动画"])), true);
  assert.equal(Core.isAdultRecommendationCandidate(subject(32, 7, ["R18", "18禁"])), false);
  assert.equal(Core.isAdultRecommendationCandidate(subject(38, 7, ["里番", "18X"])), true);
  assert.equal(Core.isAdultRecommendationCandidate(subject(33, 7, ["R18", "无码"])), true);
  assert.equal(Core.isAdultRecommendationCandidate(subject(36, 7, ["里番", "成人三部曲"])), true);
  assert.equal(Core.isAdultRecommendationCandidate(subject(34, 7, ["R18", "血腥", "猎奇"])), false);
  assert.equal(Core.isAdultRecommendationCandidate(subject(35, 7, ["18X", "OVA", "BL"])), false);
  assert.equal(Core.isAdultRecommendationCandidate(subject(37, 7, ["里番", "治愈", "日本"])), false);
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

test("extracts infobox credits for display without changing the original ranking vector", () => {
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
  const vector = Core.buildFeatureVector({ ...subject(11, 8, ["科幻"]), infobox });
  assert.equal(vector.features["studio:name:white fox"], undefined);
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

test("learns positive and negative tag preference from rating residuals", () => {
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
