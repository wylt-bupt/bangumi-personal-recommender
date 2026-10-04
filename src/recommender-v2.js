(function bootstrapBangumiPersonalRecommender() {
  "use strict";

  const Feed = globalThis.BangumiRecommendationFeed;
  if (!Feed || document.getElementById("bgmpr-host")) return;

  const APP_VERSION = "0.11.1";
  const OWNER = Feed.OWNER;
  const PAGE_SIZE = 5;
  const FEED_TTL = 6 * 60 * 60 * 1000;
  const FEED_URL = "https://raw.githubusercontent.com/wylt-bupt/bangumi-personal-recommender/main/public/recommendations.json";

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function imageUrl(value) {
    try {
      const url = new URL(value, location.origin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  }

  function cached(key) {
    try { return JSON.parse(localStorage.getItem(`bgmpr:v2:${key}`) || "null"); }
    catch { return null; }
  }

  function cache(key, value, storedAt = Date.now()) {
    try { localStorage.setItem(`bgmpr:v2:${key}`, JSON.stringify({ storedAt, value })); }
    catch { /* Storage may be unavailable in private mode. */ }
  }

  function savedCollections() {
    const saved = cached("collections");
    if (!Number.isFinite(saved?.storedAt) || !Array.isArray(saved.value) ||
        !saved.value.every(row => Number.isSafeInteger(row?.subject_id) && row.subject_id > 0 && Number.isFinite(row.rate))) return null;
    return saved;
  }

  function localFeed() {
    const saved = cached("feed");
    try {
      if (Number.isFinite(saved?.storedAt)) return { feed: Feed.parseFeed(saved.value), raw: saved.value, source: "cache", storedAt: saved.storedAt };
    } catch { /* Ignore incompatible cached feeds and use the bundled fallback. */ }
    try {
      return { feed: Feed.parseFeed(globalThis.BangumiInitialRecommendationFeed), source: "bundle", storedAt: 0 };
    } catch { return null; }
  }

  async function requestJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: "no-cache", credentials: "omit" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } finally { clearTimeout(timer); }
  }

  class RecommenderApp {
    constructor() {
      this.state = {
        open: false, busy: false, pageOrder: [], current: [], currentPage: 1,
        collections: [], feed: null, profile: null, eligibleCandidateCount: 0,
      };
      this.excludedBatch = new Set();
      this.toastTimer = null;
      this.revision = 0;
    }

    mount() {
      this.host = globalThis.BangumiProfileUI?.mount("bgmpr-host", 20);
      if (!this.host) return;
      this.host.dataset.theme = globalThis.BangumiProfileUI.theme();
      this.shadow = this.host.attachShadow({ mode: "open" });
      this.shadow.innerHTML = `${this.styles()}<section class="module" aria-labelledby="bgmpr-title">
        <header class="module-head"><h2 id="bgmpr-title">个性推荐 · 动画</h2><button class="refresh-data update-button" type="button" title="核对个人收藏与最新推荐清单" aria-live="polite">更新</button></header>
        <div class="progress" role="status" hidden></div>
        <div class="welcome"><p>根据你的评分与公开用户的共同观看轨迹，寻找还未标记的作品。</p><button class="start" type="button">看看推荐</button></div>
        <div class="results" hidden><p class="summary"></p><div class="recommendation-list"></div><nav class="pagination" aria-label="推荐结果分页"></nav></div>
        <div class="error" hidden><p class="error-message"></p><button class="retry" type="button">重试</button></div>
        <div class="toast" role="status" hidden><span></span><button type="button">撤销</button></div>
      </section>`;
      this.bindEvents();
      const updateTheme = () => { this.host.dataset.theme = globalThis.BangumiProfileUI.theme(); };
      new MutationObserver(updateTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
      matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", updateTheme);
      const collections = savedCollections();
      const feed = localFeed();
      if (collections && feed) {
        this.state.open = true;
        this.applyData(feed, collections.value, collections.storedAt);
        globalThis.BangumiProfileUI.lazy(this.host, () => this.refreshFeed());
      } else globalThis.BangumiProfileUI.lazy(this.host, () => this.open());
    }

    $(selector) { return this.shadow.querySelector(selector); }

    bindEvents() {
      for (const selector of [".start", ".retry", ".refresh-data"]) {
        this.$(selector).addEventListener("click", () => this.ensureRecommendations({ force: true }));
      }
      this.shadow.addEventListener("click", (event) => {
        const target = event.target.closest?.("[data-dismiss-id], [data-page-direction], .toast button");
        if (!target) return;
        if (target.matches("[data-dismiss-id]")) this.dismiss(Number(target.dataset.dismissId));
        else if (target.matches("[data-page-direction]")) this.changePage(this.state.currentPage + Number(target.dataset.pageDirection));
        else if (target.matches(".toast button")) this.undoDismiss();
      });
      this.shadow.addEventListener("change", (event) => {
        if (event.target.matches?.("[data-page-select]")) this.changePage(Number(event.target.value));
      });
      this.shadow.addEventListener("error", (event) => {
        if (!event.target.matches?.("img[data-cover]")) return;
        event.target.hidden = true;
        event.target.nextElementSibling.hidden = false;
      }, true);
    }

    async open() {
      if (this.state.open) return;
      this.state.open = true;
      await this.ensureRecommendations();
    }

    setBusy(value, message = "") {
      this.state.busy = value;
      for (const selector of [".start", ".retry", ".refresh-data"]) this.$(selector).disabled = value;
      this.$(".refresh-data").textContent = value ? "更新中…" : "更新";
      this.$(".progress").hidden = !value;
      this.$(".progress").textContent = message;
      this.$(".module").setAttribute("aria-busy", String(value));
    }

    async getFeed(force) {
      const saved = localFeed();
      if (!force && saved?.source === "cache" && Date.now() - saved.storedAt < FEED_TTL) return saved;
      try {
        const raw = await requestJson(FEED_URL);
        return { feed: Feed.parseFeed(raw), raw, source: "remote", storedAt: Date.now() };
      } catch (error) {
        if (saved) return { ...saved, error };
        throw new Error(`推荐数据读取失败：${error.message}`);
      }
    }

    applyData(next, collections, checkedAt, reset = true) {
      this.state.feed = next.feed;
      this.feedSource = next.source;
      this.state.collections = collections;
      this.collectionCheckedAt = checkedAt;
      this.state.profile = { collectionCount: collections.length, ratedCount: collections.filter(row => row.rate > 0).length };
      this.state.pageOrder = Feed.unmarkedCandidates(next.feed, collections);
      this.state.eligibleCandidateCount = this.state.pageOrder.length;
      if (reset) {
        this.excludedBatch.clear();
        this.state.currentPage = 1;
      }
      this.renderFromPool();
    }

    notice(message) {
      this.$(".error").hidden = false;
      this.$(".error-message").textContent = message;
    }

    async refreshFeed() {
      const saved = localFeed();
      if (saved?.source === "cache" && Date.now() - saved.storedAt < FEED_TTL) return;
      const revision = this.revision;
      try {
        const next = await this.getFeed(false);
        if (revision !== this.revision) return;
        if (next.error) {
          this.notice("推荐清单更新失败，保留已有结果。可点击更新重试。");
          return;
        }
        if (next.source === "remote") cache("feed", next.raw);
        this.applyData(next, this.state.collections, this.collectionCheckedAt, false);
      } catch { if (revision === this.revision) this.notice("推荐清单更新失败，保留已有结果。可点击更新重试。"); }
    }

    async getCollections(force) {
      const saved = savedCollections();
      if (!force && saved) return saved;
      const rows = [];
      const seen = new Set();
      let total = Infinity;
      for (let offset = 0; offset < total; offset += 50) {
        const page = await requestJson(`https://api.bgm.tv/v0/users/${OWNER}/collections?subject_type=2&limit=50&offset=${offset}`);
        const batch = page.data;
        const count = Number(page.total);
        if (!Array.isArray(batch) || !Number.isSafeInteger(count) || count < 0 ||
            (total !== Infinity && total !== count) || batch.length > 50 ||
            (offset < count && !batch.length) || offset + batch.length > count) throw new Error("收藏分页信息无效或不完整");
        total = count;
        for (const row of batch) {
          const id = Number(row.subject_id);
          if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) throw new Error("收藏分页重复或条目无效");
          seen.add(id);
        }
        rows.push(...batch.map((row) => ({ subject_id: Number(row.subject_id), rate: Number(row.rate) || 0 })));
        this.$(".progress").textContent = `正在核对已标记动画… ${Math.min(rows.length, total)}/${total}`;
        if (!batch.length) break;
        if (offset + batch.length < total) await new Promise((resolve) => setTimeout(resolve, 180));
      }
      if (rows.length !== total) throw new Error("收藏分页不完整");
      return { value: rows, storedAt: Date.now() };
    }

    async ensureRecommendations({ force = false } = {}) {
      if (this.state.busy) return;
      this.revision += 1;
      this.setBusy(true, "正在读取推荐数据…");
      this.$(".error").hidden = true;
      try {
        const [feed, collections] = await Promise.all([this.getFeed(force), this.getCollections(force)]);
        if (force || !savedCollections()) cache("collections", collections.value, collections.storedAt);
        if (feed.source === "remote") cache("feed", feed.raw);
        this.applyData(feed, collections.value, collections.storedAt);
        if (feed.error) this.notice("收藏已核对；推荐清单更新失败，保留已有清单。");
      } catch (error) {
        if (!this.state.feed) this.$(".results").hidden = true;
        this.$(".welcome").hidden = true;
        this.$(".error").hidden = false;
        this.$(".error-message").textContent = `${error.message}。${this.state.feed ? "保留已有结果；" : ""}可稍后重试。`;
      } finally { this.setBusy(false); }
    }

    renderFromPool() {
      const available = this.state.pageOrder.filter((item) => !this.excludedBatch.has(item.subject.id));
      const pages = Math.max(1, Math.ceil(available.length / PAGE_SIZE));
      const page = Math.min(pages, Math.max(1, this.state.currentPage));
      const start = (page - 1) * PAGE_SIZE;
      this.state.currentPage = page;
      this.state.current = available.slice(start, start + PAGE_SIZE);
      this.$(".welcome").hidden = true;
      this.$(".error").hidden = true;
      this.$(".results").hidden = false;
      const feed = this.state.feed;
      const date = feed?.generatedAt ? new Date(feed.generatedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "本地预览";
      const model = feed?.model === "joint" ? "协同评分与内容偏好" : "内容偏好；公开评分用于发现候选";
      const checked = this.collectionCheckedAt
        ? new Date(this.collectionCheckedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : "本地预览";
      const fallback = this.feedSource === "bundle" ? " · 使用内置 50 条快照" : "";
      const neighbor = feed?.neighborCount ? `（${feed.neighborCount} 位近邻召回）` : "";
      this.$(".summary").textContent = `分析 ${feed?.ratedCount || this.state.profile?.ratedCount || 0} 条个人评分、${feed?.peerCount || 0} 位公开用户${neighbor} · ${model} · 数据 ${date} · 收藏核对 ${checked}${fallback}`;
      if (!available.length) this.$(".summary").textContent += " · 暂无未标记的候选动画";
      this.$(".recommendation-list").innerHTML = this.state.current.map((item) => this.card(item)).join("");
      const options = Array.from({ length: pages }, (_, index) => `<option value="${index + 1}" ${index + 1 === page ? "selected" : ""}>${index + 1}</option>`).join("");
      this.$(".pagination").innerHTML = `<button type="button" data-page-direction="-1" ${page === 1 ? "disabled" : ""}>上一页</button><label>第 <select data-page-select aria-label="跳转到推荐页">${options}</select> / ${pages} 页</label><button type="button" data-page-direction="1" ${page === pages ? "disabled" : ""}>下一页</button>`;
    }

    card(item) {
      const subject = item.subject;
      const title = subject.nameCn || subject.name || `条目 ${subject.id}`;
      const image = imageUrl(subject.image);
      const url = `${location.origin}/subject/${subject.id}`;
      const reasons = item.reasons.length ? item.reasons : ["结合你的历史评分与作品口碑排序。"];
      return `<article class="recommendation-card">
        <a class="cover" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="查看《${escapeHtml(title)}》">${image ? `<img data-cover src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy" width="140" height="196"><span class="cover-placeholder" hidden>暂无封面</span>` : '<span class="cover-placeholder">暂无封面</span>'}</a>
        <h3><a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></h3>
        <div class="content-tags">${subject.tags.slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
        <p class="brief">${escapeHtml(reasons[0])}</p>
        <details class="evidence-panel"><summary>推荐依据</summary><div class="evidence-body">${reasons.map((reason) => `<p>${escapeHtml(reason)}</p>`).join("")}<p class="evidence-score">预测评分 ${item.predicted.toFixed(1)} / 10 · 站点评分 ${subject.rating.score ? subject.rating.score.toFixed(1) : "暂无"}</p><button type="button" data-dismiss-id="${subject.id}">暂时隐藏</button></div></details>
      </article>`;
    }

    changePage(value) {
      this.state.currentPage = Number.isFinite(value) ? Math.trunc(value) : 1;
      this.renderFromPool();
    }

    dismiss(id) {
      this.previousDismiss = new Set(this.excludedBatch);
      this.excludedBatch.add(id);
      this.renderFromPool();
      this.$(".toast span").textContent = "已暂时隐藏，可撤销。";
      this.$(".toast").hidden = false;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { this.$(".toast").hidden = true; }, 5000);
    }

    undoDismiss() {
      this.excludedBatch = this.previousDismiss || new Set();
      this.$(".toast").hidden = true;
      this.renderFromPool();
    }

    styles() {
      return `<style>${globalThis.BangumiProfileUI.css}
        .welcome{padding:28px 0;text-align:center;color:var(--muted)}.summary{color:var(--muted);font-size:11px;margin:0 0 15px}
        .recommendation-list{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:18px;align-items:start}
        .recommendation-card{min-width:0}.cover{display:block;aspect-ratio:5/7;background:var(--soft);overflow:hidden;border-radius:7px}.cover img{display:block;width:100%;height:100%;object-fit:cover}.cover-placeholder{display:flex;width:100%;height:100%;align-items:center;justify-content:center;color:var(--muted)}
        .recommendation-card h3{margin-top:9px;font-size:13px;line-height:1.5}.recommendation-card h3 a{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:39px}
        .content-tags{display:flex;flex-wrap:wrap;gap:4px 7px;margin:5px 0;color:var(--link);font-size:11px;min-height:18px}.brief{font-size:12px;line-height:1.6;color:var(--muted);margin:6px 0 8px}
        .evidence-panel{font-size:12px}.evidence-panel summary{color:var(--site-link);width:fit-content;border-radius:4px;list-style:none}.evidence-body{padding-top:8px;line-height:1.75;overflow-wrap:anywhere}.evidence-body p{margin-bottom:8px}.evidence-score{color:var(--muted);font-size:11px}.evidence-body button{padding-left:0}
        .pagination{display:flex;align-items:center;justify-content:center;gap:15px;margin-top:24px;padding-top:12px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}.pagination label{display:flex;align-items:center;gap:5px}.pagination select{padding:3px 4px;font-size:12px}
        .toast{margin-top:12px;padding:8px 12px;background:var(--pink-soft);border-radius:6px;color:var(--link);font-size:12px}.toast button{margin-left:8px;color:var(--link)}
        @container(max-width:620px){.recommendation-list{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}}
        @container(max-width:400px){.recommendation-list{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 14px}.pagination{gap:9px}}
      </style>`;
    }
  }

  function start() {
    const app = new RecommenderApp();
    app.mount();
    globalThis.BangumiPersonalRecommender = app;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
