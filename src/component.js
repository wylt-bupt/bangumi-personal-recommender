(function bootstrapBangumiPersonalRecommender() {
  "use strict";

  const Core = globalThis.BangumiRecommenderCore;
  if (!Core || document.getElementById("bgmpr-host")) return;

  const APP_VERSION = "0.1.7";
  const DEFAULT_USER = "wylt";
  const API_BASE = "https://api.bgm.tv";
  const COLLECTION_TTL = 24 * 60 * 60 * 1000;
  const CANDIDATE_TTL = 3 * 24 * 60 * 60 * 1000;
  const ENTITY_TTL = 30 * 24 * 60 * 60 * 1000;
  const CONFIG_KEY = "bgmpr:config:v1";
  const DISMISSED_KEY = "bgmpr:dismissed:v1";
  const BOOK_FEEDBACK_RESET_MARKER = "bgmpr:migration:book-feedback-reset:0.1.2";
  const RECOMMENDATION_MODEL_VERSION = "8";

  const TYPE_OPTIONS = [2, 1, 4, 3, 6];
  const MODE_LABELS = Object.freeze({
    stable: "稳妥",
    balanced: "均衡",
    explore: "探索",
  });

  const ICONS = Object.freeze({
    spark: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.45 5.05L18.5 8.5l-5.05 1.45L12 15l-1.45-5.05L5.5 8.5l5.05-1.45L12 2Zm6 11 .9 3.1L22 17l-3.1.9L18 21l-.9-3.1L14 17l3.1-.9L18 13Z"/></svg>`,
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
      const tags = Core.topRetrievalTags(profile, 6);
      const signature = tags.map(Core.normalizeText).sort().join("|");
      const key = `candidates:v2:${subjectType}:${signature}`;
      return this.cached(
        key,
        CANDIDATE_TTL,
        async () => {
          try {
            const pools = [];
            this.progress("正在建立候选池…", 0, tags.length + 2);
            for (const offset of [0, 100]) {
              const page = await this.requestJson(
                `/v0/subjects?type=${subjectType}&sort=rank&limit=100&offset=${offset}`,
              );
              pools.push(...(page.data || []));
              this.progress("正在建立候选池…", pools.length / 100, tags.length + 2);
            }
            const searched = await concurrentMap(tags, 2, async (tag, index) => {
              const page = await this.requestJson(
                "/v0/search/subjects?limit=50&offset=0",
                {
                  method: "POST",
                  body: JSON.stringify({
                    keyword: tag,
                    sort: "heat",
                    filter: { type: [subjectType], tag: [tag] },
                  }),
                },
              );
              this.progress("正在按偏好召回候选…", index + 1, tags.length);
              return page.data || [];
            });
            pools.push(...searched.flat());
            return this.dedupeSubjects(pools);
          } catch (error) {
            this.progress("API 候选不可用，正在使用站内标签页…", 0, tags.length + 3);
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
      for (const tag of tags.slice(0, 6)) {
        const url = `${location.origin}/${type.slug}/tag/${encodeURIComponent(tag)}?sort=collects`;
        const documentNode = await this.getHtmlDocument(url);
        pools.push(...this.parseListItems(documentNode, subjectType, 0, tag).map((item) => item.subject));
        done += 1;
        this.progress("正在按偏好读取候选…", done, tags.length + 3);
        await sleep(220);
      }
      for (let page = 1; page <= 3; page += 1) {
        const url = `${location.origin}/${type.slug}/browser?sort=rank&page=${page}`;
        const documentNode = await this.getHtmlDocument(url);
        pools.push(...this.parseListItems(documentNode, subjectType, 0).map((item) => item.subject));
        done += 1;
        this.progress("正在补充高质量候选…", done, tags.length + 3);
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

    async enrichSubjects(subjects, subjectIds) {
      if (!this.apiAvailable || !subjectIds.length) return new Map();
      const uniqueIds = [...new Set(subjectIds)].slice(0, 36);
      let completed = 0;
      const rows = await concurrentMap(uniqueIds, 3, async (subjectId) => {
        const [details, persons, characters] = await Promise.all([
          this.getSubjectDetails(subjectId),
          this.getPersons(subjectId),
          this.getCharacters(subjectId),
        ]);
        completed += 1;
        this.progress("正在补充导演、制作与声优信息…", completed, uniqueIds.length);
        const base = subjects.find((subject) => Number(subject.id) === Number(subjectId));
        return base
          ? [subjectId, { ...base, ...(details ? Core.normalizeSubject(details) : {}), persons, characters }]
          : null;
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
        mode: "balanced",
        ...loadJson(CONFIG_KEY, {}),
      };
      this.dismissed = loadJson(DISMISSED_KEY, {});
      this.bookFeedbackWasReset = false;
      if (!localStorage.getItem(BOOK_FEEDBACK_RESET_MARKER)) {
        const previousBookFeedback = this.dismissed["1"] || [];
        if (previousBookFeedback.length) {
          this.dismissed["1"] = [];
          saveJson(DISMISSED_KEY, this.dismissed);
          this.bookFeedbackWasReset = true;
        }
        localStorage.setItem(BOOK_FEEDBACK_RESET_MARKER, "1");
      }
      this.client = new BangumiDataClient(
        this.store,
        this.config.username,
        (message, current, total) => this.setProgress(message, current, total),
      );
      this.state = {
        open: false,
        busy: false,
        profile: null,
        candidates: [],
        scoredPool: [],
        current: [],
        collections: [],
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
          <span class="icon">${ICONS.spark}</span><span>推荐</span>
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
            <label class="select-label">类型
              <select data-role="type-select">${typeOptions}</select>
            </label>
            <div class="mode-group" role="group" aria-label="推荐模式">
              ${Object.entries(MODE_LABELS)
                .map(
                  ([mode, label]) => `<button type="button" data-mode="${mode}" aria-pressed="${mode === this.config.mode}">${label}</button>`,
                )
                .join("")}
            </div>
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
      for (const button of this.shadow.querySelectorAll("[data-mode]")) {
        button.addEventListener("click", () => {
          this.config.mode = button.dataset.mode;
          this.persistConfig();
          this.updateModeButtons();
          if (this.state.profile && this.state.candidates.length) this.recompute();
          else this.ensureRecommendations({ force: false });
        });
      }
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
      if (this.bookFeedbackWasReset) {
        this.bookFeedbackWasReset = false;
        this.showToast("已撤销书籍类型的全部“不感兴趣”反馈。");
      }
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

    updateModeButtons() {
      for (const button of this.shadow.querySelectorAll("[data-mode]")) {
        button.setAttribute("aria-pressed", String(button.dataset.mode === this.config.mode));
      }
    }

    resetViewForType() {
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
      return `result:v${RECOMMENDATION_MODEL_VERSION}:${this.config.username}:${this.config.subjectType}:${this.config.mode}`;
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
        this.state.profile = Core.trainProfile(collections);
        if (this.state.profile.ratedCount < 5) throw new Error("已评分样本不足 5 个，暂时无法建立可靠画像。");

        const candidates = await this.client.getCandidates(type, this.state.profile, force);
        const marked = new Set(collections.map((item) => Number(item.subjectId)));
        this.state.candidates = candidates.filter((subject) => !marked.has(Number(subject.id)));
        if (this.state.candidates.length < 5) throw new Error("未标记候选不足 5 个，请稍后刷新候选池。");

        this.recompute();
        this.setProgress("基础推荐已完成，正在尝试补充人员信息…", 0, 0);

        if (this.client.apiAvailable) {
          await this.enhanceWithPeople();
          this.recompute();
        }

        this.state.lastSync = new Date().toISOString();
        this.updateSyncLabel();
        await this.saveCurrentResult();
        this.setProgress(
          `完成：分析 ${collections.length} 个收藏，比较 ${this.state.candidates.length} 个未标记候选。`,
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
      const candidatePreview = this.state.scoredPool.slice(0, 16).map((item) => item.subject.id);
      const allSubjects = [
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

    recompute() {
      const dismissed = new Set((this.dismissed[this.config.subjectType] || []).map(Number));
      const dismissedVectors = this.state.candidates
        .filter((subject) => dismissed.has(Number(subject.id)))
        .map((subject) => Core.buildFeatureVector(subject).features);
      const scored = this.state.candidates
        .filter((subject) => !dismissed.has(Number(subject.id)))
        .map((subject) => {
          const scoredSubject = Core.scoreSubject(subject, this.state.profile, this.config.mode);
          const feedbackSimilarity = dismissedVectors.length
            ? Math.max(...dismissedVectors.map((vector) => Core.weightedJaccard(scoredSubject.features, vector)))
            : 0;
          const feedbackPenalty = feedbackSimilarity * 0.16;
          const bookOrigin = Number(this.config.subjectType) === 1
            ? Core.classifyBookOrigin(scoredSubject.subject)
            : null;
          const originAdjustment = bookOrigin?.status === "japanese"
            ? 0.035
            : bookOrigin?.status === "unknown"
              ? -0.025
              : 0;
          return {
            ...scoredSubject,
            normalizedScore: scoredSubject.normalizedScore - feedbackPenalty + originAdjustment,
            predicted: Core.clamp(scoredSubject.predicted - feedbackPenalty * 1.5 + originAdjustment * 1.2, 1, 10),
            bookOrigin,
          };
        })
        .filter((item) =>
          Number(this.config.subjectType) !== 1 ||
          item.bookOrigin?.status !== "non_japanese" ||
          Core.isExceptionalForeignRecommendation(item),
        )
        .map((item) => ({
          ...item,
          bookOriginOverride:
            item.bookOrigin?.status === "non_japanese" && Core.isExceptionalForeignRecommendation(item),
        }))
        .sort((a, b) => b.normalizedScore - a.normalizedScore);
      this.state.scoredPool = scored.slice(0, 180);
      this.excludedBatch.clear();
      this.renderFromPool();
    }

    renderFromPool() {
      const available = this.state.scoredPool.filter((item) => !this.excludedBatch.has(item.subject.id));
      const source = available.length >= 5 ? available : this.state.scoredPool;
      const selected = Core.diversify(
        source,
        5,
        this.config.mode,
        `${Core.recommendationSalt()}:${this.excludedBatch.size}`,
      );
      this.state.current = selected;
      this.renderRecommendations(selected, {
        collectionCount: this.state.profile.collectionCount,
        ratedCount: this.state.profile.ratedCount,
        candidateCount: this.state.candidates.length,
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
      const type = String(this.config.subjectType);
      const previous = [...(this.dismissed[type] || [])];
      this.dismissed[type] = [...new Set([...previous, subjectId])];
      saveJson(DISMISSED_KEY, this.dismissed);
      if (this.state.scoredPool.length) {
        this.recompute();
      } else {
        this.state.current = this.state.current.filter((item) => Number(item.subject.id) !== subjectId);
        this.renderRecommendations(this.state.current, this.state.currentSummary);
        this.ensureRecommendations({ force: false });
      }
      this.showToast("已降低该条目及相似特征的推荐优先级。", () => {
        this.dismissed[type] = previous;
        saveJson(DISMISSED_KEY, this.dismissed);
        if (this.state.scoredPool.length) this.recompute();
        else this.ensureRecommendations({ force: false });
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
        if (entry.kind === "exception") {
          return "<li><span class=\"evidence-kind\">破例</span><p>虽非日本作品，但画像匹配与置信度同时达到极高阈值</p></li>";
        }
        return "<li><span class=\"evidence-kind\">口碑</span><p>全站评分与探索价值使它进入本轮候选</p></li>";
      });
      const shownSimilarCount = evidence
        .filter((entry) => entry.kind === "similarity")
        .reduce((sum, entry) => sum + entry.works.length, 0);
      return `
        <article class="recommendation-card" data-book-origin="${escapeHtml(item.bookOrigin?.status || "")}" data-origin-override="${item.bookOriginOverride ? "true" : "false"}" data-evidence-count="${evidence.length}" data-content-tag-count="${contentTags.length}" data-similar-count="${shownSimilarCount}" data-confidence="${confidencePercent}" data-confidence-feature="${featurePercent}" data-confidence-neighbor="${neighborPercent}" data-confidence-rating="${ratingPercent}">
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
              <button class="ghost compact" type="button" data-dismiss-id="${subject.id}" aria-label="降低《${escapeHtml(title)}》的推荐优先级">${ICONS.hide}<span>不感兴趣</span></button>
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
            candidateCount: this.state.candidates.length,
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
          z-index: 10; min-height: 48px; padding: 0 17px; border: 1px solid color-mix(in srgb, var(--primary) 75%, #000 10%);
          border-radius: 999px; background: var(--primary); color: var(--on-primary); box-shadow: 0 8px 24px rgba(99, 36, 55, .28);
          display: inline-flex; align-items: center; gap: 8px; font-weight: 700; letter-spacing: .02em;
          transition: background 180ms ease-out, box-shadow 180ms ease-out, transform 120ms ease-out;
        }
        .launcher:hover { background: var(--primary-strong); box-shadow: 0 10px 30px rgba(99, 36, 55, .36); }
        .launcher:active { transform: scale(.97); }
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
        .controls { padding: 14px 24px; display: flex; align-items: end; gap: 12px; border-bottom: 1px solid var(--border); background: var(--surface-alt); }
        .select-label { display: grid; gap: 5px; color: var(--text-muted); font-size: 12px; font-weight: 700; }
        select { min-width: 96px; height: 44px; padding: 0 32px 0 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
        .mode-group { display: grid; grid-template-columns: repeat(3, 1fr); flex: 1; border: 1px solid var(--border); border-radius: 11px; padding: 3px; background: var(--surface); }
        .mode-group button { min-height: 36px; border: 0; border-radius: 8px; background: transparent; color: var(--text-muted); font-size: 13px; font-weight: 700; }
        .mode-group button[aria-pressed="true"] { background: var(--text); color: var(--surface); }
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
          .controls { padding: 12px 16px; align-items: stretch; flex-direction: column; }
          .select-label { grid-template-columns: 42px 1fr; align-items: center; }
          select { width: 100%; }
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
          .launcher { right: 12px; bottom: max(68px, calc(env(safe-area-inset-bottom) + 12px)); }
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
