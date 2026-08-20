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
    meta: 0.8,
    director: 0.35,
    studio: 0.3,
    creator: 0.35,
    series: 0.25,
    script: 0.25,
    music: 0.2,
    cv: 0.08,
    decade: 0.18,
    format: 0.15,
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

  function classifyBookOrigin(subjectInput) {
    const subject = normalizeSubject(subjectInput);
    if (subject.type !== 1) return { status: "not_applicable", confidence: 1, evidence: [] };

    const tags = [...subject.tags, ...subject.metaTags].join(" ");
    const entries = normalizeInfoboxEntries(subject.infobox);
    const titleText = normalizeText(`${subject.name} ${subject.nameCn}`);
    let japaneseScore = 0;
    let nonJapaneseScore = 0;
    const evidence = [];
    const add = (kind, score, label) => {
      if (kind === "japanese") japaneseScore += score;
      else nonJapaneseScore += score;
      evidence.push(label);
    };

    if (/(日本|日漫|日本文学|日本文學|轻小说|輕小說|ライトノベル|漫画|漫畫|マンガ|コミック)/i.test(tags)) {
      add("japanese", 3, "日系标签");
    }
    if (/(欧美|歐美|美漫|英美文学|英美文學|国产漫画|國產漫畫|中国文学|中國文學|韩漫|韓漫|韩国文学|韓國文學)/i.test(tags)) {
      add("non_japanese", 4, "非日系标签");
    }

    const countryKey = /(国家|國家|地区|地區|原产|原產|原作国|原作國|country|region)/i;
    const creativeKey = /(出版社|出版者|文库|文庫|书系|書系|连载|連載|作者|原作|原名|原題|original|publisher|imprint|magazine)/i;
    const japaneseCountry = /(日本|japan|japanese)/i;
    const nonJapaneseCountry = /(美国|美國|英国|英國|法国|法國|德国|德國|中国|中國|韩国|韓國|俄国|俄國|俄罗斯|俄羅斯|加拿大|澳大利亚|澳大利亞|意大利|西班牙|波兰|波蘭|瑞典|挪威|united states|united kingdom|america|britain|france|germany|china|korea|russia|canada|australia|italy|spain|poland|sweden|norway)/i;
    const japanesePublisher = /(kadokawa|角川|講談社|讲谈社|集英社|小学館|小学馆|新潮社|文藝春秋|文艺春秋|白泉社|双葉社|双叶社|徳間書店|德间书店|スクウェア・エニックス|一迅社|芳文社|早川書房|早川书房|電撃文庫|电击文库|富士見|富士见|mf文庫|mf文库|ガガガ文庫|ga文庫|ga文库|メディアワークス|アスキー)/i;
    const nonJapanesePublisher = /(penguin|harper\s*collins|random house|simon\s*&\s*schuster|scholastic|bloomsbury|macmillan|bantam|spectra|gollancz|orbit books|tor books|vintage books|del rey)/i;
    const kana = /[ぁ-ゖァ-ヺ]/;

    for (const entry of entries) {
      if (countryKey.test(entry.key)) {
        if (japaneseCountry.test(entry.value)) add("japanese", 6, `${entry.key}: 日本`);
        if (nonJapaneseCountry.test(entry.value)) add("non_japanese", 6, `${entry.key}: 非日本`);
      }
      if (creativeKey.test(entry.key)) {
        if (japanesePublisher.test(entry.value)) add("japanese", 4, "日本出版社/文库");
        if (nonJapanesePublisher.test(entry.value)) add("non_japanese", 4, "非日本出版社");
        if (kana.test(entry.value)) add("japanese", 2, "日文创作信息");
      }
    }
    if (kana.test(titleText)) add("japanese", 1, "日文标题");

    const delta = japaneseScore - nonJapaneseScore;
    const confidence = clamp(Math.abs(delta) / 8, 0, 1);
    if (delta >= 2) return { status: "japanese", confidence, evidence, japaneseScore, nonJapaneseScore };
    if (delta <= -3) return { status: "non_japanese", confidence, evidence, japaneseScore, nonJapaneseScore };
    return { status: "unknown", confidence, evidence, japaneseScore, nonJapaneseScore };
  }

  function isExceptionalForeignRecommendation(scoredSubject) {
    return Boolean(
      scoredSubject &&
      Number(scoredSubject.confidenceScore || 0) >= 0.82 &&
      Number(scoredSubject.predicted || 0) >= 8.6 &&
      Number(scoredSubject.contentScore || 0) >= 0.6 &&
      Number(scoredSubject.nearest?.similarity || 0) >= 0.38 &&
      (scoredSubject.positiveReasons?.length || 0) >= 2
    );
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
    return normalizeText(value).replace(/[\s._・·—–-]+/g, "");
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
    const subjectCredits = extractInfoboxCredits(subject.infobox);
    const creditsByAlias = new Map(subjectCredits.map((credit) => [creditAlias(credit.label), credit]));
    const creditedLabels = new Set();

    const tagValues = [...new Set([...normalizeTagList(collectionTags), ...subject.tags])]
      .filter((tag) => !TEMPORAL_TAG.test(tag))
      .slice(0, 18);
    for (const tag of tagValues) {
      const credit = creditsByAlias.get(creditAlias(tag));
      if (credit) {
        addGroupedFeature(groups, credit.role, `name:${normalizeText(credit.label)}`, credit.label);
        creditedLabels.add(`${credit.role}:${normalizeText(credit.label)}`);
      } else {
        addGroupedFeature(groups, "tag", tag, tag);
      }
    }

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
      if (role && id) {
        const label = person.name || person.name_cn || id;
        if (!creditedLabels.has(`${role}:${normalizeText(label)}`)) addGroupedFeature(groups, role, id, label);
        creditedLabels.add(`${role}:${normalizeText(label)}`);
      }
    }
    for (const { role, label } of subjectCredits) {
      const normalizedLabel = normalizeText(label);
      if (!normalizedLabel || creditedLabels.has(`${role}:${normalizedLabel}`)) continue;
      addGroupedFeature(groups, role, `name:${normalizedLabel}`, label);
      creditedLabels.add(`${role}:${normalizedLabel}`);
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
        .map(normalizeText)
        .filter(Boolean),
    );
    for (const entry of subject.infobox) {
      const key = normalizeText(entry?.key || entry?.k || "");
      if (!/(?:别名|別名|中文名|英文名|原名|原題|alias|title)/i.test(key)) continue;
      for (const alias of infoboxValueText(entry?.value ?? entry?.v ?? "").split(/[、，,\/／;；\n]/)) {
        const normalizedAlias = normalizeText(alias);
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
        !titleAliases.has(normalizeText(entry.label)) &&
        [...entry.label].length <= 18,
      )
      .sort((a, b) => b.score - a.score);
    const selected = [];
    let usedCharacters = 0;
    for (const entry of ranked) {
      const cost = [...entry.label].length + (selected.length ? 1 : 0);
      if (selected.length && usedCharacters + cost > characterBudget) continue;
      selected.push(entry);
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

    if (scoredSubject?.bookOriginOverride) {
      candidates.push({ kind: "exception", strength: 2, cost: 28 });
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
    const order = { exception: 0, similarity: 1, creative: 2, quality: 3 };
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

    const featureMass = contributions.reduce(
      (sum, entry) => sum + Math.abs(Number(vector.features[entry.token] || 0)),
      0,
    );
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
        const maxSimilarity = selected.length
          ? Math.max(...selected.map((item) => weightedJaccard(candidate.features, item.features)))
          : 0;
        const studioTokens = Object.keys(candidate.features).filter((token) => token.startsWith("studio:"));
        const sameStudioCount = selected.filter((item) =>
          studioTokens.some((token) => item.features[token]),
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
    classifyBookOrigin,
    isExceptionalForeignRecommendation,
    diversify,
    recommendationSalt,
    collectionFingerprint,
    influentialSubjectIds,
    topRetrievalTags,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  globalObject.BangumiRecommenderCore = Core;
})(typeof globalThis !== "undefined" ? globalThis : window);
