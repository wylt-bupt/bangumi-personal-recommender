(function attachRecommendationFeed(globalObject) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const OWNER = "wylt";

  function normalizeCandidate(row) {
    const subject = row?.subject || {};
    const id = Number(subject.id);
    const predicted = Number(row?.predicted);
    if (!Number.isSafeInteger(id) || id <= 0 || Number(subject.type) !== 2 ||
        !Number.isFinite(predicted) || predicted < 1 || predicted > 10) return null;
    return {
      subject: {
        id,
        type: 2,
        name: String(subject.name || ""),
        nameCn: String(subject.nameCn || subject.name_cn || ""),
        image: String(subject.image || ""),
        tags: Array.isArray(subject.tags) ? subject.tags.filter((tag) => typeof tag === "string" && tag.trim()).slice(0, 12) : [],
        rating: {
          score: Number.isFinite(Number(subject.rating?.score)) ? Number(subject.rating.score) : 0,
          total: Number.isFinite(Number(subject.rating?.total)) ? Math.max(0, Number(subject.rating.total)) : 0,
        },
      },
      predicted,
      reasons: Array.isArray(row.reasons) ? row.reasons.map(String).filter(Boolean).slice(0, 3) : [],
      collaborativeLift: Number(row.collaborativeLift) || 0,
    };
  }

  function parseFeed(raw) {
    if (raw?.schema !== SCHEMA_VERSION || raw?.owner !== OWNER ||
        !Number.isFinite(Date.parse(raw.generatedAt)) || !Array.isArray(raw.candidates)) {
      throw new Error("推荐数据版本不兼容，请稍后更新组件。");
    }
    const seen = new Set();
    const candidates = [];
    for (const row of raw.candidates.slice(0, 2000)) {
      const item = normalizeCandidate(row);
      if (!item || seen.has(item.subject.id)) continue;
      seen.add(item.subject.id);
      candidates.push(item);
    }
    if (candidates.length < 5) throw new Error("推荐数据暂时不足，请稍后再试。");
    candidates.sort((left, right) => right.predicted - left.predicted || left.subject.id - right.subject.id);
    return {
      generatedAt: raw.generatedAt,
      peerCount: Math.max(0, Number(raw.peerCount) || 0),
      neighborCount: Math.max(0, Number(raw.neighborCount) || 0),
      ratedCount: Math.max(0, Number(raw.ratedCount) || 0),
      model: raw.model === "joint" ? "joint" : "content",
      candidates,
    };
  }

  function unmarkedCandidates(feed, collectionRows) {
    const marked = new Set((Array.isArray(collectionRows) ? collectionRows : [])
      .map((row) => Number(row.subject_id || row.subjectId))
      .filter(Number.isSafeInteger));
    return feed.candidates.filter((row) => !marked.has(row.subject.id));
  }

  const api = { SCHEMA_VERSION, OWNER, parseFeed, unmarkedCandidates };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalObject.BangumiRecommendationFeed = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
