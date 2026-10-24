// ==UserScript==
// @name         Bangumi 动画回顾
// @namespace    https://bgm.tv/user/wylt
// @version      0.12.3
// @description  个人主页的动画回顾：年代分布与标签、创作、声优排行。
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
    .module{min-width:0;background:var(--surface)}.module-head{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:0 0 9px;border-bottom:1px solid var(--line);margin-bottom:16px}.module-head h2{margin-right:auto}.module-head>button{font-size:12px}.update-button{min-height:36px;min-width:44px;padding:6px 10px;font-size:12px;border-radius:6px;touch-action:manipulation}@container(max-width:500px){.update-button{min-height:44px}}
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


(function attachBangumiPersonalStatsCore(globalObject) {
  "use strict";

  const STATUS_LABELS = Object.freeze({
    1: "想看",
    2: "看过",
    3: "在看",
    4: "搁置",
    5: "抛弃",
  });

  // An average score needs enough sampled works to mean anything; entries at
  // or above this many works qualify for the average ranking.
  const RANK_MINIMUM_WORKS = 20;

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

  function rankEntries(entries, mode = "works", minimumWorks = RANK_MINIMUM_WORKS) {
    const rows = Array.isArray(entries) ? [...entries] : [];
    const byWorks = (a, b) => b.works - a.works || b.averageRate - a.averageRate || b.ratedWorks - a.ratedWorks || b.eps - a.eps || a.name.localeCompare(b.name, "zh-CN");
    if (mode !== "average" || !rows.length) return { rows: rows.sort(byWorks), cutoffWorks: 0, eligibleCount: rows.length };

    // Average rankings need a minimum sample size, not a share of the list: a
    // percentage cutoff shrinks the board as the collection grows, so every
    // entry at or above the absolute work count qualifies.
    const cutoffWorks = Math.max(1, Math.floor(number(minimumWorks) || RANK_MINIMUM_WORKS));
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
        if (!normalized) continue;
        const bucket = tags[normalized] || { count: 0, ratedCount: 0, scoreSum: 0 };
        bucket.count += 1;
        if (row.rate > 0) {
          bucket.ratedCount += 1;
          bucket.scoreSum += row.rate;
        }
        tags[normalized] = bucket;
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
        tags: Object.entries(tags).map(([name, bucket]) => ({
          name,
          count: bucket.count,
          ratedCount: bucket.ratedCount,
          averageRate: bucket.ratedCount ? bucket.scoreSum / bucket.ratedCount : 0,
        })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN")),
      },
    };
  }

  const Core = Object.freeze({
    STATUS_LABELS,
    RANK_MINIMUM_WORKS,
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


(function attachStatsViz(global) {
  'use strict';
  // Pure helpers: no libraries, network access, or changes to collection data.
  function yearSeries(rows) {
    const counts = new Map(rows.filter(row => /^\d{4}$/.test(String(row.year))).map(row => [Number(row.year), Math.max(0, Number(row.count) || 0)]));
    if (!counts.size) return [];
    const first = Math.min(...counts.keys()), last = Math.max(...counts.keys());
    return Array.from({ length: last - first + 1 }, (_, index) => ({ year: last - index, count: counts.get(last - index) || 0 }));
  }
  function axis(maximum) {
    const raw = Math.max(1, maximum) / 4;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const step = Math.max(1, Math.ceil([1, 2, 2.5, 5, 10].map(n => n * magnitude).find(n => n >= raw)));
    return { max: step * 4, ticks: Array.from({ length: 5 }, (_, i) => step * i) };
  }
  function isTemporalTag(value) {
    const tag = String(value || '').trim().replace(/\s+/g, '');
    return /^(?:19|20)\d{2}(?:年)?$/.test(tag)
      || /^(?:19|20)\d{2}(?:年|[-./])(?:0?[1-9]|1[0-2])(?:月)?(?:番|新番)?$/.test(tag)
      || /^(?:19|20)\d{2}年?(?:春|夏|秋|冬)(?:季|番|新番)?$/.test(tag)
      || /^(?:1|4|7|10)月(?:番|新番)$/.test(tag)
      || /^(?:19|20)\d0s$/i.test(tag);
  }
  function featuredTags(rows) {
    return rows.filter(row => Number(row.count) > 10 && !isTemporalTag(row.name)).sort((a,b) => b.count-a.count || a.name.localeCompare(b.name, 'zh-CN'));
  }
  const api = { yearSeries, axis, isTemporalTag, featuredTags };
  global.BangumiStatsViz = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);


(function bootstrapBangumiPersonalStats() {
  "use strict";

  const Core = globalThis.BangumiPersonalStatsCore;
  const Viz = globalThis.BangumiStatsViz;
  if (!Core || document.getElementById("bgmstats-host")) return;

  const DEFAULT_USER = "wylt";
  const API_BASE = "https://api.bgm.tv";
  const ENTITY_TTL = 90 * 24 * 60 * 60 * 1000;
  const ENTITY_CONCURRENCY = 1;
  const ENTITY_DELAY = 850;
  const ENTITY_TIMEOUT = 8000;
  const ENTITY_RETRY_LIMIT = 3;
  const ENTITY_RETRY_BASE_DELAY = 1200;
  const AUTO_RESUME_BACKOFF = 15 * 60 * 1000;
  const APP_VERSION = "0.12.3";
  const RANK_PAGE_SIZE = 12;
  const TABS = Object.freeze({ overview: "年代", tags: "标签", staff: "创作", cast: "声优" });

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
    async getMany(keys) {
      const database = await this.open();
      return new Promise((resolve, reject) => {
        const result = {};
        const transaction = database.transaction("kv", "readonly");
        const store = transaction.objectStore("kv");
        for (const key of keys) {
          const request = store.get(key);
          request.onsuccess = () => { result[key] = request.result; };
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }
  }

  function validCollections(cached) {
    return Number.isFinite(cached?.storedAt) && Array.isArray(cached.value) && cached.value.every(row =>
      Number.isSafeInteger(row?.subjectId) && row.subjectId > 0 && [1, 2, 3, 4, 5].includes(row.status) &&
      Number.isFinite(row.rate) && Array.isArray(row.tags) && row.subject?.id === row.subjectId);
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
      if (!force && validCollections(cached)) return cached;
      const rows = [];
      let offset = 0;
      let total = Infinity;
      while (offset < total) {
        const page = await this.fetchJson(`/v0/users/${encodeURIComponent(this.username)}/collections?subject_type=2&limit=100&offset=${offset}`);
        const data = page.data;
        const count = Number(page.total);
        if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0 ||
            (total !== Infinity && total !== count) || data.length > 100 ||
            (offset < count && !data.length) || offset + data.length > count) throw new Error("收藏分页无效或不完整");
        total = count;
        rows.push(...data);
        offset += data.length;
        onProgress?.("正在同步动画收藏…", Math.min(offset, total), total);
        if (!data.length) break;
      }
      const value = rows.map(Core.compactCollection);
      const next = { storedAt: Date.now(), value };
      if (rows.length !== total || !validCollections(next) || new Set(value.map(row => row.subjectId)).size !== value.length) throw new Error("收藏条目无效或分页重复");
      await this.store.set(key, next);
      return next;
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
    async entityMap(kind, ids, fresh = false) {
      const result = {};
      const keys = ids.map(id => this.key(`${kind}:${id}`));
      const records = await this.store.getMany(keys);
      ids.forEach((id, index) => {
        const cached = records[keys[index]];
        if (cached && (!fresh || Date.now() - cached.storedAt < ENTITY_TTL) && Array.isArray(cached.value)) result[id] = cached.value;
      });
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
        search: { staff: "", cast: "", tags: "" },
        pages: { staff: 1, cast: 1, tags: 1 },
        sort: { staff: "works", cast: "works", tags: "works" },
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
      const inspect = (event) => {
        const label = event.target.closest('[data-viz-label]')?.dataset.vizLabel;
        const caption = this.$('.viz-caption');
        if (label && caption) caption.textContent = label;
      };
      this.shadow.addEventListener('pointerover', inspect);
      this.shadow.addEventListener('focusin', inspect);
      this.shadow.addEventListener('click', inspect);
      this.shadow.addEventListener('pointerleave', () => {
        const caption = this.$('.viz-caption');
        if (caption && !this.shadow.activeElement?.matches('[data-viz-label]')) caption.textContent = caption.dataset.default;
      });
      const updateTheme = () => { this.host.dataset.theme = this.detectTheme(); };
      updateTheme();
      new MutationObserver(updateTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
      matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", updateTheme);
      this.open();
    }
    detectTheme() { return globalThis.BangumiProfileUI.theme(); }
    $(selector) { return this.shadow.querySelector(selector); }
    stats() {
      // Aggregate is expensive (full collection × people × cast). Memoize on
      // data shape so re-renders (search typing, tab switches) do not
      // recompute it; enrichment growth invalidates the cache naturally.
      const { collections, people, cast } = this.state;
      const signature = `${collections.length}:${Object.keys(people).length}:${Object.keys(cast).length}`;
      if (this.statsSignature !== signature) {
        this.statsCache = Core.aggregate(collections, people, cast);
        this.statsSignature = signature;
      }
      return this.statsCache;
    }
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
      if (this.state.open) return;
      this.state.open = true;
      await this.sync(false);
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
      try {
        const saved = await this.client.collections(force, (label, current, total) => this.progress(label, current, total));
        this.state.collections = saved.value.filter((row) => row.status === 2);
        this.state.lastSync = saved.storedAt;
        this.statsSignature = null;
        // Show local collection statistics before reading the larger entity caches.
        this.render();
        const ids = this.state.collections.map((row) => row.subjectId);
        [this.state.people, this.state.cast] = await Promise.all([this.client.entityMap("people", ids), this.client.entityMap("cast", ids)]);
        this.initializeEntityProgress();
        this.statsSignature = null;
        this.refreshEntityProgress("已同步收藏");
      } catch (error) { this.progress(`同步失败：${error.message || "网络异常"}`, 0, 0); }
      finally { this.state.syncing = false; this.render(); }
    }
    async enrichAll(userInitiated = true) {
      if (!this.state.collections.length || this.isBusy()) return;
      if (userInitiated) {
        await this.client.setEnrichmentState({ enabled: true, nextAt: Date.now() });
        const ids = this.state.collections.map(row => row.subjectId);
        [this.state.people, this.state.cast] = await Promise.all([this.client.entityMap("people", ids, true), this.client.entityMap("cast", ids, true)]);
        this.statsSignature = null;
      }
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
    onKeyDown(event) {
      if (!event.target.matches('.year-column') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const columns = Array.from(this.shadow.querySelectorAll('.year-column'));
      const index = columns.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? columns.length - 1 : Math.max(0, Math.min(columns.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
      event.preventDefault(); columns[next]?.focus();
    }
    filterRows(rows, query) {
      const normalized = text(query).trim().toLocaleLowerCase();
      if (!normalized) return rows;
      return rows.filter((row) => text(row.name).toLocaleLowerCase().includes(normalized));
    }
    sortControls(kind) {
      const active = this.state.sort[kind];
      const eligibility = kind === 'staff' && this.state.activeStaffGroup === 'studios' ? '仅作品数大于 10 部者入榜' : `仅作品数 ${Core.RANK_MINIMUM_WORKS} 部以上者入榜`;
      return `<div class="sort-row"><span>排序</span><div class="sort-switch" role="group" aria-label="排名排序方式"><button type="button" data-action="sort" data-sort-kind="${kind}" data-sort="works" aria-pressed="${active === "works"}">作品数</button><button type="button" data-action="sort" data-sort-kind="${kind}" data-sort="average" aria-pressed="${active === "average"}">均分</button></div>${active === "average" ? `<small>${eligibility}</small>` : ""}</div>`;
    }
    pager(kind, page, pages) {
      if (pages <= 1) return "";
      return `<div class="pager" aria-label="分页"><button type="button" data-action="page" data-page-kind="${kind}" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button><span>${page} / ${pages}</span><button type="button" data-action="page" data-page-kind="${kind}" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>下一页</button></div>`;
    }
    listRows(rows, kind, pageKind, pool) {
      if (!rows.length) return `<p class="empty">暂无匹配的${kind === 'tags' ? '标签' : '人物'}。</p>`;
      const pages = Math.max(1, Math.ceil(rows.length / RANK_PAGE_SIZE));
      const page = Math.min(pages, Math.max(1, this.state.pages[pageKind] || 1));
      this.state.pages[pageKind] = page;
      const offset = (page - 1) * RANK_PAGE_SIZE;
      const shown = rows.slice(offset, offset + RANK_PAGE_SIZE);
      const byScore = this.state.sort[pageKind] === 'average';
      const max = byScore ? 10 : Math.max(1, ...(pool || []).map(row => row.works));
      return `<div class="rank-axis" aria-hidden="true"><span>${byScore ? '个人均分' : '看过的作品'} · 0—${max}${byScore ? ' 分' : ' 部'}</span></div><ol class="people-list" start="${offset + 1}">${shown.map((row, index) => {
        const detail = `${formatNumber(row.works)} 部 · 均分 ${formatRate(row.averageRate)}`;
        const share = Math.max(0, Math.min(100, (byScore ? row.averageRate : row.works) / max * 100));
        const href = kind === 'tags' ? `/search/tag/anime/${encodeURIComponent(row.name)}` : `/person/${row.id}`;
        return `<li><span class="rank">${offset + index + 1}</span><div><div class="person-heading"><a href="${href}" target="_blank" rel="noopener">${escapeHtml(row.name)}</a><span class="person-meta">${byScore ? formatRate(row.averageRate) : `${formatNumber(row.works)} 部`}</span></div><span class="sr-only">${detail}</span><span class="person-track" title="${detail}" aria-hidden="true"><i class="person-bar" style="--share:${share}%"></i></span></div></li>`;
      }).join("")}</ol>${this.pager(pageKind, page, pages)}`;
    }
    overview(stats) {
      if (!stats.overview.works) return `<p class="empty">${!this.state.lastSync ? (/失败|异常/.test(this.state.progress.label) ? '可通过“更新”重试。' : '正在读取动画收藏…') : '还没有可回顾的动画。'}</p>`;
      if (this.state.activeTab === 'tags') return this.tags(stats.distributions.tags);
      return this.years(stats.distributions.years);
    }
    years(rows) {
      const series = Viz.yearSeries(rows);
      if (!series.length) return '<p class="empty">暂无年代资料。</p>';
      const axis = Viz.axis(Math.max(...series.map(row => row.count)));
      const first = series[0].year, last = series.at(-1).year;
      const caption = `首播年份 · ${first}—${last}`;
      return `<section class="year-chart" aria-label="看过动画的全部首播年份分布">
        <div class="viz-heading"><span class="viz-caption" data-default="${caption}" aria-live="polite">${caption}</span></div>
        <div class="year-plot"><div class="year-grid" aria-hidden="true">${axis.ticks.map(tick => `<span style="bottom:${tick / axis.max * 100}%"><b>${tick}</b></span>`).join('')}</div>
        <div class="year-columns" style="--columns:${series.length}">${series.map(row => {
          const label = `${row.year} 年 · ${row.count} 部`;
          const boundary = row.year === first || row.year === last;
          const five = boundary || (row.year % 5 === 0 && first - row.year >= 3 && row.year - last >= 3);
          const ten = boundary || (row.year % 10 === 0 && first - row.year >= 5 && row.year - last >= 5);
          return `<button class="year-column" aria-label="${label}" title="${label}" data-viz-label="${label}" data-label-five="${five}" data-label-ten="${ten}" style="--height:${row.count / axis.max * 100}%"><span class="column-fill"><span class="column-value">${row.count || ''}</span></span><span class="column-year">${row.year}</span></button>`;
        }).join('')}</div></div></section>`;
    }
    tags(rows) {
      const featured = Viz.featuredTags(rows);
      if (!featured.length) return '<p class="empty">还没有数量大于 10 部的标签。</p>';
      const entries = featured.map(row => ({
        id: row.name,
        name: row.name,
        works: row.count,
        ratedWorks: row.ratedCount,
        averageRate: row.averageRate,
        eps: 0,
      }));
      const ranking = Core.rankEntries(entries, this.state.sort.tags);
      return `${this.rankingTools("tags", "标签")}${this.listRows(this.filterRows(ranking.rows, this.state.search.tags), "tags", "tags", ranking.rows)}`;
    }
    staff(stats) {
      const groups = [{ id: "directors", label: "导演" }, { id: "series", label: "系列构成" }, { id: "studios", label: "动画制作" }, { id: "originals", label: "原作 / 原案" }, { id: "scripts", label: "脚本" }, { id: "music", label: "音乐" }, { id: "characterDesign", label: "角色设计" }];
      const active = groups.find(group => group.id === this.state.activeStaffGroup) || groups[0];
      const ranking = Core.rankEntries(stats.groups[active.id] || [], this.state.sort.staff, active.id === 'studios' ? 11 : Core.RANK_MINIMUM_WORKS);
      const rows = this.filterRows(ranking.rows, this.state.search.staff);
      return `<div class="role-switch" aria-label="创作职位">${groups.map(group => `<button type="button" data-action="staff-group" data-group="${group.id}" aria-pressed="${group.id === active.id}">${group.label}</button>`).join("")}</div>${this.rankingTools("staff", active.label)}${this.listRows(rows, "staff", "staff", ranking.rows)}`;
    }
    rankingTools(kind, label) {
      return `<div class="ranking-tools"><label><span class="sr-only">搜索${label}姓名</span><input type="search" data-search="${kind}" value="${escapeHtml(this.state.search[kind])}" placeholder="搜索${label}" autocomplete="off"></label>${this.sortControls(kind)}</div>`;
    }
    cast(stats) {
      const ranking = Core.rankEntries(stats.groups.cast, this.state.sort.cast);
      return `${this.rankingTools("cast", "声优")}${this.listRows(this.filterRows(ranking.rows, this.state.search.cast), "cast", "cast", ranking.rows)}`;
    }
    content(stats) {
      if (!["staff", "cast"].includes(this.state.activeTab)) return this.overview(stats);
      const enriching = Object.values(this.state.jobs).some(Boolean);
      const tools = `<div class="entity-tools"><button type="button" data-action="all" ${this.state.busy || !stats.overview.works ? "disabled" : ""}>${enriching ? "补全中…" : "补全人物资料"}</button>${enriching ? '<button type="button" data-action="cancel">暂停补全</button>' : ""}</div>`;
      return tools + (this.state.activeTab === "staff" ? this.staff(stats) : this.cast(stats));
    }
    render() {
      const active = this.shadow.activeElement;
      const action = active?.getAttribute("data-action");
      const key = active?.getAttribute("data-tab") || active?.getAttribute("data-group") || active?.getAttribute("data-sort") || active?.getAttribute('data-year-page') || active?.getAttribute('data-page-kind');
      const name = active?.getAttribute('aria-label');
      const stats = this.stats();
      this.isBusy();
      const progress = this.state.progress;
      const needsNotice = this.state.busy || /失败|异常/.test(progress.label);
      const tabs = Object.entries(TABS).map(([id, label]) => `<button type="button" aria-pressed="${this.state.activeTab === id}" data-action="tab" data-tab="${id}">${label}</button>`).join("");
      this.shadow.innerHTML = `${this.styles()}<section class="module" aria-labelledby="bgmstats-title" aria-busy="${this.state.busy}"><header class="module-head"><h2 id="bgmstats-title">动画回顾</h2><button class="update-button" type="button" data-action="sync" title="核对个人收藏与评分" aria-live="polite" ${this.state.busy ? "disabled" : ""}>${this.state.syncing ? "更新中…" : "更新"}</button></header><div class="tabs" role="group" aria-label="回顾分类">${tabs}</div><div class="progress" aria-live="polite" ${needsNotice ? "" : "hidden"}><span data-role="progress-label">${escapeHtml(progress.label)}</span><span data-role="progress-count"></span></div><div class="content">${this.content(stats)}</div></section>`;
      if (action && key) this.shadow.querySelectorAll('[data-action]').forEach(el => {
        const nextKey = el.getAttribute('data-tab') || el.getAttribute('data-group') || el.getAttribute('data-sort') || el.getAttribute('data-year-page') || el.getAttribute('data-page-kind');
        if (el.getAttribute('data-action') === action && (action === 'year-page' ? el.getAttribute('aria-label') === name : nextKey === key && (!active?.textContent || el.textContent === active.textContent)) && !el.disabled) el.focus({ preventScroll: true });
      });
    }
    styles() { return `<style>${globalThis.BangumiProfileUI.css}
      .content{padding:18px 0 0;min-height:230px}.content header{display:none}
      .entity-tools{display:flex;justify-content:flex-end;gap:6px;margin-bottom:12px;font-size:12px}
      .viz-heading{display:flex;justify-content:space-between;align-items:center;min-height:36px;gap:10px;color:var(--muted);font-size:12px;margin-bottom:16px}.viz-caption{overflow-wrap:anywhere}
      .year-plot{position:relative;margin:20px 16px 38px 38px;height:210px}.year-grid{position:absolute;inset:0;pointer-events:none}.year-grid>span{position:absolute;left:0;right:0;border-top:1px solid var(--line)}.year-grid b{position:absolute;right:calc(100% + 10px);top:-10px;font-size:11px;font-weight:400;color:var(--muted)}
      .year-columns{position:absolute;inset:0;display:grid;grid-template-columns:repeat(var(--columns),minmax(0,1fr));gap:clamp(1px,.45cqw,5px)}.year-column{position:relative;padding:0;border-radius:3px 3px 0 0;min-width:0;display:flex;align-items:flex-end;justify-content:center}.year-column:hover:not(:disabled){background:var(--soft)}.column-fill{position:relative;display:block;width:100%;max-width:24px;height:var(--height);border-radius:3px 3px 0 0;background:linear-gradient(to top,color-mix(in srgb,var(--pink) 14%,transparent),var(--pink))}.column-value{position:absolute;left:50%;bottom:calc(100% + 3px);transform:translateX(-50%);font-size:11px;color:var(--muted);display:none}.year-column:hover .column-value,.year-column:focus-visible .column-value{display:block}.column-year{display:none;position:absolute;left:50%;top:calc(100% + 10px);transform:translateX(-50%);font-size:10px;color:var(--muted)}.year-column[data-label-five="true"] .column-year{display:block}
      .role-switch{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:14px}.role-switch button[aria-pressed="true"]{color:var(--link);background:var(--pink-soft)}
      .ranking-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:12px 0 20px}.ranking-tools input{width:160px;font-size:12px}.sort-row{display:flex;gap:8px;align-items:center;font-size:12px}.sort-row>span{display:none}.sort-switch{display:flex;gap:3px}.sort-switch button[aria-pressed="true"]{color:var(--link);background:var(--pink-soft)}.sort-row small{max-width:140px;color:var(--muted)}
      .rank-axis{display:flex;justify-content:space-between;margin:0 0 14px 28px;padding-bottom:5px;border-bottom:1px solid var(--line);color:var(--muted);font-size:11px}.people-list{display:grid;grid-auto-flow:column;grid-template-rows:repeat(6,auto);grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 36px;list-style:none;margin:0;padding:0}.people-list li{display:flex;gap:10px;min-width:0}.rank{font-size:12px;color:var(--muted);width:18px;flex-shrink:0}.people-list li>div{flex:1;min-width:0}.person-heading{display:flex;align-items:baseline;gap:8px;justify-content:space-between}.person-heading a{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.person-meta{font-size:12px;color:var(--muted);white-space:nowrap}.person-track{display:block;height:2px;background:var(--line);margin:10px 5px 4px 0}.person-bar{display:block;position:relative;width:var(--share);height:2px;background:var(--pink)}.person-bar::after{content:"";position:absolute;right:-4px;top:-3px;width:8px;height:8px;border-radius:50%;background:var(--pink);border:1px solid var(--surface)}
      .pager{display:flex;justify-content:center;align-items:center;gap:16px;margin-top:20px;font-size:12px;color:var(--muted)}
      @container(max-width:500px){.people-list{grid-auto-flow:row;grid-template-rows:none;grid-template-columns:1fr;gap:20px}.sort-row{flex-wrap:wrap}.year-plot{height:190px;margin-left:30px}.year-columns{gap:1px}.year-column[data-label-five="true"] .column-year{display:none}.year-column[data-label-ten="true"] .column-year{display:block}}
    </style>`; }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => new StatsDrawer().mount(), { once: true });
  else new StatsDrawer().mount();
})();

