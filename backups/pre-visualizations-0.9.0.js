// ==UserScript==
// @name         Bangumi 个性推荐
// @namespace    https://bgm.tv/user/wylt
// @version      0.9.0
// @description  个性化推荐与仅含看过动画的回顾统计：评分、集数、创作人员和声优。
// @author       wylt
// @match        https://bgm.tv/*
// @match        http://bgm.tv/*
// @match        https://bangumi.tv/*
// @match        http://bangumi.tv/*
// @match        https://chii.in/*
// @match        http://chii.in/*
// ==/UserScript==

(function attachProfileUI(global) {
  "use strict";
  const isProfile = () => /^(bgm\.tv|bangumi\.tv|chii\.in)$/.test(location.hostname)
    ? /^\/user\/wylt\/?$/.test(location.pathname)
    : /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && Boolean(document.querySelector('[data-bgm-profile-demo]'));
  function mount(id, order) {
    if (!isProfile() || document.getElementById(id)) return null;
    const column = document.getElementById('user_home');
    if (!column) return null;
    let area = document.getElementById('bgmpr-profile-sections');
    if (!area) {
      area = document.createElement('div');
      area.id = 'bgmpr-profile-sections';
      area.style.cssText = 'display:flex;flex-direction:column;gap:32px;clear:both;width:100%;min-width:0;margin:28px 0 36px';
      const blog = column.querySelector('#blog');
      if (blog) blog.after(area); else column.append(area);
    }
    const host = document.createElement('div');
    host.id = id;
    host.style.cssText = `display:block;min-width:0;width:100%;order:${order}`;
    area.append(host);
    return host;
  }
  function theme() {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'dark' || explicit === 'light') return explicit;
    return /dark|night/i.test(`${document.documentElement.className} ${document.body?.className || ''}`)
      || matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function lazy(host, callback) {
    let started = false;
    const run = () => { if (!started) { started = true; callback(); } };
    if (!('IntersectionObserver' in global)) { run(); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); run(); }
    }, { rootMargin: '300px' });
    observer.observe(host);
  }
  const css = `
    :host{--ink:#444;--muted:#777;--line:#eee;--surface:#fff;--soft:#fafafa;--pink:#f09199;--pink-soft:#fff1f3;--link:#a74458;--site-link:#16718b;display:block;font:13px/1.6 Arial,"Microsoft YaHei",sans-serif;color:var(--ink);container-type:inline-size;color-scheme:light}
    :host([data-theme="dark"]){--ink:#ddd;--muted:#aaa;--line:#383838;--surface:#202020;--soft:#282828;--pink:#e99aa7;--pink-soft:#39282d;--link:#efa6b3;--site-link:#8ec9dc;color-scheme:dark}
    *,*::before,*::after{box-sizing:border-box} [hidden]{display:none!important}
    button,input,select{font:inherit}button,summary,select{cursor:pointer}button{border:0;background:transparent;color:var(--muted);padding:5px 10px;border-radius:6px;transition:background .18s,color .18s}button:hover:not(:disabled),summary:hover{color:var(--link);background:var(--pink-soft)}button:disabled{opacity:.4;cursor:default}
    a{color:var(--site-link);text-decoration:none}a:hover{color:var(--link);text-decoration:underline}
    :is(a,button,input,select,summary):focus-visible{outline:2px solid var(--link);outline-offset:3px}
    h2,h3,p{margin:0}h2{font-size:18px;font-weight:400;color:var(--muted)}h3{font-size:13px;font-weight:400}
    .module{min-width:0;background:var(--surface)}.module-head{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:0 0 9px;border-bottom:1px solid var(--line);margin-bottom:16px}.module-head h2{margin-right:auto}.module-head>button{font-size:12px}
    .tabs{display:flex;flex-wrap:wrap;gap:3px;padding:3px;background:var(--soft);border-radius:8px;width:fit-content;max-width:100%}.tabs button{padding:4px 12px;font-size:12px}.tabs button[aria-pressed="true"]{background:var(--pink);color:#40232a}
    .content{min-width:0}.empty,.error{padding:24px 8px;color:var(--muted);text-align:center}.empty button,.error button,.welcome button{color:var(--link);background:var(--pink-soft);margin-top:10px}
    .progress-region,.progress{margin:10px 0;color:var(--muted);font-size:12px}.progress-copy{display:flex;justify-content:space-between;gap:12px}.progress-track{height:2px;background:var(--line);margin-top:6px}.progress-track span{display:block;height:100%;background:var(--pink);transform-origin:left;transform:scaleX(0)}
    .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
    svg{width:16px;height:16px;vertical-align:middle}select,input{color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:5px 8px;max-width:100%}
    @container(max-width:500px){.module-head{gap:8px}.tabs button{padding:7px 10px}button,summary{min-height:36px}input,select{font-size:16px}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
  `;
  global.BangumiProfileUI = { mount, theme, lazy, css, isProfile };
})(globalThis);


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
  const ADULT_RECOMMENDATION_TAGS = Object.freeze({
    profile: Object.freeze(["里番", "裏番", "步兵裡番", "泡面里番", "成人动画", "r18", "18x", "18禁"]),
    direct: Object.freeze(["里番", "裏番", "步兵裡番", "泡面里番", "成人动画"]),
    strongDirect: Object.freeze(["步兵裡番", "泡面里番", "成人动画"]),
    supplemental: Object.freeze(["r18", "18x", "18禁"]),
    corroborating: Object.freeze([
      "实用", "无码", "本番", "里番下限", "成人向", "成人三部曲", "有h", "有h哦", "hentai",
      "エロ", "エロアニメ", "色情", "官能", "三级", "拔作", "抜きゲー", "r17", "r18+", "18+",
      "poro", "ピンクパイナップル", "queenbee",
      "メリー・ジェーン", "mary jane", "t-rex", "雷火剣", "雷火剑", "milky", "discovery", "nur",
    ]),
  });
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

  function subjectHasTag(subjectInput, tagInput) {
    const target = normalizeText(tagInput);
    if (!target) return false;
    const subject = normalizeSubject(subjectInput);
    return [...subject.tags, ...subject.metaTags].includes(target);
  }

  function collectionHasTag(collectionInput, tagInput) {
    const target = normalizeText(tagInput);
    if (!target) return false;
    const collection = normalizeCollection(collectionInput);
    return [...collection.tags, ...collection.subject.tags, ...collection.subject.metaTags].includes(target);
  }

  function isAdultRecommendationCandidate(subjectInput, allowDirectOnly = false) {
    const subject = normalizeSubject(subjectInput);
    const tags = new Set([...subject.tags, ...subject.metaTags]);
    const containsAny = (values) => values.some((value) => tags.has(normalizeText(value)));
    const hasDirect = containsAny(ADULT_RECOMMENDATION_TAGS.direct);
    if (allowDirectOnly && hasDirect) return true;
    const hasStrongDirect = containsAny(ADULT_RECOMMENDATION_TAGS.strongDirect);
    const hasDirectConsensus = ADULT_RECOMMENDATION_TAGS.direct.some((value) => {
      const tag = normalizeText(value);
      return tags.has(tag) && Number(subject.tagCounts[tag] || 0) >= 3;
    });
    if (hasStrongDirect || hasDirectConsensus) return true;
    const supplementalCount = ADULT_RECOMMENDATION_TAGS.supplemental
      .filter((value) => tags.has(normalizeText(value))).length;
    const hasCorroboration = containsAny(ADULT_RECOMMENDATION_TAGS.corroborating)
      || [...tags].some((tag) => /\d(?:里番|裏番)$|(?:成人|hentai|エロ|色情|官能)/i.test(tag));
    return (hasDirect || supplementalCount >= 1) && hasCorroboration;
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
    const tagCounts = {};
    for (const tag of Array.isArray(raw.tags) ? raw.tags : []) {
      if (!tag || typeof tag !== "object") continue;
      const name = normalizeText(tag.name);
      if (name) tagCounts[name] = Math.max(Number(tagCounts[name] || 0), Number(tag.count || 0));
    }
    for (const [nameInput, count] of Object.entries(raw.tagCounts || {})) {
      const name = normalizeText(nameInput);
      if (name) tagCounts[name] = Math.max(Number(tagCounts[name] || 0), Number(count || 0));
    }
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
      tagCounts,
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
      adultEvidenceVerified: raw.adultEvidenceVerified === undefined
        ? undefined
        : Boolean(raw.adultEvidenceVerified),
      adultVerificationPriority: Number(raw.adultVerificationPriority || 0),
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
    const remaining = scoredInputs.map((item) => ({
      item,
      maxSimilarity: 0,
      sameStudioCount: 0,
      studioTokens: Object.keys(item.diversityFeatures || item.features || {})
        .filter((token) => token.startsWith("studio:")),
    }));
    const selected = [];
    while (selected.length < count && remaining.length) {
      let bestIndex = -1;
      let bestValue = -Infinity;
      for (let index = 0; index < remaining.length; index += 1) {
        const entry = remaining[index];
        const candidate = entry.item;
        const explorationJitter = mode === "explore" ? (seededNoise(candidate.subject.id, salt) - 0.5) * 0.08 : 0;
        const studioPenalty = Math.min(2, Math.max(0, entry.sameStudioCount - 1)) * 0.12;
        const adjusted =
          candidate.normalizedScore -
          penalty * entry.maxSimilarity -
          studioPenalty +
          explorationJitter;
        if (adjusted > bestValue) {
          bestValue = adjusted;
          bestIndex = index;
        }
      }
      const [chosen] = remaining.splice(bestIndex, 1);
      selected.push(chosen.item);
      const chosenFeatures = chosen.item.diversityFeatures || chosen.item.features || {};
      for (const entry of remaining) {
        const candidateFeatures = entry.item.diversityFeatures || entry.item.features || {};
        entry.maxSimilarity = Math.max(
          entry.maxSimilarity,
          weightedJaccard(candidateFeatures, chosenFeatures),
        );
        if (entry.studioTokens.some((token) => chosenFeatures[token])) entry.sameStudioCount += 1;
      }
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
    ADULT_RECOMMENDATION_TAGS,
    clamp,
    normalizeText,
    normalizeTagList,
    subjectHasTag,
    collectionHasTag,
    isAdultRecommendationCandidate,
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


(function attachBangumiPersonalStatsCore(globalObject) {
  "use strict";

  const STATUS_LABELS = Object.freeze({
    1: "想看",
    2: "看过",
    3: "在看",
    4: "搁置",
    5: "抛弃",
  });

  const ROLE_GROUPS = Object.freeze({
    directors: {
      label: "导演",
      test: (relation) => /(?:导演|監督|总导演|總監督|chief director|director)/i.test(relation),
    },
    series: {
      label: "系列构成",
      test: (relation) => /(?:系列构成|系列構成|シリーズ構成|构成\s*·?\s*脚本|構成\s*·?\s*脚本)/i.test(relation),
    },
    studios: {
      label: "动画制作",
      test: (relation) => /(?:动画制作|動畫製作|アニメーション制作|动画製作|制作公司)/i.test(relation),
    },
    originals: {
      label: "原作 / 原案",
      test: (relation) => /(?:原作|原案|漫画原作|漫畫原作|小说原作|小說原作)/i.test(relation),
    },
    scripts: {
      label: "脚本",
      test: (relation) => /(?:脚本|腳本|剧本|劇本)/i.test(relation),
    },
    music: {
      label: "音乐",
      test: (relation) => /(?:^|[、,/\s])(?:音乐|音楽|配乐|配樂)(?:$|[、,/\s])/i.test(relation),
    },
    characterDesign: {
      label: "角色设计",
      test: (relation) => /(?:人物设定|人物設定|角色设计|角色設計|character design)/i.test(relation),
    },
  });

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function text(value) {
    return String(value || "").trim();
  }

  function subjectOf(row) {
    const subject = row?.subject || row || {};
    return {
      id: number(subject.id || row?.subject_id),
      name: text(subject.name),
      nameCn: text(subject.name_cn || subject.nameCn),
      date: text(subject.date),
      eps: number(subject.eps || subject.total_episodes),
      type: number(subject.type || row?.subject_type),
      image: text(subject.images?.grid || subject.images?.small || subject.image),
    };
  }

  function compactCollection(row) {
    return {
      subject: subjectOf(row),
      subjectId: number(row?.subject_id || row?.subjectId || row?.subject?.id || row?.id),
      status: number(row?.type || row?.status || row?.collectionType),
      rate: number(row?.rate),
      epStatus: number(row?.ep_status || row?.epStatus),
      tags: Array.isArray(row?.tags) ? row.tags.map(text).filter(Boolean) : [],
      updatedAt: text(row?.updated_at || row?.updatedAt),
      private: Boolean(row?.private),
    };
  }

  function compactPersons(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      id: number(row?.id),
      name: text(row?.name),
      relation: text(row?.relation),
      type: number(row?.type),
      eps: text(row?.eps),
    })).filter((row) => row.id && row.name && row.relation);
  }

  function compactCharacters(rows) {
    return (Array.isArray(rows) ? rows : []).map((character) => ({
      id: number(character?.id),
      name: text(character?.name),
      relation: text(character?.relation),
      actors: (Array.isArray(character?.actors) ? character.actors : []).map((actor) => ({
        id: number(actor?.id),
        name: text(actor?.name),
      })).filter((actor) => actor.id && actor.name),
    })).filter((character) => character.id && character.actors.length);
  }

  function average(scores) {
    return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  }

  function yearOfTimestamp(value) {
    const raw = text(value);
    const leadingYear = raw.match(/^(?:19|20)\d{2}/)?.[0];
    if (leadingYear) return number(leadingYear);
    const numeric = Number(raw);
    const date = Number.isFinite(numeric) && numeric > 0
      ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
      : new Date(raw);
    return Number.isNaN(date.getTime()) ? 0 : date.getFullYear();
  }

  function createBucket(row) {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      works: new Set(),
      eps: 0,
      ratedScores: [],
      characterCount: 0,
      mainCharacterCount: 0,
    };
  }

  function addWork(bucket, collection, extras = {}) {
    const subjectId = collection.subject.id;
    if (!bucket.works.has(subjectId)) {
      bucket.works.add(subjectId);
      bucket.eps += collection.subject.eps;
      if (collection.rate > 0) bucket.ratedScores.push(collection.rate);
    }
    bucket.characterCount += number(extras.characterCount);
    bucket.mainCharacterCount += number(extras.mainCharacterCount);
  }

  function finalizeBuckets(map) {
    return [...map.values()].map((bucket) => ({
      id: bucket.id,
      name: bucket.name,
      type: bucket.type,
      works: bucket.works.size,
      eps: bucket.eps,
      averageRate: average(bucket.ratedScores),
      ratedWorks: bucket.ratedScores.length,
      characterCount: bucket.characterCount,
      mainCharacterCount: bucket.mainCharacterCount,
    })).sort((a, b) => b.works - a.works || b.averageRate - a.averageRate || b.eps - a.eps || a.name.localeCompare(b.name, "zh-CN"));
  }

  function rankEntries(entries, mode = "works", topShare = 0.1) {
    const rows = Array.isArray(entries) ? [...entries] : [];
    const byWorks = (a, b) => b.works - a.works || b.averageRate - a.averageRate || b.ratedWorks - a.ratedWorks || b.eps - a.eps || a.name.localeCompare(b.name, "zh-CN");
    if (mode !== "average" || !rows.length) return { rows: rows.sort(byWorks), cutoffWorks: 0, eligibleCount: rows.length };

    const validShare = Math.min(1, Math.max(0.01, number(topShare) || 0.1));
    const workRanked = [...rows].sort(byWorks);
    const cutoffIndex = Math.max(0, Math.ceil(workRanked.length * validShare) - 1);
    const cutoffWorks = workRanked[cutoffIndex]?.works || 0;
    const eligible = rows.filter((row) => row.works >= cutoffWorks && row.ratedWorks > 0);
    eligible.sort((a, b) => b.averageRate - a.averageRate || b.ratedWorks - a.ratedWorks || b.works - a.works || b.eps - a.eps || a.name.localeCompare(b.name, "zh-CN"));
    return { rows: eligible, cutoffWorks, eligibleCount: eligible.length };
  }

  function aggregate(collectionRows, personEntries = {}, characterEntries = {}) {
    const collections = collectionRows.map(compactCollection).filter((row) => row.subject.id);
    const currentYear = new Date().getFullYear();
    const rated = collections.filter((row) => row.rate > 0);
    const knownEps = collections.filter((row) => row.subject.eps > 0);
    const status = {};
    const ratingDistribution = {};
    const years = {};
    const tags = {};
    for (const row of collections) status[row.status] = (status[row.status] || 0) + 1;
    for (const row of rated) ratingDistribution[row.rate] = (ratingDistribution[row.rate] || 0) + 1;
    for (const row of collections) {
      const year = row.subject.date.match(/^(?:19|20)\d{2}/)?.[0];
      if (year) years[year] = (years[year] || 0) + 1;
      for (const tag of row.tags) {
        const normalized = text(tag);
        if (normalized) tags[normalized] = (tags[normalized] || 0) + 1;
      }
    }

    const groups = {
      ...Object.fromEntries(Object.keys(ROLE_GROUPS).map((key) => [key, new Map()])),
      cast: new Map(),
    };
    let peopleSubjects = 0;
    let castSubjects = 0;

    for (const collection of collections) {
      const subjectId = collection.subject.id;
      const people = personEntries[subjectId];
      if (Array.isArray(people)) {
        peopleSubjects += 1;
        const seen = new Set();
        for (const person of people) {
          const relation = text(person.relation);
          for (const [key, group] of Object.entries(ROLE_GROUPS)) {
            if (!group.test(relation)) continue;
            const uniqueKey = `${key}:${person.id}`;
            if (seen.has(uniqueKey)) continue;
            seen.add(uniqueKey);
            const bucket = groups[key].get(person.id) || createBucket(person);
            addWork(bucket, collection);
            groups[key].set(person.id, bucket);
          }
        }
      }

      const characters = characterEntries[subjectId];
      if (Array.isArray(characters)) {
        castSubjects += 1;
        const actorCharacters = new Map();
        for (const character of characters) {
          const isMain = /(?:主角|主役|主人公|main)/i.test(text(character.relation));
          for (const actor of character.actors || []) {
            const record = actorCharacters.get(actor.id) || { actor, characters: new Set(), main: new Set() };
            record.characters.add(character.id);
            if (isMain) record.main.add(character.id);
            actorCharacters.set(actor.id, record);
          }
        }
        for (const record of actorCharacters.values()) {
          const bucket = groups.cast.get(record.actor.id) || createBucket(record.actor);
          addWork(bucket, collection, {
            characterCount: record.characters.size,
            mainCharacterCount: record.main.size,
          });
          groups.cast.set(record.actor.id, bucket);
        }
      }
    }

    return {
      overview: {
        works: collections.length,
        ratedWorks: rated.length,
        averageRate: average(rated.map((row) => row.rate)),
        knownEpisodes: knownEps.reduce((sum, row) => sum + row.subject.eps, 0),
        knownEpisodeWorks: knownEps.length,
        averageEpisodes: knownEps.length ? knownEps.reduce((sum, row) => sum + row.subject.eps, 0) / knownEps.length : 0,
        watchedEpisodes: collections.reduce((sum, row) => sum + row.epStatus, 0),
        watchedThisYear: collections.filter((row) => yearOfTimestamp(row.updatedAt) === currentYear).length,
        currentYear,
        status: Object.entries(status).map(([id, count]) => ({ id: number(id), label: STATUS_LABELS[id] || "未分类", count })).sort((a, b) => a.id - b.id),
      },
      coverage: {
        peopleSubjects,
        castSubjects,
        totalSubjects: collections.length,
      },
      groups: Object.fromEntries(Object.entries(groups).map(([key, map]) => [key, finalizeBuckets(map)])),
      distributions: {
        ratings: Array.from({ length: 10 }, (_, index) => ({ score: index + 1, count: ratingDistribution[index + 1] || 0 })),
        years: Object.entries(years).map(([year, count]) => ({ year: number(year), count })).sort((a, b) => b.year - a.year),
        tags: Object.entries(tags).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN")),
        longest: [...knownEps].sort((a, b) => b.subject.eps - a.subject.eps || a.subject.name.localeCompare(b.subject.name, "zh-CN")).map((row) => ({
          id: row.subject.id, name: row.subject.name, nameCn: row.subject.nameCn, eps: row.subject.eps,
        })),
      },
    };
  }

  const Core = Object.freeze({
    STATUS_LABELS,
    ROLE_GROUPS,
    compactCollection,
    compactPersons,
    compactCharacters,
    rankEntries,
    aggregate,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  globalObject.BangumiPersonalStatsCore = Core;
})(globalThis);


