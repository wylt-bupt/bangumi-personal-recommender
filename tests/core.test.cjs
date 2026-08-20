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
  const confidenceParts = Object.values(liked.confidenceBreakdown).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(confidenceParts - liked.confidenceScore) < 1e-12);
  assert.ok(liked.confidenceScore >= 0 && liked.confidenceScore <= 1);
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

test("collection fingerprints are stable and change with ratings", () => {
  const first = [collection(1, 8, ["科幻"]), collection(2, 7, ["日常"])];
  const reordered = [first[1], first[0]];
  assert.equal(Core.collectionFingerprint(first), Core.collectionFingerprint(reordered));
  const changed = [collection(1, 9, ["科幻"]), collection(2, 7, ["日常"])];
  assert.notEqual(Core.collectionFingerprint(first), Core.collectionFingerprint(changed));
});

test("classifies Japanese and non-Japanese books from structured metadata", () => {
  const japanese = Core.classifyBookOrigin({
    id: 201,
    type: 1,
    name: "文学少女と死にたがりの道化",
    tags: [{ name: "轻小说" }],
    infobox: [
      { key: "出版社", value: "エンターブレイン" },
      { key: "文库", value: "ファミ通文庫" },
    ],
  });
  const nonJapanese = Core.classifyBookOrigin({
    id: 202,
    type: 1,
    name: "A Game of Thrones",
    tags: [{ name: "欧美" }],
    infobox: [
      { key: "国家", value: "美国" },
      { key: "出版社", value: "Bantam Spectra" },
    ],
  });
  const unknown = Core.classifyBookOrigin({ id: 203, type: 1, name: "The Long Way Home" });
  assert.equal(japanese.status, "japanese");
  assert.equal(nonJapanese.status, "non_japanese");
  assert.equal(unknown.status, "unknown");
});

test("only allows a non-Japanese book when every exceptional threshold is met", () => {
  const base = {
    confidenceScore: 0.84,
    predicted: 8.7,
    contentScore: 0.64,
    nearest: { similarity: 0.42 },
    positiveReasons: [{}, {}],
  };
  assert.equal(Core.isExceptionalForeignRecommendation(base), true);
  assert.equal(Core.isExceptionalForeignRecommendation({ ...base, predicted: 8.4 }), false);
  assert.equal(Core.isExceptionalForeignRecommendation({ ...base, confidenceScore: 0.7 }), false);
});
