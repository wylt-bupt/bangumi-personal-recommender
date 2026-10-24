(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BangumiRecommenderCore = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  /* ── 标签分数库 ──
     数据来自我评过分的条目（rate > 0，不限收藏状态——想看/看过/抛弃都算，
     只要打了分）身上的全站用户标注标签（subject.tags，不是我自己的标注）。
     我对该作品的 10 分制评分就是每个标签在该作品下获得的分数；
     标签分数 = 这些得分的均分（1-10）。标签可以是字符串或 {name} 对象。 */
  function tagNames(tags) {
    const names = [];
    for (const tag of tags || []) {
      const name = typeof tag === 'string' ? tag : tag && typeof tag.name === 'string' && tag.name;
      if (name) names.push(name);
    }
    return names;
  }
  function buildTagDb(ratedRows) {
    const acc = new Map();
    for (const row of ratedRows || []) {
      const rate = Number(row && row.rate);
      const tags = tagNames(row && row.subject && row.subject.tags);
      if (!(rate > 0) || !tags.length) continue;
      for (const name of tags) {
        const entry = acc.get(name) || { sum: 0, n: 0 };
        entry.sum += rate;
        entry.n += 1;
        acc.set(name, entry);
      }
    }
    const db = new Map();
    for (const [name, entry] of acc) db.set(name, entry.sum / entry.n);
    return db;
  }

  /* 未评分作品的标签分：它身上所有用户标签的标签分数均分 ÷ 2（1-5）。
     一个已知标签都没有时返回 null，届时推荐评分只由全站分构成。 */
  function tagScore(tags, tagDb) {
    const known = [];
    for (const name of tagNames(tags)) {
      const score = tagDb ? tagDb.get(name) : undefined;
      if (Number.isFinite(score)) known.push(score);
    }
    if (!known.length) return null;
    return known.reduce((sum, value) => sum + value, 0) / known.length / 2;
  }

  /* ── 候选池评分 ──
     rows 是排行榜接口的条目列表项（自带 platform / tags / rating）。
     排除：我已打分的条目（ratedIds；仅收藏未评分的照常参与）、全站评分
     人数不足 500 的、platform 为 OVA 的。单项分数 1-5：全站分 ÷ 2；
     标签分 = 标签均分 ÷ 2；推荐评分 = 两项加权平均（全站 3 : 标签 7，
     标签分是探索因子，避免全站口碑主导排序），保留 2 位小数。
     排序：推荐评分降序，同分按全站评分人数多者优先。 */
  const MIN_RATINGS = 500;
  const SITE_WEIGHT = 3, TAG_WEIGHT = 7;
  function scoreCandidates(rows, tagDb, ratedIds, minRatings = MIN_RATINGS) {
    const floor = Number.isFinite(minRatings) ? minRatings : MIN_RATINGS;
    const scored = [];
    for (const subject of rows || []) {
      const id = Number(subject && subject.id);
      const rating = (subject && subject.rating) || {};
      const total = Number(rating.total) || 0;
      if (!Number.isSafeInteger(id) || id <= 0 || (ratedIds && ratedIds.has(id))) continue;
      if (total < floor) continue;
      if (subject.platform === 'OVA') continue;
      const site = (Number(rating.score) || 0) / 2;
      const tag = tagScore(subject.tags, tagDb);
      scored.push({
        id,
        name: (subject.name || '').trim(),
        nameCn: (subject.name_cn || '').trim(),
        image: (subject.images && (subject.images.common || subject.images.medium || subject.images.large)) || '',
        platform: subject.platform || '',
        site,
        tag,
        total,
        final: Number((tag == null ? site : (site * SITE_WEIGHT + tag * TAG_WEIGHT) / (SITE_WEIGHT + TAG_WEIGHT)).toFixed(2)),
      });
    }
    scored.sort((a, b) => b.final - a.final || b.total - a.total || a.id - b.id);
    return scored;
  }

  /* ── 资格复核与选优 ──
     候选自身关联条目（relationsOf 注入带缓存的采集）中出现我已评分的作品
     且关系标注为「不同演绎」时排除；按得分从高到低取满 limit 部为止。 */
  const EXCLUDED_RELATION = '不同演绎';
  async function selectTop(scored, limit, ratedIds, relationsOf) {
    const selected = [];
    const excluded = [];
    for (const candidate of scored || []) {
      if (selected.length >= limit) break;
      const relations = (await relationsOf(candidate.id)) || [];
      const isRemake = relations.some(entry => entry && entry.relation === EXCLUDED_RELATION && ratedIds.has(Number(entry.id)));
      if (isRemake) {
        excluded.push(candidate.id);
        continue;
      }
      selected.push(candidate);
    }
    return { selected, excluded };
  }

  return { MIN_RATINGS, EXCLUDED_RELATION, buildTagDb, tagScore, scoreCandidates, selectTop };
});