(function bootstrapBangumiPersonalStats() {
  "use strict";

  const Core = globalThis.BangumiPersonalStatsCore;
  if (!Core || document.getElementById("bgmstats-host")) return;

  const DEFAULT_USER = "wylt";
  const API_BASE = "https://api.bgm.tv";
  const COLLECTION_TTL = 12 * 60 * 60 * 1000;
  const ENTITY_TTL = 90 * 24 * 60 * 60 * 1000;
  const ENTITY_CONCURRENCY = 1;
  const ENTITY_DELAY = 850;
  const ENTITY_TIMEOUT = 8000;
  const ENTITY_RETRY_LIMIT = 3;
  const ENTITY_RETRY_BASE_DELAY = 1200;
  const AUTO_RESUME_BACKOFF = 15 * 60 * 1000;
  const APP_VERSION = "0.9.0";
  const RANK_PAGE_SIZE = 12;
  const TABS = Object.freeze({ overview: "年代", tags: "标签", longest: "作品", staff: "创作", cast: "声优" });

  function text(value) { return String(value ?? ""); }
  function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
  function formatNumber(value) { return new Intl.NumberFormat("zh-CN").format(number(value)); }
  function formatRate(value) { return value ? number(value).toFixed(2) : "—"; }
  function escapeHtml(value) { return text(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

  const ICONS = Object.freeze({
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/></svg>',
    launchArrow: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.75 5.25 5.25-5.25 5.25"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0 2 5.4M20 4v7h-7"/></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-4A4.5 4.5 0 0 0 3 18.5V20m12-6a4 4 0 1 0 0-8m3 8a4.5 4.5 0 0 1 3 4.24V20M9.5 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>',
    database: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.66 3.58 3 8 3s8-1.34 8-3V5m-16 7v7c0 1.66 3.58 3 8 3s8-1.34 8-3v-7"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    chevron: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg>',
  });

  class Store {
    constructor() { this.databasePromise = null; }
    open() {
      if (this.databasePromise) return this.databasePromise;
      this.databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open("bgmpr-stats", 1);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("kv")) request.result.createObjectStore("kv"); };
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
  }

  class Client {
    constructor(store, username) { this.store = store; this.username = username; }
    key(part) { return `stats:v1:${this.username}:${part}`; }
    async fetchJson(path, timeoutMilliseconds = 20000) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
      try {
        const response = await fetch(`${API_BASE}${path}`, { signal: controller.signal, credentials: "omit", headers: { Accept: "application/json" } });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          error.status = response.status;
          const retryAfter = Number(response.headers.get("Retry-After"));
          error.retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
          throw error;
        }
        return response.json();
      } finally { clearTimeout(timeout); }
    }
    async collections(force, onProgress) {
      const key = this.key("collections:api");
      const cached = await this.store.get(key);
      if (!force && cached && Date.now() - cached.storedAt < COLLECTION_TTL) return cached.value;
      const rows = [];
      let offset = 0;
      let total = Infinity;
      while (offset < total) {
        const page = await this.fetchJson(`/v0/users/${encodeURIComponent(this.username)}/collections?subject_type=2&limit=100&offset=${offset}`);
        const data = Array.isArray(page.data) ? page.data : [];
        total = number(page.total);
        rows.push(...data);
        offset += data.length;
        onProgress?.("正在同步动画收藏…", Math.min(offset, total), total);
        if (!data.length) break;
      }
      const value = rows.map(Core.compactCollection);
      await this.store.set(key, { storedAt: Date.now(), value });
      return value;
    }
    async entity(kind, subjectId) {
      const key = this.key(`${kind}:${subjectId}`);
      const cached = await this.store.get(key);
      if (cached && Date.now() - cached.storedAt < ENTITY_TTL) return cached.value;
      const path = kind === "people" ? `/v0/subjects/${subjectId}/persons` : `/v0/subjects/${subjectId}/characters`;
      let raw;
      try {
        raw = await this.fetchJson(path, ENTITY_TIMEOUT);
      } catch (error) {
        if (error?.status !== 404) throw error;
        raw = [];
      }
      const value = kind === "people" ? Core.compactPersons(raw) : Core.compactCharacters(raw);
      await this.store.set(key, { storedAt: Date.now(), value });
      return value;
    }
    async entityMap(kind, ids) {
      const result = {};
      await Promise.all(ids.map(async (id) => {
        const cached = await this.store.get(this.key(`${kind}:${id}`));
        if (cached && Date.now() - cached.storedAt < ENTITY_TTL && Array.isArray(cached.value)) result[id] = cached.value;
      }));
      return result;
    }
    async enrichmentState() {
      const cached = await this.store.get(this.key("enrichment:state"));
      return cached?.value || { enabled: false, nextAt: 0 };
    }
    async setEnrichmentState(value) {
      await this.store.set(this.key("enrichment:state"), { storedAt: Date.now(), value });
    }
  }

  class StatsDrawer {
    constructor() {
      this.store = new Store();
      this.client = new Client(this.store, DEFAULT_USER);
      this.state = {
        open: false,
        busy: false,
        syncing: false,
        jobs: { people: false, cast: false },
        cancel: false,
        activeTab: "overview",
        activeStaffGroup: "directors",
        search: { staff: "", cast: "" },
        pages: { staff: 1, cast: 1 },
        sort: { staff: "works", cast: "works" },
        expandedOverview: { years: false, tags: false, longest: false },
        collections: [],
        people: {},
        cast: {},
        entityProgress: {
          people: { cached: 0, total: 0, failed: 0, status: "idle" },
          cast: { cached: 0, total: 0, failed: 0, status: "idle" },
        },
        progress: { label: "等待同步", current: 0, total: 0, countText: "" },
        lastSync: 0,
      };
      this.lastFocused = null;
    }
    mount() {
      this.host = globalThis.BangumiProfileUI?.mount("bgmstats-host", 10);
      if (!this.host) return;
      this.shadow = this.host.attachShadow({ mode: "open" });
      this.render();
      this.shadow.addEventListener("click", (event) => this.onClick(event));
      this.shadow.addEventListener("keydown", (event) => this.onKeyDown(event));
      this.shadow.addEventListener("input", (event) => this.onInput(event));
      const updateTheme = () => { this.host.dataset.theme = this.detectTheme(); };
      updateTheme();
      new MutationObserver(updateTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
      matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", updateTheme);
      globalThis.BangumiProfileUI.lazy(this.host, () => this.open());
    }
    detectTheme() { return globalThis.BangumiProfileUI.theme(); }
    $(selector) { return this.shadow.querySelector(selector); }
    stats() { return Core.aggregate(this.state.collections, this.state.people, this.state.cast); }
    isBusy() {
      this.state.busy = this.state.syncing || Object.values(this.state.jobs).some(Boolean);
      return this.state.busy;
    }
    initializeEntityProgress() {
      const total = this.state.collections.length;
      this.state.entityProgress.people = { cached: Object.keys(this.state.people).length, total, failed: 0, status: "idle" };
      this.state.entityProgress.cast = { cached: Object.keys(this.state.cast).length, total, failed: 0, status: "idle" };
    }
    refreshEntityProgress(prefix = "关联资料") {
      const people = this.state.entityProgress.people;
      const cast = this.state.entityProgress.cast;
      const current = people.cached + cast.cached;
      const total = people.total + cast.total;
      const percent = total ? Math.round(current / total * 100) : 0;
      const failed = people.failed + cast.failed;
      const failedText = failed ? ` · ${formatNumber(failed)} 条暂不可用` : "";
      this.progress(`${prefix}：创作人员 ${formatNumber(people.cached)} / ${formatNumber(people.total)} · 声优 ${formatNumber(cast.cached)} / ${formatNumber(cast.total)}${failedText}`, current, total, total ? `${percent}%` : "");
    }
    async open() {
      this.state.open = true;
      if (!this.state.collections.length && !this.isBusy()) await this.sync(false);
    }
    close() {}
    progress(label, current = 0, total = 0, countText = null) {
      this.state.progress = { label, current, total, countText };
      const labelNode = this.$('[data-role="progress-label"]');
      if (!labelNode) { this.render(); return; }
      labelNode.textContent = label;
      const count = this.$('[data-role="progress-count"]');
      const bar = this.$('[data-role="progress-bar"]');
      if (count) count.textContent = countText ?? (total ? `${formatNumber(current)} / ${formatNumber(total)}` : "");
      if (bar) bar.style.width = `${total ? Math.min(100, Math.round(current / total * 100)) : 0}%`;
    }
    async sync(force) {
      if (this.isBusy()) return;
      this.state.syncing = true;
      this.state.cancel = false;
      this.render();
      this.progress("正在同步动画收藏…", 0, 1);
      let shouldResume = false;
      try {
        const allCollections = await this.client.collections(force, (label, current, total) => this.progress(label, current, total));
        this.state.collections = allCollections.filter((row) => row.status === 2);
        const ids = this.state.collections.map((row) => row.subjectId);
        [this.state.people, this.state.cast] = await Promise.all([this.client.entityMap("people", ids), this.client.entityMap("cast", ids)]);
        this.initializeEntityProgress();
        this.state.lastSync = Date.now();
        const enrichmentState = await this.client.enrichmentState();
        shouldResume = Boolean(enrichmentState.enabled && Date.now() >= number(enrichmentState.nextAt));
        this.refreshEntityProgress("已同步收藏");
      } catch (error) { this.progress(`同步失败：${error.message || "网络异常"}`, 0, 0); }
      finally { this.state.syncing = false; this.render(); }
      if (shouldResume && !this.state.cancel) this.enrichAll(false);
    }
    async enrichAll(userInitiated = true) {
      if (!this.state.collections.length || this.state.syncing) return;
      if (userInitiated) await this.client.setEnrichmentState({ enabled: true, nextAt: Date.now() });
      await Promise.all([this.enrich("people"), this.enrich("cast")]);
      const people = this.state.entityProgress.people;
      const cast = this.state.entityProgress.cast;
      const complete = people.cached >= people.total && cast.cached >= cast.total;
      const paused = this.state.cancel;
      await this.client.setEnrichmentState({
        enabled: !complete && !paused,
        nextAt: complete || paused ? 0 : Date.now() + AUTO_RESUME_BACKOFF,
        peopleRemaining: Math.max(0, people.total - people.cached),
        castRemaining: Math.max(0, cast.total - cast.cached),
      });
      this.refreshEntityProgress(complete ? "关联资料已完整缓存" : (paused ? "已暂停" : "本轮补全结束"));
      this.render();
    }
    async enrich(kind) {
      if (this.state.syncing || this.state.jobs[kind] || !this.state.collections.length) return;
      const target = kind === "people" ? this.state.people : this.state.cast;
      const ids = this.state.collections.map((row) => row.subjectId);
      const missing = ids.filter((id) => !Object.hasOwn(target, id));
      if (!missing.length) {
        this.state.entityProgress[kind] = { cached: ids.length, total: ids.length, failed: 0, status: "complete" };
        this.refreshEntityProgress();
        return;
      }
      this.state.jobs[kind] = true;
      this.state.cancel = false;
      this.render();
      let cachedCount = ids.length - missing.length;
      let failedCount = 0;
      const queue = [...missing];
      const attempts = new Map();
      this.state.entityProgress[kind] = { cached: cachedCount, total: ids.length, failed: 0, status: "running" };
      this.refreshEntityProgress("补全中");
      const isRetryable = (error) => !error?.status || error.status === 408 || error.status === 429 || error.status >= 500;
      const updateProgress = () => {
        this.state.entityProgress[kind] = { cached: cachedCount, total: ids.length, failed: failedCount, status: "running" };
        this.refreshEntityProgress("补全中");
      };
      const worker = async () => {
        while (!this.state.cancel && queue.length) {
          const id = queue.shift();
          try {
            target[id] = await this.client.entity(kind, id);
            cachedCount += 1;
          } catch (error) {
            const attempt = (attempts.get(id) || 0) + 1;
            attempts.set(id, attempt);
            if (isRetryable(error) && attempt < ENTITY_RETRY_LIMIT) {
              queue.push(id);
              await sleep(Math.max(number(error?.retryAfterMs), ENTITY_RETRY_BASE_DELAY * attempt));
            } else {
              failedCount += 1;
            }
          }
          updateProgress();
          await sleep(ENTITY_DELAY);
        }
      };
      try {
        await Promise.all(Array.from({ length: ENTITY_CONCURRENCY }, worker));
        this.state.entityProgress[kind] = { cached: cachedCount, total: ids.length, failed: failedCount, status: cachedCount >= ids.length ? "complete" : (this.state.cancel ? "paused" : "pending") };
      } finally {
        this.state.jobs[kind] = false;
        this.refreshEntityProgress(this.state.cancel ? "已暂停" : "补全中");
        this.render();
      }
    }
    async pauseEnrichment() {
      this.state.cancel = true;
      await this.client.setEnrichmentState({ enabled: false, nextAt: 0 });
      this.refreshEntityProgress("已暂停");
    }
    onClick(event) {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;
      if (action === "open") this.open();
      if (action === "close") this.close();
      if (action === "sync") this.sync(true);
      if (action === "all") this.enrichAll();
      if (action === "cancel") this.pauseEnrichment();
      if (action === "tab") { this.state.activeTab = event.target.closest("[data-tab]")?.dataset.tab || "overview"; this.render(); }
      if (action === "staff-group") { this.state.activeStaffGroup = event.target.closest("[data-group]")?.dataset.group || "directors"; this.state.search.staff = ""; this.state.pages.staff = 1; this.render(); }
      if (action === "sort") {
        const button = event.target.closest("[data-sort-kind]");
        const kind = button?.dataset.sortKind;
        const mode = button?.dataset.sort;
        if (kind && Object.hasOwn(this.state.sort, kind) && ["works", "average"].includes(mode)) {
          this.state.sort[kind] = mode;
          this.state.pages[kind] = 1;
          this.render();
        }
      }
      if (action === "overview-toggle") {
        const section = event.target.closest("[data-section]")?.dataset.section;
        if (section && Object.hasOwn(this.state.expandedOverview, section)) {
          const content = this.$(".content");
          const scrollTop = content?.scrollTop || 0;
          this.state.expandedOverview[section] = !this.state.expandedOverview[section];
          this.render();
          requestAnimationFrame(() => { const next = this.$(".content"); if (next) next.scrollTop = scrollTop; });
        }
      }
      if (action === "page") {
        const button = event.target.closest("[data-page-kind]");
        const kind = button?.dataset.pageKind;
        if (kind) this.state.pages[kind] = Math.max(1, number(button.dataset.page));
        this.render();
        const content = this.$(".content");
        if (content) content.scrollTop = 0;
      }
    }
    onInput(event) {
      const input = event.target.closest("[data-search]");
      if (!input || event.isComposing) return;
      const kind = input.dataset.search;
      if (!Object.hasOwn(this.state.search, kind)) return;
      this.state.search[kind] = input.value;
      this.state.pages[kind] = 1;
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this.render();
        requestAnimationFrame(() => {
          const next = this.$(`[data-search="${kind}"]`);
          next?.focus();
          next?.setSelectionRange?.(next.value.length, next.value.length);
        });
      }, 120);
    }
    onKeyDown() {}
    filterRows(rows, query) {
      const normalized = text(query).trim().toLocaleLowerCase();
      if (!normalized) return rows;
      return rows.filter((row) => text(row.name).toLocaleLowerCase().includes(normalized));
    }
    sortControls(kind) {
      const active = this.state.sort[kind];
      return `<div class="sort-row"><span>排序</span><div class="sort-switch" role="group" aria-label="排名排序方式"><button type="button" data-action="sort" data-sort-kind="${kind}" data-sort="works" aria-pressed="${active === "works"}">作品数</button><button type="button" data-action="sort" data-sort-kind="${kind}" data-sort="average" aria-pressed="${active === "average"}">均分</button></div>${active === "average" ? '<small>仅作品数位于前 10% 者入榜</small>' : ""}</div>`;
    }
    pager(kind, page, pages) {
      if (pages <= 1) return "";
      return `<div class="pager" aria-label="人物分页"><button type="button" data-action="page" data-page-kind="${kind}" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button><span>${page} / ${pages}</span><button type="button" data-action="page" data-page-kind="${kind}" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>下一页</button></div>`;
    }
    listRows(rows, kind, pageKind) {
      if (!rows.length) return '<p class="empty">暂无匹配的人物。资料尚未齐全时，可在“更新”中补全。</p>';
      const pages = Math.max(1, Math.ceil(rows.length / RANK_PAGE_SIZE));
      const page = Math.min(pages, Math.max(1, this.state.pages[pageKind] || 1));
      this.state.pages[pageKind] = page;
      const offset = (page - 1) * RANK_PAGE_SIZE;
      const shown = rows.slice(offset, offset + RANK_PAGE_SIZE);
      const max = Math.max(1, ...rows.map(row => row.works));
      return `<ol class="people-list" start="${offset + 1}">${shown.map((row, index) => {
        const detail = `${formatNumber(row.works)} 部 · 均分 ${formatRate(row.averageRate)}`;
        return `<li><span class="rank">${offset + index + 1}</span><div><a href="/person/${row.id}" target="_blank" rel="noopener">${escapeHtml(row.name)}</a><span class="person-meta">${detail}</span><i class="person-bar" style="--share:${Math.round(row.works / max * 100)}%"></i></div></li>`;
      }).join("")}</ol>${this.pager(pageKind, page, pages)}`;
    }
    overview(stats) {
      const topTags = stats.distributions.tags;
      const years = stats.distributions.years;
      const yearMax = Math.max(1, ...years.map((row) => row.count));
      const yearRow = (row) => `<span><b>${row.year}</b><i style="--share:${Math.max(6, Math.round(row.count / yearMax * 100))}%"></i><small>${row.count}</small></span>`;
      const tagRow = (row) => `<span>${escapeHtml(row.name)}<b>${row.count}</b></span>`;
      const longestRow = (row) => `<li><a href="/subject/${row.id}" target="_blank" rel="noopener">${escapeHtml(row.nameCn || row.name)}</a><strong>${formatNumber(row.eps)} 话</strong></li>`;
      const limit = { years: 12, tags: 24, longest: 12 };
      const expandButton = (section, total, unit) => {
        if (total <= limit[section]) return "";
        const expanded = this.state.expandedOverview[section];
        const label = expanded ? `收起${unit.replace(/^(?:个|部)/, "")}` : `显示其余 ${formatNumber(total - limit[section])} ${unit}`;
        return `<button type="button" class="expand-control" data-action="overview-toggle" data-section="${section}" aria-expanded="${expanded}"><span>${label}</span>${ICONS.chevron}</button>`;
      };
      const shownYears = this.state.expandedOverview.years ? years : years.slice(0, limit.years);
      const shownTags = this.state.expandedOverview.tags ? topTags : topTags.slice(0, limit.tags);
      const shownLongest = this.state.expandedOverview.longest ? stats.distributions.longest : stats.distributions.longest.slice(0, limit.longest);
      const yearCard = years.length ? `<section class="wide-card expandable-card"><header><h3>看过的年代</h3><span>共 ${formatNumber(years.length)} 个年份</span></header><div class="year-list" style="--year-rows:${Math.ceil(shownYears.length / 2)}">${shownYears.map(yearRow).join("")}</div>${expandButton("years", years.length, "个年份")}</section>` : "";
      const tagCard = `<section class="wide-card expandable-card"><header><h3>个人标签</h3><span>共 ${formatNumber(topTags.length)} 个</span></header><div class="tag-cloud">${shownTags.length ? shownTags.map(tagRow).join("") : '<p class="empty">暂无个人标签。</p>'}</div>${expandButton("tags", topTags.length, "个标签")}</section>`;
      const longestCard = `<section class="wide-card expandable-card"><header><h3>作品话数</h3><span>共 ${formatNumber(stats.distributions.longest.length)} 部</span></header><ol class="longest-list">${shownLongest.map(longestRow).join("") || '<li class="empty">暂无集数资料。</li>'}</ol>${expandButton("longest", stats.distributions.longest.length, "部作品")}</section>`;
      if (!stats.overview.works) return `<p class="empty">${!this.state.lastSync ? (/失败|异常/.test(this.state.progress.label) ? '可通过“更新”重试。' : '正在读取动画收藏…') : '还没有可回顾的动画。'}</p>`;
      return this.state.activeTab === "tags" ? tagCard : this.state.activeTab === "longest" ? longestCard : (yearCard || '<p class="empty">暂无年代资料。</p>');
    }
    staff(stats) {
      const groups = [{ id: "directors", label: "导演" }, { id: "series", label: "系列构成" }, { id: "studios", label: "动画制作" }, { id: "originals", label: "原作 / 原案" }, { id: "scripts", label: "脚本" }, { id: "music", label: "音乐" }, { id: "characterDesign", label: "角色设计" }];
      const active = groups.find(group => group.id === this.state.activeStaffGroup) || groups[0];
      const ranking = Core.rankEntries(stats.groups[active.id] || [], this.state.sort.staff, 0.1);
      const rows = this.filterRows(ranking.rows, this.state.search.staff);
      return `<div class="role-switch" aria-label="创作职位">${groups.map(group => `<button type="button" data-action="staff-group" data-group="${group.id}" aria-pressed="${group.id === active.id}">${group.label}</button>`).join("")}</div>${this.rankingTools("staff", active.label)}${this.listRows(rows, "staff", "staff")}`;
    }
    rankingTools(kind, label) {
      return `<div class="ranking-tools"><label><span class="sr-only">搜索${label}姓名</span><input type="search" data-search="${kind}" value="${escapeHtml(this.state.search[kind])}" placeholder="搜索${label}" autocomplete="off"></label>${this.sortControls(kind)}</div>`;
    }
    cast(stats) {
      const ranking = Core.rankEntries(stats.groups.cast, this.state.sort.cast, 0.1);
      return `${this.rankingTools("cast", "声优")}${this.listRows(this.filterRows(ranking.rows, this.state.search.cast), "cast", "cast")}`;
    }
    content(stats) { if (this.state.activeTab === "staff") return this.staff(stats); if (this.state.activeTab === "cast") return this.cast(stats); return this.overview(stats); }
    render() {
      const active = this.shadow.activeElement;
      const action = active?.getAttribute("data-action");
      const key = active?.getAttribute("data-tab") || active?.getAttribute("data-group") || active?.getAttribute("data-sort");
      const settingsOpen = this.$(".data-settings")?.open;
      const stats = this.stats();
      this.isBusy();
      const progress = this.state.progress;
      const needsNotice = this.state.busy || /失败|异常/.test(progress.label);
      const tabs = Object.entries(TABS).map(([id, label]) => `<button type="button" aria-pressed="${this.state.activeTab === id}" data-action="tab" data-tab="${id}">${label}</button>`).join("");
      this.shadow.innerHTML = `${this.styles()}<section class="module" aria-labelledby="bgmstats-title"><header class="module-head"><h2 id="bgmstats-title">动画回顾</h2><details class="data-settings" ${settingsOpen ? "open" : ""}><summary>更新</summary><div><button data-action="sync" ${this.state.busy ? "disabled" : ""}>更新收藏</button><button data-action="all" ${this.state.busy || !stats.overview.works ? "disabled" : ""}>补全人物资料</button>${this.state.busy ? '<button data-action="cancel">暂停补全</button>' : ""}</div></details></header><div class="tabs" role="group" aria-label="回顾分类">${tabs}</div><div class="progress" aria-live="polite" ${needsNotice ? "" : "hidden"}><span data-role="progress-label">${escapeHtml(progress.label)}</span><span data-role="progress-count"></span></div><div class="content">${this.content(stats)}</div></section>`;
      if (action && key) this.shadow.querySelectorAll('[data-action]').forEach(el => {
        if (el.getAttribute('data-action') === action && (el.getAttribute('data-tab') || el.getAttribute('data-group') || el.getAttribute('data-sort')) === key) el.focus({ preventScroll: true });
      });
    }
    styles() { return `<style>${globalThis.BangumiProfileUI.css}
      .content{padding:18px 0 0;min-height:230px}.content header{display:none}
      .data-settings{position:relative;font-size:12px;color:var(--muted)}.data-settings summary{padding:4px 9px;border-radius:6px}.data-settings>div{position:absolute;right:0;top:32px;z-index:2;display:grid;min-width:150px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:6px;box-shadow:0 3px 12px #0000000a}
      .year-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 40px;padding:8px 2px}.year-list>span{display:grid;grid-template-columns:40px minmax(0,1fr) 32px;gap:12px;align-items:center}.year-list b{font-weight:400}.year-list i{height:8px;border-radius:3px;background:var(--soft);overflow:hidden}.year-list i::after{content:"";display:block;width:var(--share);height:100%;background:var(--pink);border-radius:3px}.year-list small{text-align:right;color:var(--muted);font-size:12px}
      .expand-control{display:block;margin:18px auto 0;color:var(--link);font-size:12px}.expand-control svg{fill:none;stroke:currentColor;stroke-width:1.5;margin-left:4px}
      .tag-cloud{display:flex;flex-wrap:wrap;align-items:center;gap:12px 20px;padding:12px 0}.tag-cloud>span{color:var(--link);padding:3px 0}.tag-cloud b{font-weight:400;color:var(--muted);font-size:11px;margin-left:5px}.tag-cloud>span:nth-child(-n+5){font-size:18px}.tag-cloud>span:nth-child(n+6):nth-child(-n+12){font-size:15px}
      .longest-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 30px;margin:0;padding:0;list-style:none}.longest-list li{display:flex;align-items:baseline;gap:12px;padding:7px 0;border-bottom:1px solid var(--line)}.longest-list a{flex:1;min-width:0}.longest-list strong{color:var(--muted);font-weight:400;font-size:12px;white-space:nowrap}
      .role-switch{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:14px}.role-switch button[aria-pressed="true"]{color:var(--link);background:var(--pink-soft)}
      .ranking-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:12px 0 20px}.ranking-tools input{width:160px;font-size:12px}.sort-row{display:flex;gap:8px;align-items:center;font-size:12px}.sort-row>span{display:none}.sort-switch{display:flex;gap:3px}.sort-switch button[aria-pressed="true"]{color:var(--link);background:var(--pink-soft)}.sort-row small{max-width:140px;color:var(--muted)}
      .people-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 32px;list-style:none;margin:0;padding:0}.people-list li{display:flex;gap:10px;min-width:0}.rank{font-size:12px;color:var(--muted);width:18px;flex-shrink:0}.people-list li>div{flex:1;min-width:0}.people-list a{display:block}.person-meta{font-size:12px;color:var(--muted)}.person-bar{display:block;margin-top:6px;width:var(--share);height:3px;min-width:2px;background:var(--pink);border-radius:3px}
      .pager{display:flex;justify-content:center;align-items:center;gap:16px;margin-top:20px;font-size:12px;color:var(--muted)}
      @container(max-width:500px){.year-list{gap:12px 16px}.year-list>span{grid-template-columns:32px minmax(0,1fr) 24px;gap:5px}.people-list{gap:18px}.longest-list{grid-template-columns:1fr}.sort-row{flex-wrap:wrap}}
    </style>`; }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => new StatsDrawer().mount(), { once: true });
  else new StatsDrawer().mount();
})();


