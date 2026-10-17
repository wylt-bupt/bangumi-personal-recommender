// Candidate eligibility rules for the offline monthly feed build.
// v1 deterministic heuristics, actively bypassed by nothing at runtime:
// the userscript renders the feed as built. An AI-assisted classifier may
// replace these judgments later; keep that seam inside this module only.
"use strict";

// Content/genere descriptors must never become franchise keys: they describe
// the requested mood, not a shared story universe.
const CONTENT_TAG_PATTERN = /(?:治[愈癒]|致郁|日常|恋爱|愛情|纯爱|校園|校园|青春|成长|百合|耽美|\bbl\b|\bgl\b|科幻|奇幻|魔幻|悬疑|推理|恐怖|惊悚|猎奇|黑暗|压抑|扭曲|虚无|空虚|孤独|冒险|战争|历史|社会|政治|职场|家庭|亲情|友情|喜剧|搞笑|爆笑|吐槽|电波|意识流|群像|公路|音乐|运动|竞技|偶像|机战|机器人|超能力|异世界|穿越|轮回|时间|末日|灾难|犯罪|侦探|心理|哲学|文学|童话|自传|私小说|催泪|感动|热血|萌|美食|旅行|剧情|后宫|ntr|胃[疼痛药]|内涵|经典|轻小说|輕小說|漫画|漫畫|小说改|漫改|gal改|游戏改|原创|原創|乱伦|工口|成人|里番|r18|ova|oad|剧场版|劇場版|一卷全|短篇|长篇)/i;

// Universally generic or self-referential tags; not usable as franchise keys.
const FRANCHISE_STOP_TAGS = new Set([
  "tv", "日本", "动画", "動畫", "anime", "アニメ", "系列", "书籍", "書籍", "book", "小说", "小説",
  "小说系列", "小說系列", "补番", "補番", "神作", "佳作", "名作", "自用", "已购", "已購",
  "剧场", "电影", "映画", "web", "精选", "合集", "特典", "字幕",
]);

// Substrings that mark a non-Japanese origin. Japanese co-productions tagged
// with both e.g. “日本” and a country marker stay included unless another
// rule fires, because “日本” overrides the marker for that single tag.
const NON_JAPAN_MARKERS = [
  "欧美", "美国", "英国", "法国", "加拿大", "德国", "西班牙", "丹麦", "挪威", "瑞典", "芬兰",
  "意大利", "俄罗斯", "苏联", "波兰", "捷克", "匈牙利", "澳大利亚", "新西兰", "爱尔兰",
  "荷兰", "比利时", "瑞士", "奥地利", "葡萄牙", "希腊", "以色列", "土耳其", "伊朗", "印度",
  "巴西", "墨西哥", "阿根廷", "埃及", "哥伦比亚", "南非", "韩国", "台湾", "香港", "港台",
  "中国", "国产", "非日本", "大陆", "内地", "西方", "朝鲜", "泰国", "马来西亚", "新加坡",
];

// Release-variant suffixes; stripping them maps sequels/specials back to the
// base franchise title when no embedded franchise tag exists.
const SUFFIX_PATTERN = new RegExp("(?:第?\\s*[0-9〇一二三四五六七八九十百]+\\s*(?:季|期|部|章|篇|话|話|卷|幕)?\\s*$"
  + "|(?:season|saison)\\s*[0-9]+$|(?:[0-9]+(?:st|nd|rd|th))?\\s*season$|part\\s*[0-9ivx]+$|第\\s*[0-9]+\\s*season$"
  + "|ova$|oad$|外传$|外傳$|番外$|特别篇$|特別篇$|总集篇$|總集篇$|総集編$|精选集$|精選集$"
  + "|剧场版$|劇場版$|剧场版：[^\\u4e00-\\u9fa5|]*|movie$|映画$"
  + "|续篇$|續篇$|続編$|新剧场版$|前篇$|后篇$|後篇$|上篇$|下篇$|完结篇$|完結篇$|终章$|最終章$|最终章$|追忆篇$)", "i");

function tagsOf(subject) {
  return [...new Set((Array.isArray(subject?.tags) ? subject.tags : [])
    .map((tag) => (typeof tag === "string" ? tag : tag?.name || ""))
    .map((tag) => tag.trim())
    .filter(Boolean))];
}

function isJapaneseOrigin(subject) {
  for (const rawTag of tagsOf(subject)) {
    const tag = rawTag.toLocaleLowerCase("zh-CN");
    if (!tag) continue;
    if (tag.includes("非日本")) return false;
    if (tag.includes("日本")) continue;
    if (tag === "中国风" || tag === "中国元素") continue;
    if (NON_JAPAN_MARKERS.some((marker) => tag.includes(marker))) return false;
  }
  return true;
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

function aliasText(value) {
  return normalizeText(value)
    .replace(/岡/g, "冈").replace(/磨里/g, "麿里").replace(/[瀬瀨]/g, "濑").replace(/戸/g, "户")
    .replace(/間/g, "间").replace(/類/g, "类").replace(/後/g, "后").replace(/國/g, "国")
    .replace(/島/g, "岛").replace(/學/g, "学").replace(/樂/g, "乐").replace(/[辺邊邉]/g, "边")
    .replace(/葉/g, "叶").replace(/澤/g, "泽").replace(/[\s._・·—–:,，()（）"'“”~～→【】[\]「」]+/g, "");
}

function franchiseKey(subject) {
  const nameCn = String(subject?.name_cn || subject?.nameCn || "");
  const name = String(subject?.name || "");
  const tags = tagsOf(subject);
  const title = aliasText(nameCn || name);
  // The SHORTEST embedded tag names the franchise core (银魂 wins over 精选集
  // inside 银魂精选集; 高达 inside 机动战士高达0080).
  const embedded = tags.map((rawTag) => aliasText(rawTag))
    .filter((key) => key.length >= 2 && key.length <= 12
      && !FRANCHISE_STOP_TAGS.has(key)
      && !CONTENT_TAG_PATTERN.test(key)
      && !/^(19|20)\d{2}/.test(key)
      && !(/^[\u0021-\u007E]+$/.test(key) && key.length <= 2) // two-letter ASCII embeds collide (“sp”→“SPY”)
      && title.includes(key))
    .sort((left, right) => left.length - right.length)[0];
  if (embedded) return `tag:${embedded}`;
  const stripped = title.replace(SUFFIX_PATTERN, "").trim();
  return `title:${stripped || title || Number(subject?.id) || 0}`;
}

function markedFranchiseKeys(rows) {
  const keys = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const subject = row?.subject || row || {};
    const type = Number(subject.type);
    if (Number.isFinite(type) && type !== 2) continue; // only marked animation counts
    const key = franchiseKey(subject);
    if (key && key !== `title:${Number(subject.id) || 0}`) keys.add(key);
  }
  return keys;
}

/**
 * @returns {null|"origin"|"watchedFranchise"} null keeps the candidate.
 */
function excludeReason(subject, markedKeys) {
  if (!isJapaneseOrigin(subject)) return "origin";
  if (markedKeys instanceof Set && markedKeys.has(franchiseKey(subject))) return "watchedFranchise";
  return null;
}

module.exports = { isJapaneseOrigin, franchiseKey, markedFranchiseKeys, excludeReason, tagsOf };
