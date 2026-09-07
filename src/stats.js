(function bootstrapBangumiPersonalStats() {
  "use strict";

  const Core = globalThis.BangumiPersonalStatsCore;
  const Viz = globalThis.BangumiStatsViz;
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
  const APP_VERSION = "0.9.4";
  const RANK_PAGE_SIZE = 12;
  const TABS = Object.freeze({ overview: "年代", seasons: "季度", tags: "标签", staff: "创作", cast: "声优" });

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
      this.cloudObserver = new ResizeObserver(() => this.scheduleCloud());
      this.cloudObserver.observe(this.host);
      document.fonts?.ready.then(() => { const cloud = this.$('.tag-cloud'); if (cloud) delete cloud.dataset.width; this.scheduleCloud(); });
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
      const eligibility = kind === 'staff' && this.state.activeStaffGroup === 'studios' ? '仅作品数大于 10 部者入榜' : '仅作品数位于前 10% 者入榜';
      return `<div class="sort-row"><span>排序</span><div class="sort-switch" role="group" aria-label="排名排序方式"><button type="button" data-action="sort" data-sort-kind="${kind}" data-sort="works" aria-pressed="${active === "works"}">作品数</button><button type="button" data-action="sort" data-sort-kind="${kind}" data-sort="average" aria-pressed="${active === "average"}">均分</button></div>${active === "average" ? `<small>${eligibility}</small>` : ""}</div>`;
    }
    pager(kind, page, pages) {
      if (pages <= 1) return "";
      return `<div class="pager" aria-label="分页"><button type="button" data-action="page" data-page-kind="${kind}" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button><span>${page} / ${pages}</span><button type="button" data-action="page" data-page-kind="${kind}" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>下一页</button></div>`;
    }
    listRows(rows, kind, pageKind) {
      if (!rows.length) return '<p class="empty">暂无匹配的人物。资料尚未齐全时，可在“更新”中补全。</p>';
      const pages = Math.max(1, Math.ceil(rows.length / RANK_PAGE_SIZE));
      const page = Math.min(pages, Math.max(1, this.state.pages[pageKind] || 1));
      this.state.pages[pageKind] = page;
      const offset = (page - 1) * RANK_PAGE_SIZE;
      const shown = rows.slice(offset, offset + RANK_PAGE_SIZE);
      const byScore = this.state.sort[pageKind] === 'average';
      const max = byScore ? 10 : Math.max(1, ...this.stats().groups[pageKind === 'cast' ? 'cast' : this.state.activeStaffGroup].map(row => row.works));
      return `<div class="rank-axis" aria-hidden="true"><span>${byScore ? '个人均分' : '看过的作品'} · 0—${max}${byScore ? ' 分' : ' 部'}</span></div><ol class="people-list" start="${offset + 1}">${shown.map((row, index) => {
        const detail = `${formatNumber(row.works)} 部 · 均分 ${formatRate(row.averageRate)}`;
        const share = Math.max(0, Math.min(100, (byScore ? row.averageRate : row.works) / max * 100));
        return `<li><span class="rank">${offset + index + 1}</span><div><div class="person-heading"><a href="/person/${row.id}" target="_blank" rel="noopener">${escapeHtml(row.name)}</a><span class="person-meta">${byScore ? formatRate(row.averageRate) : `${formatNumber(row.works)} 部`}</span></div><span class="sr-only">${detail}</span><span class="person-track" title="${detail}" aria-hidden="true"><i class="person-bar" style="--share:${share}%"></i></span></div></li>`;
      }).join("")}</ol>${this.pager(pageKind, page, pages)}`;
    }
    overview(stats) {
      if (!stats.overview.works) return `<p class="empty">${!this.state.lastSync ? (/失败|异常/.test(this.state.progress.label) ? '可通过“更新”重试。' : '正在读取动画收藏…') : '还没有可回顾的动画。'}</p>`;
      if (this.state.activeTab === 'tags') return this.tags(stats.distributions.tags);
      if (this.state.activeTab === 'seasons') return this.seasons();
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
      rows = Viz.featuredTags(rows);
      if (!rows.length) return '<p class="empty">还没有数量大于 10 部的标签。</p>';
      const min = rows.at(-1).count, max = rows[0].count;
      const caption = '常见的喜好';
      return `<section aria-label="数量大于10部的个人标签词云"><div class="viz-heading"><span class="viz-caption" data-default="${caption}" aria-live="polite">${caption}</span></div><div class="tag-cloud">${rows.map(row => {
        const ratio = row.count / max;
        const tone = ratio >= 0.6 ? 'hero' : ratio >= 0.28 ? 'strong' : ratio >= 0.1 ? 'medium' : 'quiet';
        const size = Viz.fontSize(row.count, min, max);
        return `<button class="cloud-word" data-tone="${tone}" data-count="${row.count}" data-viz-label="${escapeHtml(row.name)} · ${row.count} 部" title="${escapeHtml(row.name)} · ${row.count} 部" aria-label="${escapeHtml(row.name)}，${row.count} 部" data-size="${size}" style="font-size:${size}px">${escapeHtml(row.name)}</button>`;
      }).join('')}</div></section>`;
    }
    seasons() {
      const distribution = Viz.seasonDistribution(this.state.collections);
      if (!distribution.total) return '<p class="empty">暂无可归入季度的首播日期。</p>';
      const slices = Viz.pieSlices(distribution.groups);
      return `<section aria-label="四个新番季度的数量与个人均分"><div class="viz-heading" title="按首播月份归类：1—3月、4—6月、7—9月、10—12月；均分仅计算已评分作品。">四季新番</div><div class="season-distribution"><svg class="season-pie" viewBox="0 0 240 240" aria-hidden="true">${slices.map((slice, index) => slice.count ? `<path d="${slice.path}" style="fill:var(--season-${index})"><title>${slice.label}：${slice.count} 部，个人均分 ${slice.average === null ? '暂无' : slice.average.toFixed(2)}</title></path>${slice.share >= 0.08 ? `<text x="${slice.labelX}" y="${slice.labelY}" text-anchor="middle" dominant-baseline="middle">${Math.round(slice.share * 100)}%</text>` : ''}` : '').join('')}</svg><div class="season-summary"><div class="season-legend-head" aria-hidden="true"><span>季度</span><span>数量</span><span>个人均分</span></div><ul class="season-legend">${slices.map((slice,index) => `<li aria-label="${slice.label}，${slice.count} 部，占 ${(slice.share*100).toFixed(1)}%，个人均分 ${slice.average === null ? '暂无' : slice.average.toFixed(2)}，${slice.rated} 部已评分"><span class="season-name"><i style="background:var(--season-${index})" aria-hidden="true"></i>${slice.label}</span><span class="season-count">${slice.count} 部</span><b class="season-average" title="${slice.rated} 部已评分">${slice.average === null ? '—' : slice.average.toFixed(2)}</b></li>`).join('')}</ul></div></div>${distribution.unknown ? `<p class="distribution-note">${distribution.unknown} 部首播月份不明，未计入季度</p>` : ''}</section>`;
    }
    scheduleCloud() {
      cancelAnimationFrame(this.cloudFrame);
      this.cloudFrame = requestAnimationFrame(() => this.layoutCloud());
    }
    layoutCloud() {
      const cloud = this.$('.tag-cloud');
      if (!cloud) return;
      const width = cloud.clientWidth;
      if (width < 40 || cloud.dataset.width === String(width)) return;
      const words = Array.from(cloud.querySelectorAll('.cloud-word'));
      // Measure real browser text, including CJK/fallback fonts and browser text scaling.
      words.forEach(word => {
        word.style.maxWidth = 'none';
        const scale = Math.min(1, Math.pow(width / 600, 0.35));
        word.style.fontSize = Math.max(12, Number(word.dataset.size) * scale) + 'px';
      });
      const naturalWidths = words.map(word => word.getBoundingClientRect().width);
      words.forEach((word, index) => {
        if (naturalWidths[index] > width - 20) word.style.fontSize = Math.max(12, parseFloat(word.style.fontSize) * (width - 20) / naturalWidths[index]) + 'px';
        word.style.maxWidth = (width - 20) + 'px';
      });
      const boxes = words.map((word, index) => {
        const rect = word.getBoundingClientRect();
        return { index, width: rect.width, height: rect.height };
      });
      const layout = Viz.packCloud(boxes, width);
      for (const box of layout.items) {
        const word = words[box.index];
        word.style.left = box.x + 'px'; word.style.top = box.y + 'px';
      }
      cloud.style.height = layout.height + 'px';
      cloud.dataset.width = width;
      cloud.classList.add('is-ready');
    }
    staff(stats) {
      const groups = [{ id: "directors", label: "导演" }, { id: "series", label: "系列构成" }, { id: "studios", label: "动画制作" }, { id: "originals", label: "原作 / 原案" }, { id: "scripts", label: "脚本" }, { id: "music", label: "音乐" }, { id: "characterDesign", label: "角色设计" }];
      const active = groups.find(group => group.id === this.state.activeStaffGroup) || groups[0];
      const ranking = Core.rankEntries(stats.groups[active.id] || [], this.state.sort.staff, 0.1, active.id === 'studios' ? 10 : null);
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
      const key = active?.getAttribute("data-tab") || active?.getAttribute("data-group") || active?.getAttribute("data-sort") || active?.getAttribute('data-year-page') || active?.getAttribute('data-page-kind');
      const name = active?.getAttribute('aria-label');
      const settingsOpen = this.$(".data-settings")?.open;
      const stats = this.stats();
      this.isBusy();
      const progress = this.state.progress;
      const needsNotice = this.state.busy || /失败|异常/.test(progress.label);
      const tabs = Object.entries(TABS).map(([id, label]) => `<button type="button" aria-pressed="${this.state.activeTab === id}" data-action="tab" data-tab="${id}">${label}</button>`).join("");
      this.shadow.innerHTML = `${this.styles()}<section class="module" aria-labelledby="bgmstats-title"><header class="module-head"><h2 id="bgmstats-title">动画回顾</h2><details class="data-settings" ${settingsOpen ? "open" : ""}><summary>更新</summary><div><button data-action="sync" ${this.state.busy ? "disabled" : ""}>更新收藏</button><button data-action="all" ${this.state.busy || !stats.overview.works ? "disabled" : ""}>补全人物资料</button>${this.state.busy ? '<button data-action="cancel">暂停补全</button>' : ""}</div></details></header><div class="tabs" role="group" aria-label="回顾分类">${tabs}</div><div class="progress" aria-live="polite" ${needsNotice ? "" : "hidden"}><span data-role="progress-label">${escapeHtml(progress.label)}</span><span data-role="progress-count"></span></div><div class="content">${this.content(stats)}</div></section>`;
      if (action && key) this.shadow.querySelectorAll('[data-action]').forEach(el => {
        const nextKey = el.getAttribute('data-tab') || el.getAttribute('data-group') || el.getAttribute('data-sort') || el.getAttribute('data-year-page') || el.getAttribute('data-page-kind');
        if (el.getAttribute('data-action') === action && (action === 'year-page' ? el.getAttribute('aria-label') === name : nextKey === key && (!active?.textContent || el.textContent === active.textContent)) && !el.disabled) el.focus({ preventScroll: true });
      });
      this.scheduleCloud();
    }
    styles() { return `<style>${globalThis.BangumiProfileUI.css}
      .content{padding:18px 0 0;min-height:230px}.content header{display:none}
      .data-settings{position:relative;font-size:12px;color:var(--muted)}.data-settings summary{padding:4px 9px;border-radius:6px}.data-settings>div{position:absolute;right:0;top:32px;z-index:2;display:grid;min-width:150px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:6px;box-shadow:0 3px 12px #0000000a}
      .viz-heading{display:flex;justify-content:space-between;align-items:center;min-height:36px;gap:10px;color:var(--muted);font-size:12px;margin-bottom:16px}.viz-caption{overflow-wrap:anywhere}
      .year-plot{position:relative;margin:20px 16px 38px 38px;height:210px}.year-grid{position:absolute;inset:0;pointer-events:none}.year-grid>span{position:absolute;left:0;right:0;border-top:1px solid var(--line)}.year-grid b{position:absolute;right:calc(100% + 10px);top:-10px;font-size:11px;font-weight:400;color:var(--muted)}
      .year-columns{position:absolute;inset:0;display:grid;grid-template-columns:repeat(var(--columns),minmax(0,1fr));gap:clamp(1px,.45cqw,5px)}.year-column{position:relative;padding:0;border-radius:3px 3px 0 0;min-width:0;display:flex;align-items:flex-end;justify-content:center}.year-column:hover:not(:disabled){background:var(--soft)}.column-fill{position:relative;display:block;width:100%;max-width:24px;height:var(--height);border-radius:3px 3px 0 0;background:linear-gradient(to top,color-mix(in srgb,var(--pink) 14%,transparent),var(--pink))}.column-value{position:absolute;left:50%;bottom:calc(100% + 3px);transform:translateX(-50%);font-size:11px;color:var(--muted);display:none}.year-column:hover .column-value,.year-column:focus-visible .column-value{display:block}.column-year{display:none;position:absolute;left:50%;top:calc(100% + 10px);transform:translateX(-50%);font-size:10px;color:var(--muted)}.year-column[data-label-five="true"] .column-year{display:block}
      .tag-cloud{--cloud-hero:#cb4168;--cloud-strong:#a94868;--cloud-medium:#725669;--cloud-quiet:#77727a;position:relative;min-height:260px;visibility:hidden}.tag-cloud.is-ready{visibility:visible}:host([data-theme="dark"]) .tag-cloud{--cloud-hero:#ff8fb3;--cloud-strong:#e9a4bd;--cloud-medium:#ccb0c8;--cloud-quiet:#aaa0b0}.cloud-word{position:absolute;white-space:nowrap;padding:2px 3px;line-height:1.15;min-height:0!important;font-weight:400;border-radius:4px;color:var(--cloud-quiet);overflow:hidden;text-overflow:ellipsis;letter-spacing:-.025em}.cloud-word[data-tone="hero"]{color:var(--cloud-hero);font-weight:800}.cloud-word[data-tone="strong"]{color:var(--cloud-strong);font-weight:700}.cloud-word[data-tone="medium"]{color:var(--cloud-medium);font-weight:500}.cloud-word:hover:not(:disabled),.cloud-word:focus-visible{color:var(--cloud-hero);background:var(--pink-soft)}
      .season-distribution{--season-0:#93bbcc;--season-1:#efa2b4;--season-2:#e8bd83;--season-3:#baa3ca;display:grid;grid-template-columns:minmax(200px,280px) minmax(0,1fr);align-items:center;gap:42px;max-width:680px;margin:0 auto}.season-pie{width:100%;height:auto}.season-pie path{stroke:var(--surface);stroke-width:2}.season-pie text{fill:#38292c;font:13px Arial,sans-serif;pointer-events:none}.season-legend{list-style:none;margin:0;padding:0;display:grid;gap:0}.season-legend-head,.season-legend li{display:grid;grid-template-columns:minmax(75px,1fr) 70px 70px;align-items:center;gap:10px}.season-legend-head{color:var(--muted);font-size:11px;padding:0 0 9px}.season-legend-head span:not(:first-child){text-align:right}.season-legend li{padding:14px 0;border-top:1px solid var(--line)}.season-name{display:flex;align-items:center;gap:9px}.season-name i{width:9px;height:9px;flex-shrink:0;border-radius:50%}.season-count{text-align:right;font-variant-numeric:tabular-nums}.season-average{font-size:18px;text-align:right;font-weight:500;color:var(--link);font-variant-numeric:tabular-nums}.distribution-note{text-align:center;color:var(--muted);font-size:11px;margin-top:16px}
      .role-switch{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:14px}.role-switch button[aria-pressed="true"]{color:var(--link);background:var(--pink-soft)}
      .ranking-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:12px 0 20px}.ranking-tools input{width:160px;font-size:12px}.sort-row{display:flex;gap:8px;align-items:center;font-size:12px}.sort-row>span{display:none}.sort-switch{display:flex;gap:3px}.sort-switch button[aria-pressed="true"]{color:var(--link);background:var(--pink-soft)}.sort-row small{max-width:140px;color:var(--muted)}
      .rank-axis{display:flex;justify-content:space-between;margin:0 0 14px 28px;padding-bottom:5px;border-bottom:1px solid var(--line);color:var(--muted);font-size:11px}.people-list{display:grid;grid-auto-flow:column;grid-template-rows:repeat(6,auto);grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 36px;list-style:none;margin:0;padding:0}.people-list li{display:flex;gap:10px;min-width:0}.rank{font-size:12px;color:var(--muted);width:18px;flex-shrink:0}.people-list li>div{flex:1;min-width:0}.person-heading{display:flex;align-items:baseline;gap:8px;justify-content:space-between}.person-heading a{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.person-meta{font-size:12px;color:var(--muted);white-space:nowrap}.person-track{display:block;height:2px;background:var(--line);margin:10px 5px 4px 0}.person-bar{display:block;position:relative;width:var(--share);height:2px;background:var(--pink)}.person-bar::after{content:"";position:absolute;right:-4px;top:-3px;width:8px;height:8px;border-radius:50%;background:var(--pink);border:1px solid var(--surface)}
      .pager{display:flex;justify-content:center;align-items:center;gap:16px;margin-top:20px;font-size:12px;color:var(--muted)}
      @container(max-width:500px){.people-list{grid-auto-flow:row;grid-template-rows:none;grid-template-columns:1fr;gap:20px}.sort-row{flex-wrap:wrap}.year-plot{height:190px;margin-left:30px}.year-columns{gap:1px}.year-column[data-label-five="true"] .column-year{display:none}.year-column[data-label-ten="true"] .column-year{display:block}.season-distribution{grid-template-columns:1fr;gap:22px}.season-pie{max-width:250px;justify-self:center}.season-summary{width:100%}}
    </style>`; }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => new StatsDrawer().mount(), { once: true });
  else new StatsDrawer().mount();
})();
