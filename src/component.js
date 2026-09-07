(function bootstrapBangumiPersonalRecommender() {
  "use strict";

  const Core = globalThis.BangumiRecommenderCore;
  if (!Core || document.getElementById("bgmpr-host")) return;

  const APP_VERSION = "0.9.4";
  const DEFAULT_USER = "wylt";
  const API_BASE = "https://api.bgm.tv";
  const COLLECTION_TTL = 24 * 60 * 60 * 1000;
  const CANDIDATE_TTL = 3 * 24 * 60 * 60 * 1000;
  const ENTITY_TTL = 30 * 24 * 60 * 60 * 1000;
  const CONFIG_KEY = "bgmpr:config:v1";
  const RECOMMENDATION_MODEL_VERSION = "28";
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
                  Core.withoutCreativeContributors(subject),
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
