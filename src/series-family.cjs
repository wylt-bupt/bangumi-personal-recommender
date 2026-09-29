// Series grouping for offline validation only, extracted without changing the
// established heuristic. This module has no legacy recommendation policy.
"use strict";

const CONTENT_TAG_PATTERN = /(?:治[愈癒]|致郁|日常|恋爱|愛情|纯爱|校園|校园|青春|成长|百合|耽美|\bbl\b|\bgl\b|科幻|奇幻|魔幻|悬疑|推理|恐怖|惊悚|猎奇|黑暗|压抑|扭曲|虚无|空虚|孤独|冒险|战争|历史|社会|政治|职场|家庭|亲情|友情|喜剧|搞笑|爆笑|吐槽|电波|意识流|群像|公路|音乐|运动|竞技|偶像|机战|机器人|超能力|异世界|穿越|轮回|时间|末日|灾难|犯罪|侦探|心理|哲学|文学|童话|自传|私小说|催泪|感动|热血|萌|美食|旅行|剧情|后宫|ntr|胃[疼痛药]|内涵|经典|轻小说|輕小說|漫画|漫畫|小说改|漫改|gal改|游戏改|原创|原創|乱伦|工口|成人|里番|r18|ova|oad|剧场版|劇場版|一卷全|短篇|长篇)/i;
const GENERIC_TAGS = new Set([
  "tv", "日本", "动画", "動畫", "anime", "アニメ", "书籍", "書籍", "book", "小说", "小説",
  "系列", "小说系列", "小說系列", "补番", "補番", "神作", "佳作", "名作", "自用", "已购", "已購",
]);

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

function alias(value) {
  return normalizeText(value)
    .replace(/岡/g, "冈").replace(/磨里/g, "麿里").replace(/[瀬瀨]/g, "濑")
    .replace(/戸/g, "户").replace(/間/g, "间").replace(/類/g, "类")
    .replace(/後/g, "后").replace(/國/g, "国").replace(/島/g, "岛")
    .replace(/學/g, "学").replace(/樂/g, "乐").replace(/[辺邊邉]/g, "边")
    .replace(/葉/g, "叶").replace(/澤/g, "泽").replace(/[\s._・·—–-]+/g, "");
}

function seriesFamilyKey(raw = {}) {
  const nameCn = String(raw.name_cn || raw.nameCn || "");
  const name = String(raw.name || "");
  const id = Number(raw.id || raw.subject_id || 0);
  const tags = [...new Set((Array.isArray(raw.tags) ? raw.tags : [])
    .map(tag => typeof tag === "string" ? tag : tag?.name).map(normalizeText).filter(Boolean))];
  const title = alias(nameCn || name);
  const embedded = tags.map(alias)
    .filter(tag => tag.length >= 3 && title.includes(tag) && !GENERIC_TAGS.has(tag) && !CONTENT_TAG_PATTERN.test(tag))
    .sort((left, right) => left.length - right.length)[0];
  if (embedded) return `tag:${embedded}`;
  const stripped = title
    .replace(/(?:第?[0-9一二三四五六七八九十]+(?:期|季|部|章)|season[0-9]+|[0-9]+(?:st|nd|rd|th)?season|part[0-9]+)$/i, "")
    .replace(/(?:续篇|續篇|続編|续|續|2nd|second)$/i, "");
  return `title:${stripped || title || id}`;
}

module.exports = { seriesFamilyKey };
