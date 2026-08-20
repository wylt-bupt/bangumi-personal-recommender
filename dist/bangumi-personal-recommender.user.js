// ==UserScript==
// @name         Bangumi 个性推荐
// @namespace    https://bgm.tv/user/wylt
// @version      0.2.4
// @description  根据个人收藏、评分和标签，在未标记条目中推荐最适合的 5 个。
// @author       wylt
// @match        https://bgm.tv/*
// @match        http://bgm.tv/*
// @match        https://bangumi.tv/*
// @match        http://bangumi.tv/*
// @match        https://chii.in/*
// @match        http://chii.in/*
// ==/UserScript==

(function attachBangumiRecommenderCore(globalObject) {
  "use strict";

  const SUBJECT_TYPES = Object.freeze({
    1: { label: "书籍", slug: "book" },
    2: { label: "动画", slug: "anime" },
    3: { label: "音乐", slug: "music" },
    4: { label: "游戏", slug: "game" },
    6: { label: "三次元", slug: "real" },
  });

  const COLLECTION_STATUS = Object.freeze({
    1: "wish",
    2: "collect",
    3: "doing",
    4: "on_hold",
    5: "dropped",
  });

  const ROLE_WEIGHTS = Object.freeze({
    tag: 1,
    meta: 0.9,
    director: 0.35,
    studio: 0.28,
    creator: 0.25,
    series: 0.2,
    script: 0.2,
    music: 0.15,
    cv: 0.07,
    decade: 0.22,
    format: 0.2,
  });

  const ROLE_SHRINKAGE = Object.freeze({
    tag: 4,
    meta: 4,
    director: 2.5,
    studio: 4,
    creator: 3,
    series: 3,
    script: 3,
    music: 4,
    cv: 7,
    decade: 8,
    format: 6,
  });

  const ROLE_MIN_SUPPORT = Object.freeze({
    tag: 2,
    meta: 2,
    director: 2,
    studio: 3,
    creator: 2,
    series: 2,
    script: 2,
    music: 3,
    cv: 4,
    decade: 4,
    format: 3,
  });

  const TEMPORAL_TAG = /^(?:19|20)\d{2}(?:年(?:[147]|10)月)?$|^(?:19|20)\d0s$/i;
  const FORMAT_TAGS = new Set(["tv", "剧场版", "劇場版", "ova", "oad", "web", "泡面番"]);
  const CONTENT_TAG_PATTERN = /(?:治[愈癒]|致郁|日常|恋爱|愛情|纯爱|校園|校园|青春|成长|百合|耽美|\bbl\b|\bgl\b|科幻|奇幻|魔幻|悬疑|推理|恐怖|惊悚|猎奇|黑暗|压抑|虚无|空虚|孤独|冒险|战争|历史|社会|政治|职场|家庭|亲情|友情|喜剧|搞笑|爆笑|吐槽|电波|意识流|群像|公路|音乐|运动|竞技|偶像|机战|机器人|超能力|异世界|穿越|轮回|时间|末日|灾难|犯罪|侦探|心理|哲学|文学|童话|自传|私小说|催泪|感动|热血|萌|美食|旅行|剧情|后宫|ntr|胃疼|内涵|经典|轻小说|輕小說|漫画|漫畫|小说改|漫改|gal改|游戏改|原创|原創|ova|oad|剧场版|劇場版|一卷全|短篇|长篇)/i;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  }

  function mean(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("zh-CN");
  }

  function tokenPrefix(token) {
    return String(token).split(":", 1)[0];
  }

  function normalizeTagList(tags) {
    if (!Array.isArray(tags)) return [];
    const normalized = tags
      .map((tag) => (typeof tag === "string" ? tag : tag?.name))
      .map(normalizeText)
      .filter(Boolean);
    return [...new Set(normalized)];
  }

  function infoboxValueText(value) {
    if (Array.isArray(value)) return value.map(infoboxValueText).filter(Boolean).join(" ");
    if (value && typeof value === "object") {
      return [value.k, value.v, value.value, value.name]
        .map(infoboxValueText)
        .filter(Boolean)
        .join(" ");
    }
    return String(value ?? "").trim();
  }

  function normalizeInfoboxEntries(infobox) {
    if (!Array.isArray(infobox)) return [];
    return infobox
      .map((entry) => ({
        key: normalizeText(entry?.key || entry?.k || ""),
        value: normalizeText(infoboxValueText(entry?.value ?? entry?.v ?? entry)),
      }))
      .filter((entry) => entry.key || entry.value);
  }

  function normalizeSubject(raw = {}) {
    const rating = raw.rating || {};
    const date = String(raw.date || raw.air_date || "");
    return {
      id: Number(raw.id || raw.subject_id || 0),
      type: Number(raw.type || raw.subject_type || 0),
      name: String(raw.name || ""),
      nameCn: String(raw.name_cn || raw.nameCn || ""),
      date,
      image:
        raw.image ||
        raw.images?.common ||
        raw.images?.medium ||
        raw.images?.small ||
        "",
      tags: normalizeTagList(raw.tags),
      metaTags: normalizeTagList(raw.meta_tags || raw.metaTags),
      rating: {
        score: Number(rating.score || raw.score || 0),
        total: Number(rating.total || raw.rating_total || 0),
      },
      rank: Number(raw.rank || 0),
      infobox: Array.isArray(raw.infobox || raw.infoBox) ? raw.infobox || raw.infoBox : [],
      summary: String(raw.summary || ""),
      persons: Array.isArray(raw.persons || raw._persons) ? raw.persons || raw._persons : [],
      characters: Array.isArray(raw.characters || raw._characters)
        ? raw.characters || raw._characters
        : [],
      relation: String(raw.relation || ""),
      sourceUrl: String(raw.sourceUrl || ""),
    };
  }

  function classifyJapaneseOrigin(subjectInput) {
    const source = subjectInput?.originMetadata || subjectInput || {};
    const subject = normalizeSubject(source);
    const entries = normalizeInfoboxEntries(subject.infobox);
    const tagText = normalizeText([...subject.tags, ...subject.metaTags].join(" "));
    const titleText = normalizeText(`${subject.name} ${subject.nameCn}`);
    const infoText = entries.map((entry) => `${entry.key} ${entry.value}`).join(" ");
    const evidence = [];
    let japaneseScore = 0;
    let foreignScore = 0;
    let explicitJapanese = false;
    let explicitForeign = false;

    const countryKey = /(?:国家|國家|地区|地區|原产|原產|制作国|製作国|製作國|country|region)/i;
    const japaneseCountry = /(?:^|\s)(?:日本|japan|japanese)(?:\s|$)/i;
    const foreignCountry = /(?:美国|美國|英国|英國|法国|法國|德国|德國|中国|中國|韩国|韓國|俄国|俄國|俄罗斯|俄羅斯|加拿大|澳大利亚|澳大利亞|意大利|西班牙|印度|泰国|泰國|united states|united kingdom|america|britain|france|germany|china|korea|russia|canada|australia|italy|spain|india|thailand)/i;
    for (const entry of entries) {
      if (!countryKey.test(entry.key)) continue;
      if (japaneseCountry.test(` ${entry.value} `)) explicitJapanese = true;
      if (foreignCountry.test(entry.value)) explicitForeign = true;
    }

    if (/(?:日本|日漫|日本动画|日本動畫|日剧|日劇|日影|日本电影|日本電影|j-?pop|アニソン|同人音楽|同人音乐|東方|东方project|vocaloid|特撮|特摄|轻小说|輕小說|ライトノベル|galgame|eroge|jrpg)/i.test(tagText)) {
      japaneseScore += 2;
      evidence.push("日系标签");
    }
    if (/(?:欧美|歐美|美剧|美劇|英剧|英劇|韩剧|韓劇|国产|國產|中国动画|中國動畫|韩漫|韓漫|美漫|k-?pop)/i.test(tagText)) {
      foreignScore += 3;
      evidence.push("非日系标签");
    }
    if (/[ぁ-ゖァ-ヺ]/.test(subject.name)) {
      japaneseScore += 2;
      evidence.push("日文原名");
    }

    const japaneseInstitution = /(?:gainax|production\s*i\.?g|shaft|a-1\s*pictures|cloverworks|mappa|madhouse|ufotable|trigger|bones|sunrise|サンライズ|京都アニメーション|京アニ|東映|toei|tms|wit\s*studio|studio\s*deen|j\.?c\.?staff|ぴえろ|日本アニメーション|aniplex|kadokawa|角川|講談社|讲谈社|集英社|小学館|小学馆|芳文社|白泉社|双葉社|双叶社|徳間書店|德间书店|電撃|电击|key\s*sounds\s*label|sony\s*music\s*japan|avex|lantis|日本テレビ|テレビ朝日|テレビ東京|フジテレビ|nhk)/i;
    if (japaneseInstitution.test(infoText)) {
      japaneseScore += 3;
      evidence.push("日本机构");
    }

    if (explicitJapanese && !explicitForeign) {
      return { status: "japanese", confidence: 1, evidence: ["明确日本地区", ...evidence] };
    }
    if (explicitForeign && !explicitJapanese) {
      return { status: "non_japanese", confidence: 1, evidence: ["明确非日本地区", ...evidence] };
    }
    if (japaneseScore >= 3 && japaneseScore >= foreignScore + 2) {
      return { status: "japanese", confidence: clamp(japaneseScore / 5, 0, 1), evidence };
    }
    if (foreignScore >= 3) {
      return { status: "non_japanese", confidence: clamp(foreignScore / 5, 0, 1), evidence };
    }
    return { status: "unknown", confidence: 0, evidence };
  }

  function normalizeCollection(raw = {}) {
    const subject = normalizeSubject(raw.subject || raw);
    const type = Number(raw.type || raw.collection_type || 0);
    return {
      subjectId: Number(raw.subject_id || subject.id || 0),
      type,
      status: COLLECTION_STATUS[type] || String(raw.status || "unknown"),
      rate: Number(raw.rate || 0),
      tags: normalizeTagList(raw.tags),
      comment: String(raw.comment || ""),
      updatedAt: String(raw.updated_at || raw.updatedAt || ""),
      subject,
    };
  }

  function normalizeRole(relation) {
    const value = normalizeText(relation);
    if (!value) return null;
    if (/(动画制作|動畫製作|アニメーション制作|animation production|制作会社|studio)/i.test(value)) {
      return "studio";
    }
    if (/(总导演|總導演|导演|導演|監督|director)/i.test(value)) return "director";
    if (/(原作|作者|creator|original work)/i.test(value)) return "creator";
    if (/(系列构成|系列構成|シリーズ構成|series composition)/i.test(value)) return "series";
    if (/(脚本|劇本|剧本|scenario|screenplay)/i.test(value)) return "script";
    if (/(音乐|音樂|音楽|music)/i.test(value)) return "music";
    return null;
  }

  function normalizeInfoboxRole(keyInput) {
    const key = normalizeText(keyInput);
    if (/^(?:动画制作|動畫製作|アニメーション制作|制作会社|制作公司|studio)$/.test(key)) return "studio";
    if (/^(?:总导演|總導演|导演|導演|監督|director)$/.test(key)) return "director";
    if (/^(?:原作|作者|原作者|creator|original work)$/.test(key)) return "creator";
    if (/^(?:系列构成|系列構成|シリーズ構成|series composition)$/.test(key)) return "series";
    if (/^(?:脚本|劇本|剧本|scenario|screenplay)$/.test(key)) return "script";
    if (/^(?:音乐|音樂|音楽|music)$/.test(key)) return "music";
    return null;
  }

  function splitCreditNames(valueInput) {
    const rawValue = infoboxValueText(valueInput).replace(/\[[^\]]*]/g, " ");
    const aliases = [...rawValue.matchAll(/[（(]([^()（）]{2,24})[）)]/g)]
      .map((match) => match[1].trim())
      .filter((value) => /[\p{L}]/u.test(value) && !/\d|[、，,;；]/.test(value));
    const primaryNames = rawValue
      .replace(/\([^)]*\)|（[^）]*）|【[^】]*】/g, "")
      .split(/[、，,\/／;；\n]|\s+[&＆]\s+/)
      .map((value) => value
        .replace(/^(?:担当|制作|製作)[:：]\s*/i, "")
      .trim())
      .filter((value) => value && value.length <= 48 && !/^https?:/i.test(value))
      .slice(0, 8);
    return [...new Set([...primaryNames, ...aliases])].slice(0, 8);
  }

  function extractInfoboxCredits(infobox = []) {
    const credits = [];
    for (const entry of infobox) {
      const role = normalizeInfoboxRole(entry?.key || entry?.k || "");
      if (!role) continue;
      for (const label of splitCreditNames(entry?.value ?? entry?.v ?? "")) {
        credits.push({ role, label });
      }
    }
    return credits;
  }

  function creditAlias(value) {
    return normalizeText(value)
      .replace(/[瀬瀨]/g, "濑")
      .replace(/戸/g, "户")
      .replace(/間/g, "间")
      .replace(/類/g, "类")
      .replace(/後/g, "后")
      .replace(/國/g, "国")
      .replace(/島/g, "岛")
      .replace(/學/g, "学")
      .replace(/樂/g, "乐")
      .replace(/[辺邊邉]/g, "边")
      .replace(/葉/g, "叶")
      .replace(/澤/g, "泽")
      .replace(/[\s._・·—–-]+/g, "");
  }

  function addGroupedFeature(groups, role, id, label) {
    if (!id || !ROLE_WEIGHTS[role]) return;
    if (!groups.has(role)) groups.set(role, new Map());
    groups.get(role).set(`${role}:${id}`, String(label || id));
  }

  function buildFeatureVector(subjectInput, collectionTags = []) {
    const subject = normalizeSubject(subjectInput);
    const groups = new Map();
    const labels = {};

    const tagValues = [...new Set([...normalizeTagList(collectionTags), ...subject.tags])]
      .filter((tag) => !TEMPORAL_TAG.test(tag))
      .slice(0, 18);
    for (const tag of tagValues) addGroupedFeature(groups, "tag", tag, tag);

    for (const tag of subject.metaTags.slice(0, 8)) {
      if (!TEMPORAL_TAG.test(tag)) addGroupedFeature(groups, "meta", tag, tag);
    }

    const year = Number.parseInt(subject.date.slice(0, 4), 10);
    if (Number.isFinite(year) && year >= 1900 && year <= 2100) {
      addGroupedFeature(groups, "decade", `${Math.floor(year / 10) * 10}s`, `${Math.floor(year / 10) * 10}年代`);
    }

    const format = [...tagValues, ...subject.metaTags].find((tag) => FORMAT_TAGS.has(tag));
    if (format) addGroupedFeature(groups, "format", format, format.toUpperCase());

    for (const person of subject.persons) {
      const role = normalizeRole(person.relation || person.type || person.career || person.jobs?.join(" "));
      const id = Number(person.id || person.person_id || 0);
      if (role && id) addGroupedFeature(groups, role, id, person.name || person.name_cn || id);
    }

    let actorCount = 0;
    for (const character of subject.characters) {
      const actors = Array.isArray(character.actors)
        ? character.actors
        : character.actor
          ? [character.actor]
          : [];
      for (const actor of actors) {
        if (actorCount >= 8) break;
        const id = Number(actor.id || actor.person_id || 0);
        if (id) {
          addGroupedFeature(groups, "cv", id, actor.name || actor.name_cn || id);
          actorCount += 1;
        }
      }
      if (actorCount >= 8) break;
    }

    const features = {};
    for (const [role, entries] of groups.entries()) {
      const scale = ROLE_WEIGHTS[role] / Math.sqrt(Math.max(1, entries.size));
      for (const [token, label] of entries.entries()) {
        features[token] = scale;
        labels[token] = label;
      }
    }
    return { features, labels };
  }

  function calculateRatingBaseline(collections) {
    const rated = collections.filter((item) => item.rate > 0);
    const userMean = mean(rated.map((item) => item.rate)) || 7;
    const paired = rated.filter((item) => item.subject.rating.score > 0);
    const globalMean = mean(paired.map((item) => item.subject.rating.score)) || 6.8;
    if (paired.length < 5) return { userMean, globalMean, beta: 0.35 };

    let covariance = 0;
    let variance = 0;
    for (const item of paired) {
      const gx = item.subject.rating.score - globalMean;
      covariance += gx * (item.rate - userMean);
      variance += gx * gx;
    }
    const beta = variance > 0 ? clamp(covariance / variance, 0, 1) : 0.35;
    return { userMean, globalMean, beta };
  }

  function expectedRating(subject, baseline) {
    const globalScore = Number(subject.rating?.score || 0);
    if (!globalScore) return baseline.userMean;
    return baseline.userMean + baseline.beta * (globalScore - baseline.globalMean);
  }

  function trainProfile(collectionInputs) {
    const collections = collectionInputs
      .map(normalizeCollection)
      .filter((item) => item.subjectId && item.subject.id);
    const rated = collections.filter((item) => item.rate > 0);
    const baseline = calculateRatingBaseline(collections);
    const stats = new Map();
    const anchors = [];

    for (const item of rated) {
      const vector = buildFeatureVector(item.subject, item.tags);
      const expected = expectedRating(item.subject, baseline);
      const residual = clamp((item.rate - expected) / 2.5, -1.5, 1.5);
      anchors.push({
        subjectId: item.subjectId,
        name: item.subject.nameCn || item.subject.name,
        rate: item.rate,
        residual,
        features: vector.features,
      });

      for (const [token, magnitude] of Object.entries(vector.features)) {
        const current = stats.get(token) || {
          support: 0,
          weightedResidual: 0,
          label: vector.labels[token] || token,
        };
        current.support += 1;
        current.weightedResidual += residual * magnitude;
        stats.set(token, current);
      }
    }

    const featureWeights = {};
    const featureSupport = {};
    const featureLabels = {};
    const ratedCount = Math.max(1, rated.length);
    for (const [token, stat] of stats.entries()) {
      const role = tokenPrefix(token);
      if (stat.support < (ROLE_MIN_SUPPORT[role] || 2)) continue;
      const shrinkage = ROLE_SHRINKAGE[role] || 4;
      const idf = clamp(Math.log((ratedCount + 1) / (stat.support + 1)) + 1, 1, 2.5);
      featureWeights[token] = (stat.weightedResidual / (shrinkage + stat.support)) * idf;
      featureSupport[token] = stat.support;
      featureLabels[token] = stat.label;
    }

    anchors.sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));
    const topFeatures = Object.entries(featureWeights)
      .map(([token, weight]) => ({
        token,
        weight,
        support: featureSupport[token],
        label: featureLabels[token],
      }))
      .sort((a, b) => b.weight - a.weight);

    return {
      version: 1,
      createdAt: new Date().toISOString(),
      ratedCount: rated.length,
      collectionCount: collections.length,
      baseline,
      featureWeights,
      featureSupport,
      featureLabels,
      topFeatures,
      anchors: anchors.slice(0, 80),
    };
  }

  function weightedJaccard(left = {}, right = {}) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    let intersection = 0;
    let union = 0;
    for (const key of keys) {
      const a = Math.abs(Number(left[key] || 0));
      const b = Math.abs(Number(right[key] || 0));
      intersection += Math.min(a, b);
      union += Math.max(a, b);
    }
    return union ? intersection / union : 0;
  }

  function bayesianScore(subject, globalMean = 6.8, minimumVotes = 300) {
    const rating = subject.rating || {};
    const score = Number(rating.score || 0);
    const total = Number(rating.total || 0);
    if (!score || !total) return globalMean;
    return (total / (total + minimumVotes)) * score + (minimumVotes / (total + minimumVotes)) * globalMean;
  }

  function describeToken(token, labels = {}) {
    const role = tokenPrefix(token);
    const raw = labels[token] || token.slice(token.indexOf(":") + 1);
    const roleLabel = {
      tag: "标签",
      meta: "类型",
      director: "导演",
      studio: "制作",
      creator: "原作",
      series: "构成",
      script: "脚本",
      music: "音乐",
      cv: "声优",
      decade: "年代",
      format: "形式",
    }[role];
    return { role, roleLabel: roleLabel || role, label: raw };
  }

  function selectByEvidenceCoverage(entries, characterBudget, coverage = 0.78, minimumRatio = 0.38) {
    const sorted = [...entries]
      .filter((entry) => Number(entry.value || 0) > 0 && entry.label)
      .sort((a, b) => b.value - a.value);
    if (!sorted.length) return [];
    const strongest = sorted[0].value;
    const total = sorted.reduce((sum, entry) => sum + entry.value, 0);
    const selected = [];
    let selectedMass = 0;
    let usedCharacters = 0;
    for (const entry of sorted) {
      const labelLength = [...String(entry.label)].length + (selected.length ? 1 : 0);
      if (selected.length && entry.value < strongest * minimumRatio) break;
      if (selected.length && usedCharacters + labelLength > characterBudget) break;
      selected.push(entry);
      selectedMass += entry.value;
      usedCharacters += labelLength;
      if (selectedMass / total >= coverage) break;
    }
    return selected;
  }

  function selectContentTags(subjectInput, positiveReasons = [], characterBudget = 24) {
    const subject = normalizeSubject(subjectInput);
    const creditAliases = new Set(extractInfoboxCredits(subject.infobox).map((credit) => creditAlias(credit.label)));
    const genericLabels = new Set([
      "tv", "日本", "动画", "動畫", "anime", "アニメ", "书籍", "書籍", "book", "小说", "小説",
      "系列", "小说系列", "小說系列", "补番", "補番", "神作", "佳作", "名作", "自用", "已购", "已購",
    ]);
    const titleAliases = new Set(
      [subject.name, subject.nameCn]
        .map(creditAlias)
        .filter(Boolean),
    );
    for (const entry of subject.infobox) {
      const key = normalizeText(entry?.key || entry?.k || "");
      if (!/(?:别名|別名|中文名|英文名|原名|原題|alias|title)/i.test(key)) continue;
      for (const alias of infoboxValueText(entry?.value ?? entry?.v ?? "").split(/[、，,\/／;；\n]/)) {
        const normalizedAlias = creditAlias(alias);
        if (normalizedAlias) titleAliases.add(normalizedAlias);
      }
    }
    const positiveTagValues = new Map(
      positiveReasons
        .filter((entry) => entry.role === "tag" && Number(entry.value || 0) > 0)
        .map((entry) => [normalizeText(entry.label), Number(entry.value)]),
    );
    const strongestMatch = Math.max(0, ...positiveTagValues.values());
    const ranked = subject.tags
      .map((label, index) => ({
        label,
        matched: positiveTagValues.has(normalizeText(label)),
        score:
          1 / (1 + index * 0.18) +
          (strongestMatch ? 0.55 * Number(positiveTagValues.get(normalizeText(label)) || 0) / strongestMatch : 0),
      }))
      .filter((entry) =>
        entry.label &&
        !TEMPORAL_TAG.test(entry.label) &&
        !genericLabels.has(normalizeText(entry.label)) &&
        !creditAliases.has(creditAlias(entry.label)) &&
        !titleAliases.has(creditAlias(entry.label)) &&
        [...entry.label].length <= 18,
      )
      .sort((a, b) => b.score - a.score);
    const descriptive = ranked.filter((entry) => CONTENT_TAG_PATTERN.test(entry.label));
    const displayPool = descriptive.length ? descriptive : ranked;
    const selected = [];
    const seenFamilies = new Set();
    let usedCharacters = 0;
    for (const entry of displayPool) {
      const normalizedLabel = creditAlias(entry.label).replace(/[.!！。]+$/g, "");
      const family = /(?:轻小说|輕小說|ライトノベル)/i.test(normalizedLabel)
        ? "light-novel"
        : /群像/.test(normalizedLabel)
          ? "ensemble"
          : normalizedLabel;
      if (seenFamilies.has(family)) continue;
      const cost = [...entry.label].length + (selected.length ? 1 : 0);
      if (selected.length && usedCharacters + cost > characterBudget) continue;
      selected.push(entry);
      seenFamilies.add(family);
      usedCharacters += cost;
    }
    return selected;
  }

  function selectRecommendationEvidence(scoredSubject, characterBudget = 108) {
    const roleLabels = {
      director: "导演",
      studio: "制作",
      creator: "原作",
      series: "构成",
      script: "脚本",
      music: "音乐",
    };
    const creditsByAlias = new Map(
      extractInfoboxCredits(scoredSubject?.subject?.infobox).map((credit) => [creditAlias(credit.label), credit]),
    );
    const genericPreferenceLabels = new Set(["tv", "日本", "动画", "動畫", "anime", "アニメ"]);
    const reasons = [...(scoredSubject?.positiveReasons || [])]
      .filter((entry) => Number(entry.value || 0) > 0)
      .map((entry) => {
        if (entry.role !== "tag" && entry.role !== "meta") return entry;
        const credit = creditsByAlias.get(creditAlias(entry.label));
        return credit
          ? { ...entry, role: credit.role, roleLabel: roleLabels[credit.role] || entry.roleLabel, label: credit.label }
          : entry;
      })
      .filter((entry) =>
        (entry.role !== "tag" && entry.role !== "meta") ||
        !genericPreferenceLabels.has(normalizeText(entry.label)),
      )
      .sort((a, b) => b.value - a.value);
    const strongestReason = Number(reasons[0]?.value || 0);
    const candidates = [];
    const creativeRoles = new Set(["director", "studio", "creator", "series", "script", "music", "cv"]);
    const creativeGroups = new Map();
    for (const reason of reasons.filter((entry) => creativeRoles.has(entry.role))) {
      if (!creativeGroups.has(reason.role)) creativeGroups.set(reason.role, []);
      creativeGroups.get(reason.role).push(reason);
    }
    for (const [role, entries] of creativeGroups.entries()) {
      if (strongestReason && entries[0].value < strongestReason * 0.5) continue;
      const selected = selectByEvidenceCoverage(entries, 22, 0.76, 0.45);
      if (!selected.length) continue;
      candidates.push({
        kind: "creative",
        role,
        roleLabel: selected[0].roleLabel,
        reasons: selected,
        strength: selected.reduce((sum, entry) => sum + entry.value, 0) / strongestReason,
        cost: 16 + selected.reduce((sum, entry) => sum + [...entry.label].length, 0),
      });
    }

    const personalMean = Number(scoredSubject?.personalMean || 0);
    const positiveSimilarWorks = (scoredSubject?.similarWorks || [])
      .filter((entry) =>
        Number(entry.residual || 0) > 0 &&
        Number(entry.rate || 0) > 0 &&
        (!personalMean || Number(entry.rate) >= Math.ceil(personalMean)),
      )
      .sort((a, b) => b.similarity - a.similarity);
    const strongestSimilarity = Number(positiveSimilarWorks[0]?.similarity || 0);
    if (strongestSimilarity >= 0.065) {
      const similarityCutoff = Math.max(0.065, strongestSimilarity * 0.72);
      const works = [];
      let usedCharacters = 0;
      for (const work of positiveSimilarWorks) {
        const workLength = [...String(work.name || "")].length + 4;
        if (work.similarity < similarityCutoff) break;
        if (works.length && usedCharacters + workLength > 46) break;
        works.push(work);
        usedCharacters += workLength;
      }
      if (works.length) {
        candidates.push({
          kind: "similarity",
          works,
          strength: 0.3 + strongestSimilarity / 0.2,
          cost: 14 + usedCharacters,
        });
      }
    }

    if (!candidates.length) return [{ kind: "quality", strength: 1, cost: 24 }];

    const selected = [];
    let remaining = Math.max(40, Number(characterBudget) || 108);
    for (const originalCandidate of [...candidates].sort((a, b) => b.strength - a.strength)) {
      let candidate = originalCandidate;
      if (candidate.kind === "similarity" && candidate.cost > remaining && candidate.works.length > 1) {
        const works = [...candidate.works];
        let cost = candidate.cost;
        while (works.length > 1 && cost > remaining) {
          const removed = works.pop();
          cost -= [...String(removed.name || "")].length + 4;
        }
        candidate = { ...candidate, works, cost };
      }
      if (candidate.cost > remaining && selected.length) continue;
      selected.push(candidate);
      remaining -= candidate.cost;
    }
    const order = { similarity: 0, creative: 1, quality: 2 };
    return selected.sort((a, b) => order[a.kind] - order[b.kind]);
  }

  function scoreSubject(subjectInput, profile, mode = "balanced") {
    const subject = normalizeSubject(subjectInput);
    const vector = buildFeatureVector(subject);
    const contributions = Object.entries(vector.features)
      .map(([token, magnitude]) => ({
        token,
        value: magnitude * Number(profile.featureWeights[token] || 0),
        support: Number(profile.featureSupport[token] || 0),
        ...describeToken(token, { ...profile.featureLabels, ...vector.labels }),
      }))
      .filter((entry) => entry.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

    const featureMass = Object.values(vector.features).reduce((sum, value) => sum + Math.abs(value), 0);
    const contentRaw = contributions.reduce((sum, entry) => sum + entry.value, 0) /
      Math.sqrt(Math.max(1, featureMass));
    const content = Math.tanh(contentRaw * 2.2);

    const neighborCandidates = profile.anchors
      .map((anchor) => ({
        anchor,
        similarity: weightedJaccard(vector.features, anchor.features),
      }))
      .filter((entry) => entry.similarity >= 0.04)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 6);
    const similarityMass = neighborCandidates.reduce((sum, entry) => sum + entry.similarity, 0);
    const neighbor = similarityMass
      ? neighborCandidates.reduce(
          (sum, entry) => sum + entry.similarity * entry.anchor.residual,
          0,
        ) / similarityMass
      : 0;

    const bayes = bayesianScore(subject, profile.baseline.globalMean);
    const quality = clamp((bayes - 6.5) / 2.5, -1, 1);
    const weights = {
      stable: { content: 0.5, neighbor: 0.2, quality: 0.3 },
      balanced: { content: 0.6, neighbor: 0.25, quality: 0.15 },
      explore: { content: 0.67, neighbor: 0.25, quality: 0.08 },
    }[mode] || { content: 0.6, neighbor: 0.25, quality: 0.15 };
    const normalizedScore =
      weights.content * content + weights.neighbor * neighbor + weights.quality * quality;
    const predicted = clamp(profile.baseline.userMean + normalizedScore * 2.1, 1, 10);

    const positiveReasons = contributions.filter((entry) => entry.value > 0);
    const negativeReasons = contributions.filter((entry) => entry.value < 0).slice(0, 1);
    const similarWorks = neighborCandidates.map((entry) => ({
      subjectId: entry.anchor.subjectId,
      name: entry.anchor.name,
      rate: entry.anchor.rate,
      residual: entry.anchor.residual,
      similarity: entry.similarity,
    }));
    const nearest = similarWorks[0] || null;
    const confidenceReasons = positiveReasons.slice(0, 3);
    const reasonSupport = confidenceReasons.length
      ? mean(confidenceReasons.map((entry) => entry.support))
      : 0;
    const confidenceBreakdown = {
      featureSupport: clamp(reasonSupport / 12, 0, 0.5),
      neighborEvidence: clamp((nearest?.similarity || 0) / 0.6, 0, 0.3),
      ratingEvidence: clamp(Math.log10(subject.rating.total + 1) / 12, 0, 0.2),
    };
    const confidenceScore = Object.values(confidenceBreakdown).reduce((sum, value) => sum + value, 0);
    const confidence = confidenceScore >= 0.68 ? "高" : confidenceScore >= 0.4 ? "中" : "探索";

    return {
      subject,
      personalMean: profile.baseline.userMean,
      predicted,
      normalizedScore,
      bayesianScore: bayes,
      contentScore: content,
      neighborScore: neighbor,
      qualityScore: quality,
      positiveReasons,
      negativeReasons,
      similarWorks,
      nearest,
      confidence,
      confidenceScore,
      confidenceBreakdown,
      features: vector.features,
    };
  }

  function blendSupplementalScore(baseScore, supplementalScore, supplementalWeight = 0.2) {
    const weight = clamp(supplementalWeight, 0, 1);
    const baseWeight = 1 - weight;
    const blend = (key) =>
      baseWeight * Number(baseScore?.[key] || 0) + weight * Number(supplementalScore?.[key] || 0);
    const normalizedScore = blend("normalizedScore");
    const personalMean = Number(baseScore?.personalMean || supplementalScore?.personalMean || 7);
    return {
      ...supplementalScore,
      personalMean,
      predicted: clamp(personalMean + normalizedScore * 2.1, 1, 10),
      normalizedScore,
      contentScore: blend("contentScore"),
      neighborScore: blend("neighborScore"),
      qualityScore: blend("qualityScore"),
      diversityFeatures: baseScore?.features || supplementalScore?.features || {},
    };
  }

  function seededNoise(subjectId, salt = "") {
    const input = `${subjectId}:${salt}`;
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) % 10000) / 10000;
  }

  function diversify(scoredInputs, count = 5, mode = "balanced", salt = "") {
    const penalty = { stable: 0.12, balanced: 0.24, explore: 0.38 }[mode] ?? 0.24;
    const remaining = scoredInputs.slice();
    const selected = [];
    while (selected.length < count && remaining.length) {
      let bestIndex = -1;
      let bestValue = -Infinity;
      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index];
        const candidateDiversityFeatures = candidate.diversityFeatures || candidate.features;
        const maxSimilarity = selected.length
          ? Math.max(
              ...selected.map((item) =>
                weightedJaccard(candidateDiversityFeatures, item.diversityFeatures || item.features),
              ),
            )
          : 0;
        const studioTokens = Object.keys(candidateDiversityFeatures).filter((token) => token.startsWith("studio:"));
        const sameStudioCount = selected.filter((item) =>
          studioTokens.some((token) => (item.diversityFeatures || item.features)[token]),
        ).length;
        const explorationJitter = mode === "explore" ? (seededNoise(candidate.subject.id, salt) - 0.5) * 0.08 : 0;
        const adjusted =
          candidate.normalizedScore -
          penalty * maxSimilarity -
          Math.max(0, sameStudioCount - 1) * 0.12 +
          explorationJitter;
        if (adjusted > bestValue) {
          bestValue = adjusted;
          bestIndex = index;
        }
      }
      selected.push(remaining.splice(bestIndex, 1)[0]);
    }
    return selected;
  }

  function recommendationSalt(date = new Date()) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  function collectionFingerprint(collectionInputs) {
    const rows = collectionInputs
      .map(normalizeCollection)
      .map((item) =>
        [
          item.subjectId,
          item.type,
          item.rate,
          item.tags.slice().sort().join(","),
          item.comment,
          item.updatedAt,
        ].join("|"),
      )
      .sort();
    let hash = 2166136261;
    const value = rows.join("\n");
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function influentialSubjectIds(collectionInputs, profile, positiveCount = 12, negativeCount = 8) {
    const residuals = new Map(profile.anchors.map((anchor) => [anchor.subjectId, anchor.residual]));
    const candidates = collectionInputs
      .map(normalizeCollection)
      .filter((item) => residuals.has(item.subjectId))
      .map((item) => ({ id: item.subjectId, residual: residuals.get(item.subjectId) }));
    const positives = candidates
      .filter((item) => item.residual > 0)
      .sort((a, b) => b.residual - a.residual)
      .slice(0, positiveCount);
    const negatives = candidates
      .filter((item) => item.residual < 0)
      .sort((a, b) => a.residual - b.residual)
      .slice(0, negativeCount);
    return [...new Set([...positives, ...negatives].map((item) => item.id))];
  }

  function topRetrievalTags(profile, count = 6) {
    return profile.topFeatures
      .filter((entry) => entry.weight > 0 && entry.token.startsWith("tag:"))
      .filter((entry) => !TEMPORAL_TAG.test(entry.label))
      .slice(0, count)
      .map((entry) => entry.label);
  }

  const Core = Object.freeze({
    SUBJECT_TYPES,
    COLLECTION_STATUS,
    ROLE_WEIGHTS,
    clamp,
    normalizeText,
    normalizeTagList,
    normalizeInfoboxEntries,
    normalizeSubject,
    classifyJapaneseOrigin,
    normalizeCollection,
    normalizeRole,
    normalizeInfoboxRole,
    splitCreditNames,
    extractInfoboxCredits,
    buildFeatureVector,
    calculateRatingBaseline,
    expectedRating,
    trainProfile,
    weightedJaccard,
    bayesianScore,
    describeToken,
    selectContentTags,
    selectRecommendationEvidence,
    scoreSubject,
    blendSupplementalScore,
    diversify,
    recommendationSalt,
    collectionFingerprint,
    influentialSubjectIds,
    topRetrievalTags,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  globalObject.BangumiRecommenderCore = Core;
})(typeof globalThis !== "undefined" ? globalThis : window);


(function bootstrapBangumiPersonalRecommender() {
  "use strict";

  const Core = globalThis.BangumiRecommenderCore;
  if (!Core || document.getElementById("bgmpr-host")) return;

  const APP_VERSION = "0.2.4";
  const DEFAULT_USER = "wylt";
  const API_BASE = "https://api.bgm.tv";
  const COLLECTION_TTL = 24 * 60 * 60 * 1000;
  const CANDIDATE_TTL = 3 * 24 * 60 * 60 * 1000;
  const ENTITY_TTL = 30 * 24 * 60 * 60 * 1000;
  const CONFIG_KEY = "bgmpr:config:v1";
  const RECOMMENDATION_MODEL_VERSION = "14";
  const CANDIDATE_TAG_COUNT = 12;
  const CANDIDATE_TAG_PAGES = 2;
  const CANDIDATE_RANK_PAGES = 10;

  const TYPE_OPTIONS = [2, 1, 4, 3, 6];
  const RECOMMENDATION_MODE = "balanced";

  const ICONS = Object.freeze({
    spark: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.45 5.05L18.5 8.5l-5.05 1.45L12 15l-1.45-5.05L5.5 8.5l5.05-1.45L12 2Zm6 11 .9 3.1L22 17l-3.1.9L18 21l-.9-3.1L14 17l3.1-.9L18 13Z"/></svg>`,
    discover: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.25"/><path d="m15.55 8.45-2.18 4.92-4.92 2.18 2.18-4.92 4.92-2.18Z"/><circle cx="12" cy="12" r="1.15"/></svg>`,
    launchArrow: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.75 5.25 5.25-5.25 5.25"/></svg>`,
    layers: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4M4 16.5l8 4 8-4"/></svg>`,
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.1A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h8V3l-3.35 3.35Z"/></svg>`,
    arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 5-1.4 1.4 4.6 4.6H5v2h11.2l-4.6 4.6L13 19l7-7-7-7Z"/></svg>`,
    hide: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c5.5 0 9.7 5.1 10 5.5l.9 1.5-.9 1.5c-.15.2-1.3 1.65-3.2 3L17.35 15A12.7 12.7 0 0 0 20 12c-1.18-1.55-4.28-5-8-5-.76 0-1.48.14-2.16.37L8.27 5.8A9.8 9.8 0 0 1 12 5Zm-8.7-.7 16.4 16.4-1.4 1.4-3.08-3.08A9.8 9.8 0 0 1 12 19c-5.5 0-9.7-5.1-10-5.5L1.1 12l.9-1.5a17.1 17.1 0 0 1 3.1-3.43L1.9 3.7l1.4-1.4ZM6.5 8.5A13.4 13.4 0 0 0 4 12c1.18 1.55 4.28 5 8 5 .56 0 1.1-.08 1.61-.22l-1.7-1.7A3.1 3.1 0 0 1 8.9 12l-2.4-3.5Zm4.35 1.03A3 3 0 0 1 14.47 13l-3.62-3.47Z"/></svg>`,
    info: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 10h2v7h-2v-7Zm0-3h2v2h-2V7Zm1-5a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7.4 8.6 4.6 4.6 4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z"/></svg>`,
  });

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeImageUrl(value) {
    try {
      const url = new URL(String(value || ""), location.origin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function concurrentMap(values, limit, mapper) {
    const results = new Array(values.length);
    let cursor = 0;
    async function worker() {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(values[index], index);
      }
    }
    return Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker)).then(() => results);
  }

  class KeyValueStore {
    constructor() {
      this.databasePromise = null;
    }

    open() {
      if (this.databasePromise) return this.databasePromise;
      this.databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open("bgmpr", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("kv")) request.result.createObjectStore("kv");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return this.databasePromise;
    }

    async get(key) {
      const database = await this.open();
      return new Promise((resolve, reject) => {
        const request = database.transaction("kv", "readonly").objectStore("kv").get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async set(key, value) {
      const database = await this.open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction("kv", "readwrite");
        transaction.objectStore("kv").put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }

    async deletePrefix(prefix) {
      const database = await this.open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction("kv", "readwrite");
        const store = transaction.objectStore("kv");
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (String(cursor.key).startsWith(prefix)) cursor.delete();
          cursor.continue();
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }
  }

  class BangumiDataClient {
    constructor(store, username, onProgress) {
      this.store = store;
      this.username = username;
      this.onProgress = onProgress;
      this.apiAvailable = true;
    }

    progress(message, current = 0, total = 0) {
      this.onProgress?.(message, current, total);
    }

    async cached(key, ttl, loader, force = false) {
      if (!force) {
        const cached = await this.store.get(key);
        if (cached && Date.now() - cached.storedAt < ttl) return cached.value;
      }
      const value = await loader();
      await this.store.set(key, { storedAt: Date.now(), value });
      return value;
    }

    async request(url, options = {}, retries = 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 16000);
      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          credentials: url.startsWith(location.origin) ? "same-origin" : "omit",
          headers: {
            Accept: "application/json",
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {}),
          },
        });
        if (!response.ok) {
          if (retries && (response.status === 429 || response.status >= 500)) {
            await sleep(650);
            return this.request(url, options, retries - 1);
          }
          throw new Error(`HTTP ${response.status}`);
        }
        return response;
      } finally {
        clearTimeout(timeout);
      }
    }

    async requestJson(path, options = {}) {
      if (!this.apiAvailable) throw new Error("API unavailable");
      try {
        const response = await this.request(`${API_BASE}${path}`, options);
        return await response.json();
      } catch (error) {
        if (error?.name === "TypeError" || error?.name === "AbortError" || /blocked|failed|network/i.test(error?.message || "")) {
          this.apiAvailable = false;
        }
        throw error;
      }
    }

    async getCollections(subjectType, force = false) {
      const key = `collections:${this.username}:${subjectType}`;
      return this.cached(
        key,
        COLLECTION_TTL,
        async () => {
          try {
            this.progress("正在同步收藏数据…", 0, 1);
            const data = [];
            let offset = 0;
            let total = Infinity;
            while (offset < total) {
              const page = await this.requestJson(
                `/v0/users/${encodeURIComponent(this.username)}/collections?subject_type=${subjectType}&limit=100&offset=${offset}`,
              );
              total = Number(page.total || 0);
              const rows = Array.isArray(page.data) ? page.data : [];
              data.push(...rows);
              offset += rows.length;
              this.progress("正在同步收藏数据…", Math.min(offset, total), total);
              if (!rows.length) break;
            }
            return data.map(Core.normalizeCollection);
          } catch (error) {
            this.progress("API 不可用，正在从站内收藏页读取…", 0, 1);
            return this.getCollectionsFromSite(subjectType);
          }
        },
        force,
      );
    }

    async getHtmlDocument(url) {
      const response = await this.request(url, { headers: { Accept: "text/html" } }, 0);
      const html = await response.text();
      return new DOMParser().parseFromString(html, "text/html");
    }

    maxPage(documentNode) {
      return Math.max(
        1,
        ...[...documentNode.querySelectorAll('a[href*="page="]')].map((link) => {
          try {
            return Number(new URL(link.href, location.origin).searchParams.get("page")) || 1;
          } catch {
            return 1;
          }
        }),
      );
    }

    parseListItems(documentNode, subjectType, collectionType = 0, sourceTag = "") {
      return [...documentNode.querySelectorAll("#browserItemList > li, #browserItemList li.item")]
        .map((item) => {
          const link = item.querySelector('h3 a[href*="/subject/"]');
          const match = link?.getAttribute("href")?.match(/\/subject\/(\d+)/);
          if (!match) return null;
          const id = Number(match[1]);
          const text = item.innerText || item.textContent || "";
          const tagMatch = text.match(/标签[:：]\s*([^\n]+)/);
          const tags = tagMatch ? tagMatch[1].split(/\s+/).filter(Boolean) : [];
          if (sourceTag) tags.push(sourceTag);
          const personalStars = item.querySelector(".starlight")?.className?.match(/stars(\d+)/);
          const scoreText = item.querySelector(".rateInfo .fade, .rateInfo .number")?.textContent || "";
          const totalText = item.querySelector(".rateInfo .tip_j")?.textContent || "";
          const image = item.querySelector("img")?.getAttribute("src") || "";
          const info = item.querySelector(".info")?.textContent || "";
          const date = info.match(/(?:19|20)\d{2}[-年]\d{1,2}(?:[-月]\d{1,2})?/)?.[0] || "";
          return Core.normalizeCollection({
            subject_id: id,
            type: collectionType,
            rate: personalStars ? Number(personalStars[1]) : 0,
            tags,
            subject: {
              id,
              type: subjectType,
              name: link.textContent?.trim() || "",
              name_cn: link.textContent?.trim() || "",
              date,
              images: { common: image },
              tags: tags.map((name) => ({ name })),
              rating: {
                score: Number.parseFloat(scoreText) || 0,
                total: Number((totalText.match(/[\d,]+/)?.[0] || "0").replaceAll(",", "")),
              },
              sourceUrl: `${location.origin}/subject/${id}`,
            },
          });
        })
        .filter(Boolean);
    }

    async getCollectionsFromSite(subjectType) {
      const type = Core.SUBJECT_TYPES[subjectType];
      if (!type) throw new Error("不支持的条目类型");
      const statuses = [
        ["wish", 1],
        ["collect", 2],
        ["do", 3],
        ["on_hold", 4],
        ["dropped", 5],
      ];
      const collections = [];
      let completedPages = 0;
      for (const [status, collectionType] of statuses) {
        const base = `${location.origin}/${type.slug}/list/${encodeURIComponent(this.username)}/${status}`;
        const first = await this.getHtmlDocument(base);
        const pages = this.maxPage(first);
        collections.push(...this.parseListItems(first, subjectType, collectionType));
        completedPages += 1;
        this.progress(`正在读取${type.label}收藏页…`, completedPages, completedPages + pages - 1);
        for (let page = 2; page <= pages; page += 1) {
          await sleep(260);
          const documentNode = await this.getHtmlDocument(`${base}?page=${page}`);
          collections.push(...this.parseListItems(documentNode, subjectType, collectionType));
          completedPages += 1;
          this.progress(`正在读取${type.label}收藏页…`, completedPages, completedPages + pages - page);
        }
      }
      return collections;
    }

    async getCandidates(subjectType, profile, force = false) {
      const tags = Core.topRetrievalTags(profile, CANDIDATE_TAG_COUNT);
      const signature = tags.map(Core.normalizeText).sort().join("|");
      const key = `candidates:v3:${subjectType}:${signature}`;
      return this.cached(
        key,
        CANDIDATE_TTL,
        async () => {
          try {
            const pools = [];
            const rankOffsets = Array.from({ length: CANDIDATE_RANK_PAGES }, (_, index) => index * 100);
            const tagQueries = tags.flatMap((tag) =>
              Array.from({ length: CANDIDATE_TAG_PAGES }, (_, index) => ({ tag, offset: index * 50 })),
            );
            const totalRequests = rankOffsets.length + tagQueries.length;
            let completed = 0;
            this.progress("正在建立候选池…", completed, totalRequests);
            for (const offset of rankOffsets) {
              const page = await this.requestJson(
                `/v0/subjects?type=${subjectType}&sort=rank&limit=100&offset=${offset}`,
              );
              pools.push(...(page.data || []));
              completed += 1;
              this.progress("正在建立候选池…", completed, totalRequests);
            }
            const searched = await concurrentMap(tagQueries, 3, async ({ tag, offset }) => {
              const page = await this.requestJson(
                `/v0/search/subjects?limit=50&offset=${offset}`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    keyword: tag,
                    sort: "heat",
                    filter: { type: [subjectType], tag: [tag] },
                  }),
                },
              );
              completed += 1;
              this.progress("正在按偏好召回候选…", completed, totalRequests);
              return page.data || [];
            });
            pools.push(...searched.flat());
            return this.dedupeSubjects(pools);
          } catch (error) {
            this.progress(
              "API 候选不可用，正在使用站内标签页…",
              0,
              tags.length * CANDIDATE_TAG_PAGES + CANDIDATE_RANK_PAGES,
            );
            return this.getCandidatesFromSite(subjectType, tags);
          }
        },
        force,
      );
    }

    dedupeSubjects(subjects) {
      const map = new Map();
      for (const raw of subjects) {
        const subject = Core.normalizeSubject(raw);
        if (subject.id) map.set(subject.id, { ...(map.get(subject.id) || {}), ...subject });
      }
      return [...map.values()];
    }

    async getCandidatesFromSite(subjectType, tags) {
      const type = Core.SUBJECT_TYPES[subjectType];
      const pools = [];
      let done = 0;
      const totalRequests = tags.length * CANDIDATE_TAG_PAGES + CANDIDATE_RANK_PAGES;
      for (const tag of tags.slice(0, CANDIDATE_TAG_COUNT)) {
        for (let page = 1; page <= CANDIDATE_TAG_PAGES; page += 1) {
          const url = `${location.origin}/${type.slug}/tag/${encodeURIComponent(tag)}?sort=collects&page=${page}`;
          const documentNode = await this.getHtmlDocument(url);
          pools.push(...this.parseListItems(documentNode, subjectType, 0, tag).map((item) => item.subject));
          done += 1;
          this.progress("正在按偏好读取候选…", done, totalRequests);
          await sleep(220);
        }
      }
      for (let page = 1; page <= CANDIDATE_RANK_PAGES; page += 1) {
        const url = `${location.origin}/${type.slug}/browser?sort=rank&page=${page}`;
        const documentNode = await this.getHtmlDocument(url);
        pools.push(...this.parseListItems(documentNode, subjectType, 0).map((item) => item.subject));
        done += 1;
        this.progress("正在补充高质量候选…", done, totalRequests);
        await sleep(220);
      }
      return this.dedupeSubjects(pools);
    }

    async getPersons(subjectId) {
      if (!this.apiAvailable) return [];
      return this.cached(
        `persons:${subjectId}`,
        ENTITY_TTL,
        () => this.requestJson(`/v0/subjects/${subjectId}/persons`).catch(() => []),
      );
    }

    async getCharacters(subjectId) {
      if (!this.apiAvailable) return [];
      return this.cached(
        `characters:${subjectId}`,
        ENTITY_TTL,
        () => this.requestJson(`/v0/subjects/${subjectId}/characters`).catch(() => []),
      );
    }

    async getSubjectDetails(subjectId) {
      if (!this.apiAvailable) return null;
      return this.cached(
        `subject-details:${subjectId}`,
        ENTITY_TTL,
        () => this.requestJson(`/v0/subjects/${subjectId}`).catch(() => null),
      );
    }

    async enrichOriginMetadata(subjects, subjectIds) {
      if (!this.apiAvailable || !subjectIds.length) return new Map();
      const uniqueIds = [...new Set(subjectIds)].slice(0, 180);
      let completed = 0;
      const rows = await concurrentMap(uniqueIds, 4, async (subjectId) => {
        const details = await this.getSubjectDetails(subjectId);
        completed += 1;
        this.progress("正在确认候选作品来源…", completed, uniqueIds.length);
        const base = subjects.find((subject) => Number(subject.id) === Number(subjectId));
        return base ? [subjectId, Core.normalizeSubject(details || base)] : null;
      });
      return new Map(rows.filter(Boolean));
    }

    async enrichSubjects(subjects, subjectIds) {
      if (!this.apiAvailable || !subjectIds.length) return new Map();
      const uniqueIds = [...new Set(subjectIds)].slice(0, 36);
      let completed = 0;
      const rows = await concurrentMap(uniqueIds, 3, async (subjectId) => {
        const [persons, characters] = await Promise.all([
          this.getPersons(subjectId),
          this.getCharacters(subjectId),
        ]);
        completed += 1;
        this.progress("正在补充导演、制作与声优信息…", completed, uniqueIds.length);
        const base = subjects.find((subject) => Number(subject.id) === Number(subjectId));
        return base ? [subjectId, { ...base, persons, characters }] : null;
      });
      return new Map(rows.filter(Boolean));
    }
  }

  class RecommenderApp {
    constructor() {
      this.store = new KeyValueStore();
      this.config = {
        username: DEFAULT_USER,
        subjectType: 2,
        ...loadJson(CONFIG_KEY, {}),
      };
      delete this.config.mode;
      this.client = new BangumiDataClient(
        this.store,
        this.config.username,
        (message, current, total) => this.setProgress(message, current, total),
      );
      this.state = {
        open: false,
        busy: false,
        baseProfile: null,
        profile: null,
        candidates: [],
        scoredPool: [],
        current: [],
        collections: [],
        eligibleCandidateCount: 0,
        lastSync: null,
        currentSummary: {},
      };
      this.lastFocused = null;
      this.previousPageOverflow = "";
      this.excludedBatch = new Set();
    }

    mount() {
      this.host = document.createElement("div");
      this.host.id = "bgmpr-host";
      this.host.dataset.theme = this.detectTheme();
      document.documentElement.append(this.host);
      this.shadow = this.host.attachShadow({ mode: "open" });
      this.shadow.innerHTML = `${this.styles()}${this.shell()}`;
      this.bindEvents();
      this.watchTheme();
    }

    detectTheme() {
      const className = `${document.documentElement.className} ${document.body?.className || ""}`;
      if (/dark|night/i.test(className)) return "dark";
      return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    watchTheme() {
      const update = () => {
        this.host.dataset.theme = this.detectTheme();
      };
      new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
      matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", update);
    }

    shell() {
      const typeOptions = TYPE_OPTIONS.map(
        (type) => `<option value="${type}" ${type === Number(this.config.subjectType) ? "selected" : ""}>${Core.SUBJECT_TYPES[type].label}</option>`,
      ).join("");
      return `
        <button class="launcher" type="button" aria-label="打开 Bangumi 个性推荐" aria-haspopup="dialog">
          <span class="launcher-mark">${ICONS.discover}</span>
          <span class="launcher-copy"><small>FOR YOU</small><strong>个性推荐</strong></span>
          <span class="launcher-arrow">${ICONS.launchArrow}</span>
        </button>
        <div class="scrim" hidden></div>
        <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="bgmpr-title" aria-hidden="true">
          <header class="drawer-header">
            <div>
              <p class="eyebrow">FOR ${escapeHtml(this.config.username)}</p>
              <h2 id="bgmpr-title">Bangumi 个性推荐</h2>
              <p class="subline" data-role="sync-label">尚未同步</p>
            </div>
            <button class="icon-button close" type="button" aria-label="关闭推荐面板">${ICONS.close}</button>
          </header>
          <section class="controls" aria-label="推荐设置">
            <label class="type-picker">
              <span class="type-picker-icon">${ICONS.layers}</span>
              <span class="type-picker-copy">
                <strong>推荐类型</strong>
                <small>选择要分析的收藏分类</small>
              </span>
              <span class="type-select-shell">
                <select data-role="type-select" aria-label="推荐类型">${typeOptions}</select>
                <span class="type-select-arrow">${ICONS.chevron}</span>
              </span>
            </label>
          </section>
          <section class="progress-region" aria-live="polite">
            <div class="progress-copy"><span data-role="progress-text">准备就绪</span><span data-role="progress-count"></span></div>
            <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
          </section>
          <main class="content" tabindex="-1">
            <div class="welcome" data-role="welcome">
              <div class="welcome-mark">${ICONS.spark}</div>
              <h3>从你的收藏中发现下一部</h3>
              <p>组件会在本地分析评分、标签、制作人员和声优信息，排除所有已标记条目，再选出 5 个结果。</p>
              <button class="primary start" type="button">生成推荐</button>
              <p class="privacy">数据仅保存在当前浏览器，不会上传到第三方服务。</p>
            </div>
            <div class="results" data-role="results" hidden></div>
            <div class="error" data-role="error" hidden>
              <span class="error-icon">${ICONS.info}</span>
              <h3>暂时无法生成推荐</h3>
              <p data-role="error-message"></p>
              <button class="secondary retry" type="button">重试</button>
            </div>
          </main>
          <footer class="drawer-footer">
            <button class="secondary refresh-data" type="button">${ICONS.refresh}<span>刷新画像</span></button>
            <button class="secondary next-batch" type="button">换一批</button>
            <span class="version">v${APP_VERSION}</span>
          </footer>
          <div class="toast" role="status" aria-live="polite" hidden><span></span><button type="button">撤销</button></div>
        </aside>`;
    }

    bindEvents() {
      this.$(".launcher").addEventListener("click", () => this.open());
      this.$(".close").addEventListener("click", () => this.close());
      this.$(".scrim").addEventListener("click", () => this.close());
      this.$(".start").addEventListener("click", () => this.ensureRecommendations({ force: true }));
      this.$(".retry").addEventListener("click", () => this.ensureRecommendations({ force: true }));
      this.$(".refresh-data").addEventListener("click", () => this.ensureRecommendations({ force: true }));
      this.$(".next-batch").addEventListener("click", () => this.nextBatch());
      this.$('[data-role="type-select"]').addEventListener("change", (event) => {
        this.config.subjectType = Number(event.target.value);
        this.persistConfig();
        this.resetViewForType();
        this.ensureRecommendations({ force: false });
      });
      this.shadow.addEventListener("click", (event) => {
        const dismiss = event.composedPath().find(
          (element) => element instanceof Element && element.matches?.("[data-dismiss-id]"),
        );
        if (dismiss) this.dismiss(Number(dismiss.dataset.dismissId));
      });
      this.shadow.addEventListener(
        "error",
        (event) => {
          const image = event.target.closest?.("img[data-cover]");
          if (!image) return;
          image.hidden = true;
          const placeholder = image.nextElementSibling;
          if (placeholder) placeholder.hidden = false;
        },
        true,
      );
      this.shadow.addEventListener("keydown", (event) => this.onKeyDown(event));
    }

    $(selector) {
      return this.shadow.querySelector(selector);
    }

    persistConfig() {
      saveJson(CONFIG_KEY, this.config);
    }

    open() {
      this.state.open = true;
      this.lastFocused = this.shadow.activeElement || document.activeElement;
      this.$(".scrim").hidden = false;
      this.$(".drawer").setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => this.$(".drawer").classList.add("open"));
      this.previousPageOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
      this.$(".close").focus();
      this.loadCachedResult().then((loaded) => {
        if (!loaded && !this.state.busy) this.$('[data-role="welcome"]').hidden = false;
      });
    }

    close() {
      this.state.open = false;
      this.$(".drawer").classList.remove("open");
      this.$(".drawer").setAttribute("aria-hidden", "true");
      this.$(".scrim").hidden = true;
      document.documentElement.style.overflow = this.previousPageOverflow;
      this.lastFocused?.focus?.();
    }

    onKeyDown(event) {
      if (!this.state.open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...this.shadow.querySelectorAll('button:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]')]
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && this.shadow.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && this.shadow.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    resetViewForType() {
      this.state.baseProfile = null;
      this.state.profile = null;
      this.state.candidates = [];
      this.state.scoredPool = [];
      this.state.current = [];
      this.excludedBatch.clear();
      this.$('[data-role="results"]').hidden = true;
      this.$('[data-role="error"]').hidden = true;
      this.$('[data-role="welcome"]').hidden = false;
    }

    cacheKey() {
      return `result:v${RECOMMENDATION_MODEL_VERSION}:${this.config.username}:${this.config.subjectType}:${RECOMMENDATION_MODE}`;
    }

    async loadCachedResult() {
      const cached = await this.store.get(this.cacheKey()).catch(() => null);
      if (!cached?.value?.recommendations?.length) return false;
      const value = cached.value;
      this.state.lastSync = value.generatedAt;
      this.state.current = value.recommendations;
      this.state.currentSummary = value.summary || {};
      this.renderRecommendations(value.recommendations, value.summary);
      this.updateSyncLabel();
      if (Date.now() - cached.storedAt > COLLECTION_TTL) {
        this.setProgress("本地结果已显示；打开“刷新画像”可同步最新收藏。", 0, 0);
      }
      return true;
    }

    setProgress(message, current = 0, total = 0) {
      const text = this.$('[data-role="progress-text"]');
      const count = this.$('[data-role="progress-count"]');
      const bar = this.$(".progress-track");
      const fill = bar.querySelector("span");
      text.textContent = message;
      const percent = total > 0 ? Math.round((current / total) * 100) : 0;
      count.textContent = total > 0 ? `${current}/${total}` : "";
      bar.setAttribute("aria-valuenow", String(percent));
      bar.classList.toggle("active", total > 0 && current < total);
      fill.style.transform = `scaleX(${total > 0 ? clamp01(current / total) : 0})`;
    }

    setBusy(busy) {
      this.state.busy = busy;
      for (const selector of [".start", ".retry", ".refresh-data", ".next-batch", '[data-role="type-select"]']) {
        this.$(selector).disabled = busy;
      }
      this.$(".refresh-data").classList.toggle("spinning", busy);
    }

    async ensureRecommendations({ force = false } = {}) {
      if (this.state.busy) return;
      this.setBusy(true);
      this.$('[data-role="welcome"]').hidden = true;
      this.$('[data-role="error"]').hidden = true;
      try {
        const type = Number(this.config.subjectType);
        const collections = await this.client.getCollections(type, force);
        if (!collections.length) throw new Error("没有读取到该类型的收藏数据。请确认账号公开收藏或稍后重试。");
        this.state.collections = collections;
        this.state.baseProfile = Core.trainProfile(collections);
        this.state.profile = this.state.baseProfile;
        if (this.state.profile.ratedCount < 5) throw new Error("已评分样本不足 5 个，暂时无法建立可靠画像。");

        const candidates = await this.client.getCandidates(type, this.state.profile, force);
        const marked = new Set(collections.map((item) => Number(item.subjectId)));
        this.state.candidates = candidates.filter((subject) => !marked.has(Number(subject.id)));
        if (this.state.candidates.length < 5) throw new Error("未标记候选不足 5 个，请稍后刷新候选池。");

        this.recompute({ enforceJapanese: false, render: false });
        this.setProgress("基础排序已完成，正在确认日本作品…", 0, 0);

        if (this.client.apiAvailable) {
          await this.enhanceWithPeople();
        }
        this.recompute({ enforceJapanese: true, render: true });

        this.state.lastSync = new Date().toISOString();
        this.updateSyncLabel();
        await this.saveCurrentResult();
        this.setProgress(
          `完成：分析 ${collections.length} 个收藏，保留 ${this.state.eligibleCandidateCount} 个已确认日本候选。`,
          1,
          1,
        );
      } catch (error) {
        this.showError(error);
      } finally {
        this.setBusy(false);
      }
    }

    async enhanceWithPeople() {
      const influential = Core.influentialSubjectIds(this.state.collections, this.state.profile, 10, 6);
      const originPreview = this.state.scoredPool.slice(0, 180).map((item) => item.subject.id);
      let allSubjects = [
        ...this.state.collections.map((item) => item.subject),
        ...this.state.candidates,
      ];
      const origins = await this.client.enrichOriginMetadata(allSubjects, originPreview);
      if (origins.size) {
        this.state.candidates = this.state.candidates.map((item) =>
          origins.has(item.id) ? { ...item, originMetadata: origins.get(item.id) } : item,
        );
      }

      const candidatePreview = this.state.scoredPool.slice(0, 16).map((item) => item.subject.id);
      allSubjects = [
        ...this.state.collections.map((item) => item.subject),
        ...this.state.candidates,
      ];
      const enriched = await this.client.enrichSubjects(allSubjects, [...influential, ...candidatePreview]);
      if (!enriched.size) return;
      this.state.collections = this.state.collections.map((item) =>
        enriched.has(item.subjectId) ? { ...item, subject: enriched.get(item.subjectId) } : item,
      );
      this.state.candidates = this.state.candidates.map((item) => enriched.get(item.id) || item);
      this.state.profile = Core.trainProfile(this.state.collections);
    }

    recompute({ enforceJapanese = true, render = true } = {}) {
      const scored = this.state.candidates
        .map((subject) => {
          const supplementalScore = Core.scoreSubject(subject, this.state.profile, RECOMMENDATION_MODE);
          const scoredSubject = this.state.baseProfile !== this.state.profile
            ? Core.blendSupplementalScore(
                Core.scoreSubject(
                  { ...subject, persons: [], characters: [] },
                  this.state.baseProfile,
                  RECOMMENDATION_MODE,
                ),
                supplementalScore,
              )
            : supplementalScore;
          return {
            ...scoredSubject,
            origin: enforceJapanese ? Core.classifyJapaneseOrigin(subject) : null,
          };
        })
        .filter((item) => !enforceJapanese || item.origin?.status === "japanese")
        .sort((a, b) => b.normalizedScore - a.normalizedScore);
      this.state.eligibleCandidateCount = enforceJapanese ? scored.length : 0;
      if (enforceJapanese && scored.length < 5) {
        throw new Error(`只能确认 ${scored.length} 个日本候选，无法在不混入其他国家作品的前提下生成 5 个推荐。`);
      }
      this.state.scoredPool = scored.slice(0, 180);
      this.excludedBatch.clear();
      if (render) this.renderFromPool();
    }

    renderFromPool() {
      const available = this.state.scoredPool.filter((item) => !this.excludedBatch.has(item.subject.id));
      const source = available.length >= 5 ? available : this.state.scoredPool;
      const selected = Core.diversify(
        source,
        5,
        RECOMMENDATION_MODE,
        `${Core.recommendationSalt()}:${this.excludedBatch.size}`,
      );
      this.state.current = selected;
      this.renderRecommendations(selected, {
        collectionCount: this.state.profile.collectionCount,
        ratedCount: this.state.profile.ratedCount,
        candidateCount: this.state.eligibleCandidateCount,
      });
    }

    nextBatch() {
      if (!this.state.scoredPool.length) {
        this.ensureRecommendations({ force: false });
        return;
      }
      for (const item of this.state.current) this.excludedBatch.add(item.subject.id);
      if (this.state.scoredPool.length - this.excludedBatch.size < 5) this.excludedBatch.clear();
      this.renderFromPool();
    }

    dismiss(subjectId) {
      const previous = new Set(this.excludedBatch);
      this.excludedBatch.add(Number(subjectId));
      this.renderFromPool();
      this.showToast("已从当前这批结果中暂时隐藏。", () => {
        this.excludedBatch.clear();
        for (const id of previous) this.excludedBatch.add(id);
        this.renderFromPool();
      });
    }

    showToast(message, undo) {
      const toast = this.$(".toast");
      toast.querySelector("span").textContent = message;
      const button = toast.querySelector("button");
      button.onclick = () => {
        undo?.();
        toast.hidden = true;
      };
      toast.hidden = false;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        toast.hidden = true;
      }, 5000);
    }

    recommendationCard(item, index) {
      const subject = item.subject;
      const title = subject.nameCn || subject.name || `条目 ${subject.id}`;
      const original = subject.nameCn && subject.name && subject.nameCn !== subject.name ? subject.name : "";
      const image = safeImageUrl(subject.image);
      const globalScore = subject.rating.score ? subject.rating.score.toFixed(1) : "—";
      const votes = subject.rating.total ? subject.rating.total.toLocaleString("zh-CN") : "样本较少";
      const confidencePercent = Math.round(Number(item.confidenceScore || 0) * 100);
      const confidenceBreakdown = item.confidenceBreakdown || {};
      const featurePercent = Math.round(Number(confidenceBreakdown.featureSupport || 0) * 100);
      const neighborPercent = Math.round(Number(confidenceBreakdown.neighborEvidence || 0) * 100);
      const ratingPercent = Math.round(Number(confidenceBreakdown.ratingEvidence || 0) * 100);
      const confidenceExplanation = `证据构成：偏好特征 ${featurePercent}/50，相似收藏 ${neighborPercent}/30，评分样本 ${ratingPercent}/20`;
      const evidence = Core.selectRecommendationEvidence(item);
      const contentTags = Core.selectContentTags(subject, item.positiveReasons);
      const contentTagMarkup = contentTags.length
        ? `<div class="content-tag-row" aria-label="内容标签">
            <span class="content-tag-label">内容</span>
            <div class="content-tags">${contentTags.map((tag) => `<span>${escapeHtml(tag.label)}</span>`).join("")}</div>
          </div>`
        : "";
      const quotedLabels = (reasons) =>
        `<strong>「${reasons.map((reason) => escapeHtml(reason.label)).join("、")}」</strong>`;
      const evidenceRows = evidence.map((entry) => {
        if (entry.kind === "similarity") {
          const works = entry.works.map((work) =>
            `<strong>${Number(work.rate) ? `${Number(work.rate)} 分的` : ""}《${escapeHtml(work.name)}》</strong>`,
          ).join("、");
          return `<li><span class="evidence-kind">相似</span><p>与你收藏中 ${works} 特征接近</p></li>`;
        }
        if (entry.kind === "creative") {
          const roleName = {
            director: "导演",
            studio: "制作公司",
            creator: "作者／原作",
            series: "系列构成",
            script: "脚本",
            music: "音乐创作",
            cv: "声优",
          }[entry.role] || entry.roleLabel || "创作人员";
          return `<li><span class="evidence-kind">${escapeHtml(entry.roleLabel || roleName)}</span><p>${escapeHtml(roleName)}${quotedLabels(entry.reasons)}在你的历史评分中表现较好</p></li>`;
        }
        return "<li><span class=\"evidence-kind\">口碑</span><p>全站评分与探索价值使它进入本轮候选</p></li>";
      });
      const shownSimilarCount = evidence
        .filter((entry) => entry.kind === "similarity")
        .reduce((sum, entry) => sum + entry.works.length, 0);
      return `
        <article class="recommendation-card" data-evidence-count="${evidence.length}" data-content-tag-count="${contentTags.length}" data-similar-count="${shownSimilarCount}" data-confidence="${confidencePercent}" data-confidence-feature="${featurePercent}" data-confidence-neighbor="${neighborPercent}" data-confidence-rating="${ratingPercent}">
          <div class="rank">${String(index + 1).padStart(2, "0")}</div>
          <a class="cover" href="${location.origin}/subject/${subject.id}" target="_blank" rel="noopener noreferrer" aria-label="查看《${escapeHtml(title)}》">
            ${image ? `<img data-cover src="${escapeHtml(image)}" alt="《${escapeHtml(title)}》封面" loading="lazy" width="88" height="124"><span class="cover-placeholder" hidden>NO<br>COVER</span>` : `<span class="cover-placeholder">NO<br>COVER</span>`}
          </a>
          <div class="card-body">
            <div class="title-row">
              <div>
                <h3><a href="${location.origin}/subject/${subject.id}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></h3>
                ${original ? `<p class="original">${escapeHtml(original)}</p>` : ""}
              </div>
              <div class="fit-score"><strong>${item.predicted.toFixed(1)}</strong><span>适合度</span></div>
            </div>
            <div class="metrics">
              <span>BGM ${globalScore}</span><span>${escapeHtml(votes)} 人评分</span>
            </div>
            ${contentTagMarkup}
            <section class="evidence-panel" aria-label="推荐依据，置信度 ${item.confidence}，${confidencePercent}%">
              <div class="evidence-header"><strong>推荐依据</strong><span class="confidence" title="${escapeHtml(confidenceExplanation)}" aria-label="置信度 ${item.confidence}，${confidencePercent}%。${escapeHtml(confidenceExplanation)}">置信度 ${item.confidence} · ${confidencePercent}%</span></div>
              <ul class="evidence-list">${evidenceRows.join("")}</ul>
            </section>
            <div class="card-actions">
              <a class="primary compact" href="${location.origin}/subject/${subject.id}" target="_blank" rel="noopener noreferrer">查看条目 ${ICONS.arrow}</a>
              <button class="ghost compact" type="button" data-dismiss-id="${subject.id}" aria-label="暂时隐藏《${escapeHtml(title)}》">${ICONS.hide}<span>暂时隐藏</span></button>
            </div>
          </div>
        </article>`;
    }

    renderRecommendations(recommendations, summary = {}) {
      this.state.currentSummary = summary;
      const results = this.$('[data-role="results"]');
      this.$('[data-role="welcome"]').hidden = true;
      this.$('[data-role="error"]').hidden = true;
      results.hidden = false;
      results.innerHTML = `
        <div class="summary">
          <div><strong>${Number(summary.collectionCount || 0).toLocaleString("zh-CN")}</strong><span>收藏样本</span></div>
          <div><strong>${Number(summary.ratedCount || 0).toLocaleString("zh-CN")}</strong><span>评分样本</span></div>
          <div><strong>${Number(summary.candidateCount || 0).toLocaleString("zh-CN")}</strong><span>未标记候选</span></div>
        </div>
        <div class="recommendation-list">${recommendations.map((item, index) => this.recommendationCard(item, index)).join("")}</div>
        <details class="method-note">
          <summary>
            <span class="method-icon">${ICONS.info}</span>
            <span class="method-copy"><strong>为什么推荐这些？</strong><small>评分校准 · 兴趣画像 · 相似作品 · 多样化</small></span>
            <span class="method-chevron">${ICONS.chevron}</span>
          </summary>
          <div class="method-body">
            <ol class="method-steps">
              <li><span class="step-number">1</span><div><strong>校准评分习惯</strong><p>结合你的平均分和条目全站评分，判断哪些作品真正超出你的预期。</p></div></li>
              <li><span class="step-number">2</span><div><strong>提取个人偏好</strong><p>学习标签、年代、导演、制作公司和声优等特征带来的正负影响。</p></div></li>
              <li><span class="step-number">3</span><div><strong>排序并保持多样</strong><p>排除所有已标记条目，融合相似度与质量分，再避免五个结果过于重复。</p></div></li>
            </ol>
            <p class="method-confidence"><strong>适合度不等于置信度。</strong>适合度预测你可能会打多高的分；置信度表示证据是否充分，由偏好特征支持（50%）、相似收藏（30%）和全站评分样本（20%）组成。</p>
            <p class="method-privacy">全部计算在当前浏览器完成，不接入 AI，也不会修改你的收藏。</p>
          </div>
        </details>`;
      this.$(".content").scrollTop = 0;
    }

    showError(error) {
      const errorBox = this.$('[data-role="error"]');
      this.$('[data-role="welcome"]').hidden = true;
      this.$('[data-role="results"]').hidden = true;
      errorBox.hidden = false;
      errorBox.querySelector('[data-role="error-message"]').textContent =
        `${error?.message || "未知错误"} 组件不会修改你的 Bangumi 数据，可以安全重试。`;
      this.setProgress("生成失败", 0, 0);
    }

    updateSyncLabel() {
      const label = this.$('[data-role="sync-label"]');
      if (!this.state.lastSync) {
        label.textContent = "尚未同步";
        return;
      }
      label.textContent = `更新于 ${new Date(this.state.lastSync).toLocaleString("zh-CN", { hour12: false })}`;
    }

    async saveCurrentResult() {
      await this.store.set(this.cacheKey(), {
        storedAt: Date.now(),
        value: {
          generatedAt: this.state.lastSync,
          recommendations: this.state.current,
          summary: {
            collectionCount: this.state.profile.collectionCount,
            ratedCount: this.state.profile.ratedCount,
            candidateCount: this.state.eligibleCandidateCount,
          },
        },
      });
    }

    styles() {
      return `<style>
        :host {
          --primary: #a6405c;
          --primary-strong: #852f49;
          --on-primary: #fff;
          --accent: #0e6e82;
          --surface: #fff;
          --surface-alt: #f7f4f5;
          --surface-raised: #fff;
          --text: #211b1d;
          --text-muted: #655b5f;
          --border: #ded5d8;
          --scrim: rgba(21, 15, 17, .52);
          --danger: #9e2f39;
          --focus: #0e6e82;
          --shadow: 0 20px 60px rgba(39, 20, 26, .22);
          --launcher-shadow: 0 2px 6px rgba(39, 20, 26, .08), 0 12px 30px rgba(99, 36, 55, .14);
          --z-host: 10000;
          color: var(--text);
          font-family: Inter, "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
          font-size: 16px;
          line-height: 1.5;
          position: relative;
          z-index: var(--z-host);
        }
        :host([data-theme="dark"]) {
          --primary: #dd8098;
          --primary-strong: #ef9caf;
          --on-primary: #281117;
          --accent: #77c9d8;
          --surface: #191516;
          --surface-alt: #241f21;
          --surface-raised: #2b2527;
          --text: #f7f0f2;
          --text-muted: #c9bcc0;
          --border: #4b4044;
          --scrim: rgba(0, 0, 0, .66);
          --danger: #ff9ba4;
          --focus: #77c9d8;
          --shadow: 0 20px 60px rgba(0, 0, 0, .48);
          --launcher-shadow: 0 2px 8px rgba(0, 0, 0, .28), 0 14px 34px rgba(0, 0, 0, .34);
        }
        *, *::before, *::after { box-sizing: border-box; }
        button, select, a { font: inherit; }
        button, select { color: inherit; }
        button { cursor: pointer; }
        button:disabled { cursor: not-allowed; opacity: .48; }
        button:focus-visible, select:focus-visible, a:focus-visible, summary:focus-visible {
          outline: 3px solid color-mix(in srgb, var(--focus) 70%, transparent);
          outline-offset: 2px;
        }
        .icon svg, button svg, a svg { width: 20px; height: 20px; fill: currentColor; flex: 0 0 auto; }
        .launcher {
          position: fixed; right: max(20px, env(safe-area-inset-right)); bottom: max(76px, calc(env(safe-area-inset-bottom) + 20px));
          z-index: 10; min-height: 56px; padding: 7px 11px 7px 8px;
          border: 1px solid color-mix(in srgb, var(--primary) 18%, var(--border)); border-radius: 17px;
          background: color-mix(in srgb, var(--surface-raised) 94%, transparent); color: var(--text); box-shadow: var(--launcher-shadow);
          -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
          display: inline-flex; align-items: center; gap: 10px; text-align: left;
          transition: background 180ms ease-out, border-color 180ms ease-out, box-shadow 180ms ease-out, transform 150ms ease-out;
        }
        .launcher-mark {
          width: 40px; height: 40px; border-radius: 12px; background: var(--primary); color: var(--on-primary);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, .22), 0 4px 10px color-mix(in srgb, var(--primary) 24%, transparent);
          display: grid; place-items: center; flex: 0 0 auto; transition: background 180ms ease-out, transform 180ms ease-out;
        }
        .launcher-mark svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
        .launcher-copy { min-width: 62px; display: grid; gap: 2px; line-height: 1; }
        .launcher-copy small { color: var(--primary); font-size: 9px; font-weight: 850; letter-spacing: .15em; }
        .launcher-copy strong { white-space: nowrap; font-size: 14px; font-weight: 750; letter-spacing: .01em; }
        .launcher-arrow { width: 16px; height: 20px; color: var(--text-muted); display: grid; place-items: center; transition: color 180ms ease-out, transform 180ms ease-out; }
        .launcher-arrow svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        .launcher:hover {
          border-color: color-mix(in srgb, var(--primary) 38%, var(--border)); background: var(--surface-raised);
          box-shadow: 0 3px 8px rgba(39, 20, 26, .1), 0 16px 36px rgba(99, 36, 55, .18); transform: translateY(-2px);
        }
        .launcher:hover .launcher-mark { background: var(--primary-strong); transform: rotate(-3deg); }
        .launcher:hover .launcher-arrow { color: var(--primary); transform: translateX(2px); }
        .launcher:active { transform: translateY(0) scale(.98); }
        .scrim { position: fixed; inset: 0; z-index: 20; background: var(--scrim); }
        .drawer {
          position: fixed; inset: 0 0 0 auto; z-index: 30; width: min(560px, 100vw); height: 100dvh;
          background: var(--surface); color: var(--text); box-shadow: var(--shadow); transform: translateX(102%);
          transition: transform 240ms ease-out; display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto; overflow: hidden;
        }
        .drawer.open { transform: translateX(0); }
        .drawer-header { padding: 24px 24px 18px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--border); }
        .eyebrow { margin: 0 0 3px; color: var(--primary); font-size: 12px; font-weight: 800; letter-spacing: .16em; }
        h2 { margin: 0; font-size: 25px; line-height: 1.2; letter-spacing: -.025em; }
        .subline { margin: 5px 0 0; color: var(--text-muted); font-size: 13px; }
        .icon-button { width: 44px; height: 44px; padding: 0; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-alt); display: grid; place-items: center; }
        .icon-button:hover { border-color: var(--primary); color: var(--primary); }
        .controls { padding: 12px 24px; border-bottom: 1px solid var(--border); background: var(--surface-alt); }
        .type-picker {
          min-height: 68px; padding: 10px 11px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-raised);
          display: grid; grid-template-columns: 40px minmax(0, 1fr) 124px; align-items: center; gap: 10px;
          transition: border-color 180ms ease-out, box-shadow 180ms ease-out, background 180ms ease-out;
        }
        .type-picker:hover { border-color: color-mix(in srgb, var(--primary) 30%, var(--border)); }
        .type-picker:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 12%, transparent); }
        .type-picker-icon {
          width: 40px; height: 40px; border-radius: 11px; background: color-mix(in srgb, var(--primary) 11%, transparent); color: var(--primary);
          display: grid; place-items: center;
        }
        .type-picker-icon svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
        .type-picker-copy { min-width: 0; display: grid; gap: 2px; }
        .type-picker-copy strong { font-size: 13px; line-height: 1.35; }
        .type-picker-copy small { overflow: hidden; color: var(--text-muted); font-size: 11px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
        .type-select-shell { position: relative; min-width: 0; }
        .type-select-shell select {
          width: 100%; height: 44px; padding: 0 34px 0 12px; border: 1px solid color-mix(in srgb, var(--primary) 16%, var(--border)); border-radius: 10px;
          appearance: none; -webkit-appearance: none; background: var(--surface-alt); color: var(--text); font-size: 13px; font-weight: 750; cursor: pointer;
          transition: border-color 180ms ease-out, background 180ms ease-out;
        }
        .type-select-shell select:hover { border-color: color-mix(in srgb, var(--primary) 48%, var(--border)); background: var(--surface); }
        .type-select-arrow { position: absolute; right: 10px; top: 50%; width: 18px; height: 18px; color: var(--primary); pointer-events: none; transform: translateY(-50%); display: grid; place-items: center; }
        .type-select-arrow svg { width: 17px; height: 17px; fill: currentColor; }
        .progress-region { padding: 10px 24px 0; min-height: 42px; background: var(--surface); }
        .progress-copy { display: flex; justify-content: space-between; gap: 16px; color: var(--text-muted); font-size: 12px; }
        .progress-track { height: 3px; margin-top: 7px; overflow: hidden; background: var(--surface-alt); border-radius: 99px; }
        .progress-track span { display: block; width: 100%; height: 100%; transform: scaleX(0); transform-origin: left; background: var(--primary); transition: transform 180ms ease-out; }
        .progress-track.active span { animation: progress-pulse 1.4s ease-in-out infinite; }
        .content { min-height: 0; overflow: auto; padding: 18px 24px 28px; overscroll-behavior: contain; }
        .welcome, .error { min-height: 55vh; display: grid; align-content: center; justify-items: center; text-align: center; max-width: 400px; margin: auto; }
        .welcome-mark, .error-icon { width: 64px; height: 64px; border-radius: 20px; display: grid; place-items: center; background: var(--surface-alt); color: var(--primary); }
        .welcome-mark svg, .error-icon svg { width: 32px; height: 32px; fill: currentColor; }
        .welcome h3, .error h3 { margin: 20px 0 8px; font-size: 22px; }
        .welcome > p, .error > p { margin: 0 0 22px; color: var(--text-muted); }
        .privacy { margin-top: 15px !important; font-size: 12px; }
        .primary, .secondary, .ghost { min-height: 44px; border-radius: 10px; padding: 0 15px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; text-decoration: none; font-weight: 750; }
        .primary { border: 1px solid var(--primary); background: var(--primary); color: var(--on-primary); }
        .primary:hover { background: var(--primary-strong); }
        .secondary { border: 1px solid var(--border); background: var(--surface); color: var(--text); }
        .secondary:hover { border-color: var(--primary); color: var(--primary); }
        .ghost { border: 1px solid transparent; background: transparent; color: var(--text-muted); }
        .ghost:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); }
        .compact { min-height: 38px; padding: 0 11px; font-size: 13px; }
        .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
        .summary > div { padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-alt); display: grid; gap: 1px; }
        .summary strong { font-size: 18px; font-variant-numeric: tabular-nums; }
        .summary span { color: var(--text-muted); font-size: 11px; }
        .recommendation-list { display: grid; gap: 12px; }
        .recommendation-card { position: relative; display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 15px; padding: 15px; border: 1px solid var(--border); border-radius: 15px; background: var(--surface-raised); }
        .rank { position: absolute; top: 8px; left: 8px; z-index: 1; min-width: 27px; padding: 3px 6px; border-radius: 7px; background: rgba(23, 23, 23, .82); color: #fff; font-size: 11px; font-weight: 800; font-variant-numeric: tabular-nums; }
        .cover { width: 88px; height: 124px; border-radius: 9px; overflow: hidden; background: var(--surface-alt); display: grid; place-items: center; text-decoration: none; }
        .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .cover-placeholder { color: var(--text-muted); font-size: 10px; font-weight: 800; line-height: 1.1; text-align: center; }
        .card-body { min-width: 0; }
        .title-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
        .title-row h3 { margin: 0; font-size: 16px; line-height: 1.35; }
        .title-row h3 a { color: var(--text); text-decoration: none; }
        .title-row h3 a:hover { color: var(--primary); }
        .original { margin: 3px 0 0; color: var(--text-muted); font-size: 11px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .fit-score { flex: 0 0 auto; min-width: 54px; display: grid; justify-items: end; }
        .fit-score strong { color: var(--primary); font-size: 23px; line-height: 1; font-variant-numeric: tabular-nums; }
        .fit-score span { color: var(--text-muted); font-size: 10px; }
        .metrics { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 8px; color: var(--text-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
        .content-tag-row { display: flex; align-items: flex-start; gap: 8px; margin-top: 9px; }
        .content-tag-label { flex: 0 0 auto; padding-top: 3px; color: var(--text-muted); font-size: 10px; font-weight: 800; letter-spacing: .04em; }
        .content-tags { min-width: 0; display: flex; flex-wrap: wrap; gap: 5px; }
        .content-tags span { padding: 3px 7px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-alt); color: var(--text); font-size: 11px; line-height: 1.35; }
        .confidence { color: var(--accent); font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; text-decoration: underline dotted color-mix(in srgb, var(--accent) 55%, transparent); text-underline-offset: 3px; cursor: help; }
        .evidence-panel { margin: 10px 0 12px; padding: 9px 10px 10px; border: 1px solid color-mix(in srgb, var(--primary) 14%, var(--border)); border-radius: 10px; background: var(--surface-alt); }
        .evidence-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 7px; border-bottom: 1px solid var(--border); }
        .evidence-header > strong { font-size: 11px; letter-spacing: .04em; }
        .evidence-list { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 7px; }
        .evidence-list li { display: grid; grid-template-columns: 38px minmax(0, 1fr); align-items: start; gap: 8px; }
        .evidence-kind { min-width: 38px; padding: 2px 5px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-raised); color: var(--text-muted); font-size: 10px; font-weight: 800; line-height: 1.45; text-align: center; }
        .evidence-list p { min-width: 0; margin: 0; color: var(--text-muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
        .evidence-list p strong { color: var(--text); font-weight: 700; }
        .card-actions { display: flex; flex-wrap: wrap; gap: 7px; }
        .method-note { margin-top: 16px; overflow: hidden; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-alt); transition: border-color 180ms ease-out, background 180ms ease-out; }
        .method-note[open] { border-color: color-mix(in srgb, var(--primary) 34%, var(--border)); background: var(--surface-raised); }
        .method-note summary { min-height: 64px; padding: 10px 14px; cursor: pointer; display: grid; grid-template-columns: 36px minmax(0, 1fr) 28px; align-items: center; gap: 11px; list-style: none; }
        .method-note summary::-webkit-details-marker { display: none; }
        .method-note summary::marker { display: none; content: ""; }
        .method-note summary:hover .method-copy strong { color: var(--primary); }
        .method-icon { width: 36px; height: 36px; border-radius: 10px; background: color-mix(in srgb, var(--primary) 11%, transparent); color: var(--primary); display: grid; place-items: center; }
        .method-icon svg { width: 18px; height: 18px; fill: currentColor; }
        .method-copy { min-width: 0; display: grid; gap: 2px; }
        .method-copy strong { font-size: 13px; line-height: 1.35; transition: color 180ms ease-out; }
        .method-copy small { overflow: hidden; color: var(--text-muted); font-size: 11px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
        .method-chevron { width: 28px; height: 28px; border-radius: 8px; color: var(--text-muted); display: grid; place-items: center; transition: transform 180ms ease-out, color 180ms ease-out; }
        .method-chevron svg { width: 18px; height: 18px; fill: currentColor; }
        .method-note[open] .method-chevron { transform: rotate(180deg); color: var(--primary); }
        .method-body { padding: 14px; border-top: 1px solid var(--border); }
        .method-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 13px; }
        .method-steps li { display: grid; grid-template-columns: 26px minmax(0, 1fr); align-items: start; gap: 10px; }
        .step-number { width: 26px; height: 26px; border: 1px solid color-mix(in srgb, var(--primary) 28%, var(--border)); border-radius: 8px; color: var(--primary); font-size: 11px; font-weight: 800; font-variant-numeric: tabular-nums; display: grid; place-items: center; }
        .method-steps strong { display: block; margin: 1px 0 2px; font-size: 12px; line-height: 1.4; }
        .method-steps p { margin: 0; color: var(--text-muted); font-size: 12px; line-height: 1.55; }
        .method-confidence { margin: 13px 0 0; padding: 10px 11px; border: 1px solid var(--border); border-radius: 9px; color: var(--text-muted); font-size: 11px; line-height: 1.55; }
        .method-confidence strong { color: var(--text); }
        .method-privacy { margin: 13px 0 0; padding: 10px 11px; border-radius: 9px; background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--text-muted); font-size: 11px; line-height: 1.5; }
        .drawer-footer { min-height: 66px; padding: 10px 24px max(10px, env(safe-area-inset-bottom)); border-top: 1px solid var(--border); background: var(--surface); display: flex; align-items: center; gap: 8px; }
        .drawer-footer button { min-height: 44px; }
        .version { margin-left: auto; color: var(--text-muted); font-size: 11px; }
        .refresh-data svg { width: 17px; height: 17px; }
        .spinning svg { animation: spin 1s linear infinite; }
        .toast { position: absolute; left: 20px; right: 20px; bottom: 76px; z-index: 5; min-height: 50px; padding: 8px 10px 8px 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--text); color: var(--surface); box-shadow: var(--shadow); display: flex; align-items: center; gap: 10px; }
        .toast[hidden] { display: none; }
        .toast span { flex: 1; font-size: 13px; }
        .toast button { min-width: 56px; min-height: 36px; border: 0; border-radius: 8px; background: var(--surface); color: var(--text); font-weight: 700; }
        [hidden] { display: none !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes progress-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
        @media (max-width: 560px) {
          .drawer-header { padding: 18px 16px 14px; }
          h2 { font-size: 22px; }
          .controls { padding: 12px 16px; }
          .progress-region { padding-inline: 16px; }
          .content { padding: 15px 16px 24px; }
          .drawer-footer { padding-inline: 16px; }
          .recommendation-card { grid-template-columns: 72px minmax(0, 1fr); gap: 12px; padding: 12px; }
          .cover { width: 72px; height: 102px; }
          .fit-score strong { font-size: 20px; }
          .ghost.compact span { display: none; }
          .summary > div { padding: 9px; }
        }
        @media (max-width: 390px) {
          .launcher { right: 12px; bottom: max(68px, calc(env(safe-area-inset-bottom) + 12px)); width: 52px; min-height: 52px; padding: 6px; border-radius: 16px; }
          .launcher-mark { width: 38px; height: 38px; }
          .launcher-copy, .launcher-arrow { display: none; }
          .type-picker { grid-template-columns: 40px minmax(0, 1fr) 110px; padding-inline: 10px; }
          .type-picker-copy small { display: none; }
          .recommendation-card { grid-template-columns: 64px minmax(0, 1fr); }
          .cover { width: 64px; height: 90px; }
          .title-row { gap: 6px; }
          .metrics span:nth-child(2) { display: none; }
          .drawer-footer .refresh-data span { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
        }
      </style>`;
    }
  }

  function clamp01(value) {
    return Math.min(1, Math.max(0, Number(value) || 0));
  }

  function start() {
    const app = new RecommenderApp();
    app.mount();
    globalThis.BangumiPersonalRecommender = app;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();