(function bootstrapBangumiPersonalRecommender() {
  "use strict";

  const Core = globalThis.BangumiRecommenderCore;
  if (!Core || document.getElementById("bgmpr-host")) return;

  const APP_VERSION = "0.9.0";
  const DEFAULT_USER = "wylt";
  const API_BASE = "https://api.bgm.tv";
  const COLLECTION_TTL = 24 * 60 * 60 * 1000;
  const CANDIDATE_TTL = 3 * 24 * 60 * 60 * 1000;
  const ENTITY_TTL = 30 * 24 * 60 * 60 * 1000;
  const CONFIG_KEY = "bgmpr:config:v1";
  const RECOMMENDATION_MODEL_VERSION = "27";
  const RECOMMENDATION_PAGE_SIZE = 5;
  const CANDIDATE_TAG_COUNT = 12;
  const CANDIDATE_TAG_PAGES = 2;
  const CANDIDATE_RANK_PAGES = 10;

  const RECOMMENDATION_TYPES = Object.freeze([
    { id: "2", label: "动画", subjectType: 2 },
    {
      id: "anime_hentai",
      label: "里番",
      subjectType: 2,
      profileTags: Core.ADULT_RECOMMENDATION_TAGS.profile,
      directCandidateTags: Core.ADULT_RECOMMENDATION_TAGS.direct,
      supplementalCandidateTags: Core.ADULT_RECOMMENDATION_TAGS.supplemental,
    },
    { id: "1", label: "书籍", subjectType: 1 },
    { id: "4", label: "游戏", subjectType: 4 },
    { id: "3", label: "音乐", subjectType: 3 },
    { id: "6", label: "三次元", subjectType: 6 },
  ]);
  const RECOMMENDATION_MODE = "balanced";

  function recommendationType(value) {
    return RECOMMENDATION_TYPES.find((entry) => entry.id === String(value)) || RECOMMENDATION_TYPES[0];
  }

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
    pagePrevious: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.6 6-6 6 6 6 1.4-1.4-4.6-4.6 4.6-4.6L14.6 6Z"/></svg>`,
    pageNext: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.4 18 6-6-6-6L8 7.4l4.6 4.6L8 16.6 9.4 18Z"/></svg>`,
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

    async getCandidates(subjectType, profile, force = false, options = {}) {
      if (options.directCandidateTags?.length) {
        return this.getSpecialCandidates(subjectType, options, force);
      }
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

    async getSpecialCandidates(subjectType, options, force = false) {
      const directTags = [...options.directCandidateTags];
      const supplementalTags = [...(options.supplementalCandidateTags || [])];
      const allTags = [...new Set([...directTags, ...supplementalTags].map(Core.normalizeText))];
      const key = `candidates:special:v5:${options.id || subjectType}:${allTags.sort().join("|")}`;
      return this.cached(
        key,
        CANDIDATE_TTL,
        async () => {
          const pools = [];
          for (const tag of allTags) {
            try {
              pools.push(...await this.getTaggedCandidatesFromApi(subjectType, tag));
            } catch {
              this.progress(`“${tag}”API 索引不可用，继续读取站内标签池…`, 0, 0);
            }
          }
          for (const tag of directTags) {
            try {
              pools.push(...await this.getTaggedCandidatesFromSite(subjectType, tag));
            } catch {
              this.progress(`“${tag}”站内标签页不可用，保留其余候选来源…`, 0, 0);
            }
          }
          const candidates = this.dedupeSubjects(pools, true)
            .filter((subject) => Core.isAdultRecommendationCandidate(subject, true));
          if (!candidates.length) throw new Error("没有读取到可确认的里番候选条目。");
          return candidates;
        },
        force,
      );
    }

    async getTaggedCandidatesFromApi(subjectType, tag) {
      const fetchPage = (offset) => this.requestJson(
        `/v0/search/subjects?limit=20&offset=${offset}`,
        {
          method: "POST",
          body: JSON.stringify({
            keyword: "",
            sort: "heat",
            filter: { type: [subjectType], tag: [tag] },
          }),
        },
      );
      this.progress(`正在补充“${tag}”API 候选…`, 0, 1);
      const first = await fetchPage(0);
      const withVerifiedEvidence = (rows) => (Array.isArray(rows) ? rows : []).map((row) => {
        const subject = Core.normalizeSubject(row);
        const adultTagCount = Math.max(
          0,
          ...Core.ADULT_RECOMMENDATION_TAGS.profile.map(
            (adultTag) => Number(subject.tagCounts[Core.normalizeText(adultTag)] || 0),
          ),
        );
        return {
          ...row,
          adultVerificationPriority:
            (Core.isAdultRecommendationCandidate(subject) ? 10000 : 0) + adultTagCount,
        };
      });
      const firstRows = withVerifiedEvidence(first.data);
      const pageSize = Math.max(1, firstRows.length || 20);
      const total = Math.max(firstRows.length, Number(first.total || 0));
      const offsets = Array.from(
        { length: Math.max(0, Math.ceil(total / pageSize) - 1) },
        (_, index) => (index + 1) * pageSize,
      );
      let completed = 1;
      const totalRequests = offsets.length + 1;
      this.progress(`正在补充“${tag}”API 候选…`, completed, totalRequests);
      const remaining = await concurrentMap(offsets, 3, async (offset) => {
        const page = await fetchPage(offset);
        completed += 1;
        this.progress(`正在补充“${tag}”API 候选…`, completed, totalRequests);
        return withVerifiedEvidence(page.data);
      });
      return this.dedupeSubjects([...firstRows, ...remaining.flat()]);
    }

    dedupeSubjects(subjects, mergeTags = false) {
      const map = new Map();
      for (const raw of subjects) {
        const subject = Core.normalizeSubject(raw);
        if (!subject.id) continue;
        const previous = map.get(subject.id) || {};
        map.set(subject.id, mergeTags
          ? {
              ...previous,
              ...subject,
              name: subject.name || previous.name || "",
              nameCn: subject.nameCn || previous.nameCn || "",
              date: subject.date || previous.date || "",
              image: subject.image || previous.image || "",
              tags: [...new Set([...(previous.tags || []), ...subject.tags])],
              metaTags: [...new Set([...(previous.metaTags || []), ...subject.metaTags])],
              rating: Number(subject.rating?.total || 0) >= Number(previous.rating?.total || 0)
                ? subject.rating
                : previous.rating,
              rank: subject.rank || previous.rank || 0,
              infobox: subject.infobox?.length ? subject.infobox : (previous.infobox || []),
              summary: subject.summary || previous.summary || "",
              persons: subject.persons?.length ? subject.persons : (previous.persons || []),
              characters: subject.characters?.length ? subject.characters : (previous.characters || []),
              relation: subject.relation || previous.relation || "",
              sourceUrl: subject.sourceUrl || previous.sourceUrl || "",
              adultEvidenceVerified: Boolean(
                previous.adultEvidenceVerified || subject.adultEvidenceVerified,
              ),
              adultVerificationPriority: Math.max(
                Number(previous.adultVerificationPriority || 0),
                Number(subject.adultVerificationPriority || 0),
              ),
            }
          : { ...previous, ...subject });
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

    async getTaggedCandidatesFromSite(subjectType, tag) {
      const type = Core.SUBJECT_TYPES[subjectType];
      if (!type) throw new Error("不支持的条目类型");
      const base = `${location.origin}/${type.slug}/tag/${encodeURIComponent(tag)}?sort=collects`;
      const first = await this.getHtmlDocument(`${base}&page=1`);
      const pages = this.maxPage(first);
      const pools = this.parseListItems(first, subjectType, 0, tag).map((item) => item.subject);
      this.progress(`正在读取“${tag}”完整标签页…`, 1, pages);
      for (let page = 2; page <= pages; page += 1) {
        await sleep(220);
        const documentNode = await this.getHtmlDocument(`${base}&page=${page}`);
        pools.push(...this.parseListItems(documentNode, subjectType, 0, tag).map((item) => item.subject));
        this.progress(`正在读取“${tag}”完整标签页…`, page, pages);
      }
      return this.dedupeSubjects(pools).filter((subject) => Core.subjectHasTag(subject, tag));
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
      try {
        return await this.cached(
          `subject-details:v2:${subjectId}`,
          ENTITY_TTL,
          () => this.requestJson(`/v0/subjects/${subjectId}`),
        );
      } catch {
        return null;
      }
    }

    async enrichOriginMetadata(subjects, subjectIds, limit = 180) {
      if (!this.apiAvailable || !subjectIds.length) return new Map();
      const uniqueIds = [...new Set(subjectIds)].slice(0, limit);
      let completed = 0;
      const rows = await concurrentMap(uniqueIds, 4, async (subjectId) => {
        const details = await this.getSubjectDetails(subjectId);
        completed += 1;
        this.progress("正在确认候选作品来源…", completed, uniqueIds.length);
        const base = subjects.find((subject) => Number(subject.id) === Number(subjectId));
        return base
          ? [subjectId, {
              ...Core.normalizeSubject(details || base),
              adultEvidenceVerified: Boolean(details),
            }]
          : null;
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
        subjectType: "2",
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
        pageOrder: [],
        current: [],
        currentPage: 1,
        collections: [],
        eligibleCandidateCount: 0,
        lastSync: null,
        currentSummary: {},
      };
      this.lastFocused = null;
      this.previousPageOverflow = "";
      this.excludedBatch = new Set();
      this.pageByType = new Map();
    }

    mount() {
      this.host = globalThis.BangumiProfileUI?.mount("bgmpr-host", 20);
      if (!this.host) return;
      this.host.dataset.theme = this.detectTheme();
      this.shadow = this.host.attachShadow({ mode: "open" });
      this.shadow.innerHTML = `${this.styles()}${this.shell()}`;
      this.bindEvents();
      this.watchTheme();
      globalThis.BangumiProfileUI.lazy(this.host, () => this.open());
    }

    detectTheme() { return globalThis.BangumiProfileUI.theme(); }

    watchTheme() {
      const update = () => {
        this.host.dataset.theme = this.detectTheme();
      };
      new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
      matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", update);
    }

    shell() {
      const selectedType = recommendationType(this.config.subjectType);
      const options = RECOMMENDATION_TYPES.map(type => `<option value="${type.id}" ${type.id === selectedType.id ? "selected" : ""}>${type.label}</option>`).join("");
      return `<section class="module" aria-labelledby="bgmpr-title">
        <header class="module-head"><h2 id="bgmpr-title">个性推荐</h2><select data-role="type-select" aria-label="推荐类型">${options}</select><button class="refresh-data" type="button" title="根据最新收藏重新推荐">更新</button></header>
        <div class="progress-region" aria-live="polite" hidden><div class="progress-copy"><span data-role="progress-text">正在寻找你可能喜欢的作品…</span><span data-role="progress-count"></span></div><div class="progress-track" role="progressbar" aria-label="推荐加载进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div></div>
        <div class="content">
          <div class="welcome" data-role="welcome"><p>从喜欢的作品，遇见下一部。</p><button class="start" type="button">看看推荐</button></div>
          <div class="results" data-role="results" hidden></div>
          <div class="error" data-role="error" hidden><p data-role="error-message"></p><button class="retry" type="button">重试</button></div>
        </div>
        <div class="toast" role="status" hidden><span></span><button type="button">撤销</button></div>
      </section>`;
    }

    bindEvents() {
      this.$(".start").addEventListener("click", () => this.ensureRecommendations({ force: true }));
      this.$(".retry").addEventListener("click", () => this.ensureRecommendations({ force: true }));
      this.$(".refresh-data").addEventListener("click", () => this.ensureRecommendations({ force: true }));
      this.$('[data-role="type-select"]').addEventListener("change", (event) => {
        this.config.subjectType = event.target.value;
        this.persistConfig();
        this.resetViewForType();
        this.loadCachedResult().then(loaded => { if (!loaded) this.ensureRecommendations({ force: false }); });
      });
      this.shadow.addEventListener("click", (event) => {
        const dismiss = event.composedPath().find(
          (element) => element instanceof Element && element.matches?.("[data-dismiss-id]"),
        );
        if (dismiss) {
          this.dismiss(Number(dismiss.dataset.dismissId));
          return;
        }
        const pageButton = event.composedPath().find(
          (element) => element instanceof Element && element.matches?.("[data-page-direction]"),
        );
        if (pageButton) this.changePage(this.state.currentPage + Number(pageButton.dataset.pageDirection), "button");
      });
      this.shadow.addEventListener("change", (event) => {
        const pageSelect = event.composedPath().find(
          (element) => element instanceof Element && element.matches?.("[data-page-select]"),
        );
        if (pageSelect) this.changePage(Number(pageSelect.value), "select");
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

    async open() {
      if (this.state.open) return;
      this.state.open = true;
      const loaded = await this.loadCachedResult();
      if (!loaded && !this.state.busy) this.ensureRecommendations({ force: false });
    }

    close() {}
    onKeyDown() {}

    resetViewForType() {
      this.state.baseProfile = null;
      this.state.profile = null;
      this.state.candidates = [];
      this.state.scoredPool = [];
      this.state.pageOrder = [];
      this.state.current = [];
      this.state.currentPage = this.pageByType.get(recommendationType(this.config.subjectType).id) || 1;
      this.excludedBatch.clear();
      this.$('[data-role="results"]').hidden = true;
      this.$('[data-role="error"]').hidden = true;
      this.$('[data-role="welcome"]').hidden = false;
    }

    cacheKey() {
      const type = recommendationType(this.config.subjectType);
      return `result:v${RECOMMENDATION_MODEL_VERSION}:${this.config.username}:${type.id}:${RECOMMENDATION_MODE}`;
    }

    async loadCachedResult() {
      const key = this.cacheKey();
      const cached = await this.store.get(key).catch(() => null);
      if (key !== this.cacheKey()) return true;
      if (!cached?.value?.pageOrder?.length && !cached?.value?.recommendations?.length) return false;
      const value = cached.value;
      this.state.lastSync = value.generatedAt;
      this.state.pageOrder = value.pageOrder || value.recommendations;
      this.state.scoredPool = this.state.pageOrder;
      const typeId = recommendationType(this.config.subjectType).id;
      this.state.currentPage = this.pageByType.get(typeId) || 1;
      this.state.currentSummary = value.summary || {};
      this.renderFromPool();
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
      for (const selector of [".start", ".retry", ".refresh-data", '[data-role="type-select"]']) {
        const control = this.$(selector);
        if (control) control.disabled = busy;
      }
      this.shadow.querySelectorAll("[data-page-direction], [data-page-select]").forEach((control) => {
        control.disabled = busy || control.dataset.pageBoundary === "true";
      });
      this.$(".refresh-data").classList.toggle("spinning", busy);
      this.$(".progress-region").hidden = !busy;
      this.$(".content").setAttribute("aria-busy", String(busy));
    }

    async ensureRecommendations({ force = false } = {}) {
      if (this.state.busy) return;
      if (force) {
        const typeId = recommendationType(this.config.subjectType).id;
        this.pageByType.set(typeId, 1);
        this.state.currentPage = 1;
      }
      this.setBusy(true);
      this.$('[data-role="welcome"]').hidden = true;
      this.$('[data-role="error"]').hidden = true;
      try {
        const selectedType = recommendationType(this.config.subjectType);
        const type = selectedType.subjectType;
        const allCollections = await this.client.getCollections(type, force);
        const collections = selectedType.profileTags?.length
          ? allCollections.filter((item) => selectedType.profileTags.some((tag) => Core.collectionHasTag(item, tag)))
          : allCollections;
        if (!collections.length) throw new Error("没有读取到该类型的收藏数据。请确认账号公开收藏或稍后重试。");
        this.state.collections = collections;
        this.state.requireAdultEvidence = selectedType.id === "anime_hentai";
        this.state.baseProfile = Core.trainProfile(collections);
        this.state.profile = this.state.baseProfile;
        if (this.state.profile.ratedCount < 5) throw new Error("已评分样本不足 5 个，暂时无法建立可靠画像。");

        const candidates = await this.client.getCandidates(type, this.state.profile, force, selectedType);
        const marked = new Set(allCollections.map((item) => Number(item.subjectId)));
        this.state.candidates = candidates.filter((subject) => !marked.has(Number(subject.id)));
        if (this.state.candidates.length < 5) throw new Error("未标记候选不足 5 个，请稍后刷新候选池。");

        this.recompute({ enforceJapanese: false, render: false });
        this.setProgress("基础排序已完成，正在确认日本作品…", 0, 0);

        if (this.client.apiAvailable) {
          await this.enhanceWithPeople();
        }
        if (this.state.requireAdultEvidence) {
          this.state.candidates = this.state.candidates.filter((subject) => {
            const evidence = subject.originMetadata?.adultEvidenceVerified === true
              ? subject.originMetadata
              : null;
            return evidence && Core.isAdultRecommendationCandidate(evidence);
          });
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
      const originLimit = this.state.requireAdultEvidence ? 360 : 180;
      const scoredPreview = this.state.scoredPool
        .slice(0, this.state.requireAdultEvidence ? 180 : originLimit)
        .map((item) => item.subject.id);
      const adultPriorityPreview = this.state.requireAdultEvidence
        ? [...this.state.candidates]
            .filter((subject) => subject.adultVerificationPriority > 0)
            .sort((left, right) => right.adultVerificationPriority - left.adultVerificationPriority)
            .slice(0, 180)
            .map((subject) => subject.id)
        : [];
      const originPreview = [...new Set([...adultPriorityPreview, ...scoredPreview])].slice(0, originLimit);
      let allSubjects = [
        ...this.state.collections.map((item) => item.subject),
        ...this.state.candidates,
      ];
      const origins = await this.client.enrichOriginMetadata(allSubjects, originPreview, originLimit);
      if (origins.size) {
        this.state.candidates = this.state.candidates.map((item) => {
          if (!origins.has(item.id)) return item;
          const details = origins.get(item.id);
          return {
            ...item,
            ...details,
            tags: details.tags?.length ? details.tags : (item.tags || []),
            metaTags: details.metaTags?.length ? details.metaTags : (item.metaTags || []),
            originMetadata: details,
          };
        });
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
        .filter((item) => !enforceJapanese || !this.state.requireAdultEvidence
          || (item.subject.adultEvidenceVerified !== false
            && Core.isAdultRecommendationCandidate(item.subject)))
        .sort((a, b) => b.normalizedScore - a.normalizedScore);
      this.state.eligibleCandidateCount = enforceJapanese ? scored.length : 0;
      if (enforceJapanese && scored.length < 5) {
        throw new Error(`只能确认 ${scored.length} 个日本候选，无法在不混入其他国家作品的前提下生成 5 个推荐。`);
      }
      const poolLimit = !enforceJapanese && this.state.requireAdultEvidence ? 360 : 180;
      this.state.scoredPool = scored.slice(0, poolLimit);
      this.state.pageOrder = this.buildPageOrder(this.state.scoredPool);
      this.excludedBatch.clear();
      if (render) this.renderFromPool();
    }

    buildPageOrder(scoredPool) {
      return Core.diversify(
        scoredPool,
        scoredPool.length,
        RECOMMENDATION_MODE,
        `${Core.recommendationSalt()}:full-pool`,
      );
    }

    renderFromPool() {
      if (!this.state.pageOrder.length && this.state.scoredPool.length) {
        this.state.pageOrder = this.buildPageOrder(this.state.scoredPool);
      }
      const available = this.state.pageOrder.filter((item) => !this.excludedBatch.has(Number(item.subject.id)));
      const pageCount = Math.max(1, Math.ceil(available.length / RECOMMENDATION_PAGE_SIZE));
      const typeId = recommendationType(this.config.subjectType).id;
      const requestedPage = this.pageByType.get(typeId) || this.state.currentPage || 1;
      const currentPage = Math.min(pageCount, Math.max(1, requestedPage));
      const startIndex = (currentPage - 1) * RECOMMENDATION_PAGE_SIZE;
      const selected = available.slice(startIndex, startIndex + RECOMMENDATION_PAGE_SIZE);
      this.state.currentPage = currentPage;
      this.pageByType.set(typeId, currentPage);
      this.state.current = selected;
      this.renderRecommendations(selected, {
        collectionCount: this.state.profile?.collectionCount || this.state.currentSummary.collectionCount,
        ratedCount: this.state.profile?.ratedCount || this.state.currentSummary.ratedCount,
        candidateCount: this.state.eligibleCandidateCount || this.state.currentSummary.candidateCount,
      }, {
        page: currentPage,
        pageCount,
        total: available.length,
        startIndex,
      });
    }

    changePage(page, focusTarget = "button") {
      if (!this.state.pageOrder.length) {
        this.ensureRecommendations({ force: false });
        return;
      }
      const availableCount = this.state.pageOrder.length - this.excludedBatch.size;
      const pageCount = Math.max(1, Math.ceil(availableCount / RECOMMENDATION_PAGE_SIZE));
      const nextPage = Math.min(pageCount, Math.max(1, Math.trunc(Number(page) || 1)));
      if (nextPage === this.state.currentPage) return;
      const direction = nextPage > this.state.currentPage ? 1 : -1;
      this.pageByType.set(recommendationType(this.config.subjectType).id, nextPage);
      this.renderFromPool();
      requestAnimationFrame(() => {
        const selector = focusTarget === "select"
          ? "[data-page-select]"
          : `[data-page-direction="${direction}"]`;
        this.$(selector)?.focus();
      });
    }

    dismiss(subjectId) {
      const previous = new Set(this.excludedBatch);
      const previousPage = this.state.currentPage;
      this.excludedBatch.add(Number(subjectId));
      this.renderFromPool();
      this.showToast("已从推荐结果中暂时隐藏。", () => {
        this.excludedBatch.clear();
        for (const id of previous) this.excludedBatch.add(id);
        this.pageByType.set(recommendationType(this.config.subjectType).id, previousPage);
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
      const image = safeImageUrl(subject.image);
      const tags = Core.selectContentTags(subject, item.positiveReasons).slice(0, 3);
      const evidence = Core.selectRecommendationEvidence(item);
      const similar = evidence.find(entry => entry.kind === "similarity")?.works || [];
      const creative = evidence.find(entry => entry.kind === "creative");
      const brief = similar.length ? `与你喜欢的《${similar[0].name}》相近`
        : creative?.reasons?.length ? `你偏爱的${creative.roleLabel || "创作者"}：${creative.reasons.map(r => r.label).join("、")}`
        : tags.length ? `也许合你口味的${tags.slice(0, 2).map(t => t.label).join("、")}作品` : "从你的收藏偏好中发现";
      const rows = evidence.map(entry => {
        if (entry.kind === "similarity") return `<p>与你看过的${entry.works.map(work => `《${escapeHtml(work.name)}》${Number(work.rate) ? `（${Number(work.rate)} 分）` : ""}`).join("、")}特征接近。</p>`;
        if (entry.kind === "creative") return `<p>${escapeHtml(entry.roleLabel || "创作人员")}：${entry.reasons.map(reason => escapeHtml(reason.label)).join("、")}，在你的历史评分中表现较好。</p>`;
        return '<p>结合你的收藏偏好与作品口碑推荐。</p>';
      }).join("");
      const url = `${location.origin}/subject/${subject.id}`;
      return `<article class="recommendation-card">
        <a class="cover" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="查看《${escapeHtml(title)}》">
          ${image ? `<img data-cover src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy" width="140" height="196"><span class="cover-placeholder" hidden>暂无封面</span>` : '<span class="cover-placeholder">暂无封面</span>'}
        </a>
        <h3><a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></h3>
        <div class="content-tags">${tags.map(tag => `<span>${escapeHtml(tag.label)}</span>`).join("")}</div>
        <p class="brief">${escapeHtml(brief)}</p>
        <details class="evidence-panel"><summary>推荐理由</summary><div class="evidence-body">${rows}<p class="evidence-score">预计评分 ${Number(item.predicted).toFixed(1)} · 站点评分 ${Number(subject.rating?.score || 0).toFixed(1)}</p><button type="button" data-dismiss-id="${subject.id}" aria-label="暂时隐藏《${escapeHtml(title)}》">暂时隐藏</button></div></details>
      </article>`;
    }

    paginationMarkup({ page = 1, pageCount = 1, total = 0 } = {}) {
      const options = Array.from({ length: pageCount }, (_, index) => {
        const value = index + 1;
        return `<option value="${value}" ${value === page ? "selected" : ""}>${value}</option>`;
      }).join("");
      return `
        <nav class="pagination" aria-label="推荐结果分页">
          <button class="page-button page-previous" type="button" data-page-direction="-1" data-page-boundary="${page <= 1}" ${page <= 1 ? "disabled" : ""} aria-label="上一页，第 ${Math.max(1, page - 1)} 页">
            ${ICONS.pagePrevious}<span>上一页</span>
          </button>
          <div class="page-status" aria-live="polite">
            <label><span>第</span><span class="page-select-shell"><select data-page-select aria-label="跳转到推荐页">${options}</select><span class="page-select-arrow">${ICONS.chevron}</span></span><span>/ ${pageCount} 页</span></label>
          </div>
          <button class="page-button page-next" type="button" data-page-direction="1" data-page-boundary="${page >= pageCount}" ${page >= pageCount ? "disabled" : ""} aria-label="下一页，第 ${Math.min(pageCount, page + 1)} 页">
            <span>下一页</span>${ICONS.pageNext}
          </button>
        </nav>`;
    }

    renderRecommendations(recommendations, summary = {}, pagination = {}) {
      this.state.currentSummary = summary;
      const results = this.$('[data-role="results"]');
      this.$('[data-role="welcome"]').hidden = true;
      this.$('[data-role="error"]').hidden = true;
      results.hidden = false;
      results.innerHTML = `<div class="recommendation-list">${recommendations.map((item, index) => this.recommendationCard(item, Number(pagination.startIndex || 0) + index)).join("")}</div>${this.paginationMarkup(pagination)}`;
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
      if (this.state.lastSync) this.$(".refresh-data").title = `根据最新收藏重新推荐；上次更新：${new Date(this.state.lastSync).toLocaleString("zh-CN", { hour12: false })}`;
    }

    async saveCurrentResult() {
      await this.store.set(this.cacheKey(), {
        storedAt: Date.now(),
        value: {
          generatedAt: this.state.lastSync,
          recommendations: this.state.current,
          pageOrder: this.state.pageOrder,
          summary: {
            collectionCount: this.state.profile.collectionCount,
            ratedCount: this.state.profile.ratedCount,
            candidateCount: this.state.eligibleCandidateCount,
          },
        },
      });
    }

    styles() {
      return `<style>${globalThis.BangumiProfileUI.css}
        .module-head select{font-size:12px;border:0;background:var(--soft);padding:4px 24px 4px 9px}.module-head .refresh-data{font-size:12px}
        .welcome{padding:28px 0;color:var(--muted);text-align:center}
        .recommendation-list{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:18px;align-items:start}
        .recommendation-card{min-width:0}.cover{display:block;aspect-ratio:5/7;background:var(--soft);overflow:hidden;border-radius:7px}.cover img{display:block;width:100%;height:100%;object-fit:cover;transition:opacity .18s}.cover:hover img{opacity:.88}.cover-placeholder{display:flex;width:100%;height:100%;align-items:center;justify-content:center;color:var(--muted)}
        .recommendation-card h3{margin-top:9px;font-size:13px;line-height:1.5}.recommendation-card h3 a{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:39px}
        .content-tags{display:flex;flex-wrap:wrap;gap:4px 7px;margin:5px 0;color:var(--link);font-size:11px;min-height:18px}.brief{font-size:12px;line-height:1.6;color:var(--muted);margin:6px 0 8px}
        .evidence-panel{font-size:12px}.evidence-panel summary{color:var(--site-link);width:fit-content;border-radius:4px;list-style:none}.evidence-panel summary::after{content:" ›"}.evidence-panel[open] summary::after{content:" ‹"}.evidence-body{padding-top:8px;line-height:1.75;overflow-wrap:anywhere}.evidence-body p{margin-bottom:8px}.evidence-score{color:var(--muted);font-size:11px}.evidence-body button{color:var(--muted);padding-left:0}
        .pagination{display:flex;align-items:center;justify-content:center;gap:22px;margin-top:24px;padding-top:12px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}.page-button{display:flex;align-items:center;gap:3px}.page-button svg{fill:currentColor;width:14px;height:14px}.page-status label{display:flex;align-items:center;gap:5px}.page-select-shell select{border:0;padding:3px 4px;background:var(--soft);font-size:12px}.page-select-arrow{display:none}
        .toast{margin-top:12px;padding:8px 12px;background:var(--pink-soft);border-radius:6px;color:var(--link);font-size:12px}.toast button{margin-left:8px;color:var(--link)}
        @container(max-width:620px){.recommendation-list{gap:14px;grid-template-columns:repeat(3,minmax(0,1fr))}}
        @container(max-width:400px){.recommendation-list{gap:20px 14px;grid-template-columns:repeat(2,minmax(0,1fr))}.pagination{gap:9px}.page-button{padding:5px}.module-head select{font-size:16px}}
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
