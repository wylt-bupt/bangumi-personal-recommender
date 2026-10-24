(function bootstrapBangumiRecommender() {
  "use strict";
  const Core = globalThis.BangumiRecommenderCore;
  if (!Core || document.getElementById("bgmpr-host")) return;
  const APP_VERSION = "0.13.0";

  const OWNER = "wylt";
  const PAGE_SIZE = 5;
  const MODULES = [
    { key: "anime", subjectType: 2, title: "动画推荐", limit: 30 },
    { key: "book", subjectType: 1, title: "书籍推荐", limit: 20 },
  ];
  const REQUEST_DELAY = 250;
  const RELATION_TTL = 30 * 86400000;
  const RANKED_MAX_PAGES = 50;

  const store = {
    get(key) {
      try {
        const payload = JSON.parse(localStorage.getItem(`bgmpr:v3:${key}`));
        return payload && Number.isFinite(payload.storedAt) ? payload : null;
      } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(`bgmpr:v3:${key}`, JSON.stringify({ storedAt: Date.now(), value })); } catch { /* 私密模式忽略 */ }
    },
  };
  // 旧协同过滤管线的缓存键一并退役。
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith("bgmpr:v2:")) localStorage.removeItem(key);
  } catch { /* 私密模式忽略 */ }

  async function requestJson(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store", credentials: "omit", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Bangumi API 返回 ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error.name === "AbortError") throw new Error("连接超时，稍后再试");
      if (error instanceof TypeError) throw new Error("暂时无法连接 Bangumi API");
      throw error;
    } finally { clearTimeout(timeout); }
  }
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  /* 收藏分页：任何一页的口径对不上都整体作废，绝不把不完整的结果当成
     成功的标签库来源。返回裁剪后的行 { id, rate, tags }（tags 为全站用户
     标注的标签名，subject.tags，不是我的个人标注）。 */
  async function fetchCollections(subjectType, onProgress) {
    const rows = [];
    let total = Infinity;
    for (let offset = 0; offset < total; offset += 50) {
      const page = await requestJson(`https://api.bgm.tv/v0/users/${OWNER}/collections?subject_type=${subjectType}&limit=50&offset=${offset}`);
      const batch = Array.isArray(page.data) ? page.data : [];
      const count = Number(page.total);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error("收藏分页信息无效");
      if (offset === 0) total = count;
      else if (count !== total) throw new Error("收藏分页信息无效");
      if (batch.length > 50 || (offset < total && !batch.length) || offset + batch.length > total) throw new Error("收藏分页信息无效或不完整");
      for (const row of batch) {
        const id = Number(row && row.subject_id);
        if (!Number.isSafeInteger(id) || id <= 0 || rows.some(existing => existing.id === id)) throw new Error("收藏分页重复或条目无效");
        const subject = row.subject || {};
        // 保持 buildTagDb 消费的形状：评分挂在 rate，标签挂在 subject.tags。
        rows.push({
          id,
          rate: Number(row.rate) || 0,
          subject: { id, tags: Array.isArray(subject.tags) ? subject.tags.filter(tag => tag && typeof tag.name === 'string' && tag.name).map(tag => tag.name) : [] },
        });
      }
      if (onProgress) onProgress(Math.min(rows.length, total), total);
      if (batch.length < 50) break;
      await delay(REQUEST_DELAY);
    }
    if (rows.length !== total) throw new Error("收藏分页不完整");
    return rows;
  }

  /* 候选池：全站排行分页（列表项自带 platform/tags/rating），直到整页的
     评分人数都低于门槛为止，扩大到全部 ≥500 人评分的条目。 */
  async function fetchRanked(subjectType, onProgress) {
    const rows = [];
    for (let offset = 0; offset < RANKED_MAX_PAGES * 100; offset += 100) {
      const page = await requestJson(`https://api.bgm.tv/v0/subjects?type=${subjectType}&sort=rank&limit=100&offset=${offset}`);
      const batch = Array.isArray(page.data) ? page.data : [];
      for (const subject of batch) {
        if (!subject || !Number.isSafeInteger(Number(subject.id))) continue;
        rows.push({
          id: Number(subject.id),
          name: subject.name || "",
          name_cn: subject.name_cn || "",
          platform: subject.platform || "",
          images: subject.images || {},
          rating: { score: Number(subject.rating && subject.rating.score) || 0, total: Number(subject.rating && subject.rating.total) || 0 },
          tags: Array.isArray(subject.tags) ? subject.tags.filter(tag => tag && typeof tag.name === "string").map(tag => tag.name) : [],
        });
      }
      if (onProgress) onProgress(rows.length);
      if (!batch.length || !batch.some(subject => subject.rating && Number(subject.rating.total) >= Core.MIN_RATINGS)) break;
      await delay(REQUEST_DELAY);
    }
    return rows;
  }

  class RecommenderApp {
    constructor() {
      this.state = {
        results: { anime: null, book: null },
        pages: { anime: 1, book: 1 },
        busy: { anime: false, book: false },
      };
      this.relations = null;
      this.pendingRelationSaves = 0;
    }

    mount() {
      this.host = globalThis.BangumiProfileUI?.mount("bgmpr-host", 20);
      if (!this.host) return false;
      this.shadow = this.host.shadowRoot ?? this.host.attachShadow({ mode: "open" });
      this.shadow.innerHTML = `<style>${this.styles()}</style>${MODULES.map(module => `
        <section class="module rec-module" data-module="${module.key}" aria-labelledby="bgmpr-title-${module.key}">
          <header class="module-head"><h2 id="bgmpr-title-${module.key}">${module.title}</h2><button class="refresh-data update-button" type="button" aria-live="polite">更新</button></header>
          <div class="progress" role="status" hidden><span class="progress-text"></span></div>
          <div class="empty" hidden>暂无推荐结果，点击右上角「更新」生成。</div>
          <div class="results" hidden><div class="rec-list"></div><nav class="pagination" aria-label="${module.title}分页"></nav></div>
          <p class="error" hidden></p>
        </section>`).join("")}`;
      this.hydrate();
      this.bind();
      this.theme();
      new MutationObserver(() => this.theme()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.theme());
      return true;
    }

    $(selector, key) {
      const scope = key ? this.shadow.querySelector(`[data-module="${key}"]`) : this.shadow;
      return scope.querySelector(selector);
    }
    $$(selector, key) {
      const scope = key ? this.shadow.querySelector(`[data-module="${key}"]`) : this.shadow;
      return Array.from(scope.querySelectorAll(selector));
    }

    hydrate() {
      for (const module of MODULES) {
        const cached = store.get(`result:${module.key}`);
        if (cached && Array.isArray(cached.value.items)) this.state.results[module.key] = cached.value;
      }
      this.renderAll();
    }

    bind() {
      this.shadow.addEventListener("click", event => {
        const module = event.target.closest("[data-module]");
        if (!module) return;
        if (event.target.closest(".refresh-data")) { this.refresh(module.dataset.module); return; }
        const direction = event.target.closest("[data-page-direction]");
        if (direction) this.changePage(module.dataset.module, this.state.pages[module.dataset.module] + Number(direction.dataset.pageDirection));
      });
      this.shadow.addEventListener("change", event => {
        const select = event.target.closest("[data-page-select]");
        if (select) this.changePage(select.closest("[data-module]").dataset.module, Number(select.value));
      });
    }

    theme() {
      const attr = document.documentElement.getAttribute("data-theme");
      this.host.dataset.theme = attr === "dark" || (attr !== "light" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }

    setBusy(key, busy) {
      this.state.busy[key] = busy;
      const section = this.shadow.querySelector(`[data-module="${key}"]`);
      const button = section.querySelector(".refresh-data");
      button.disabled = busy;
      button.textContent = busy ? "更新中…" : "更新";
      section.toggleAttribute("aria-busy", busy);
      if (!busy) { const progress = this.$(".progress", key); progress.hidden = true; }
    }
    setProgress(key, text) {
      const progress = this.$(".progress", key);
      progress.hidden = false;
      progress.querySelector(".progress-text").textContent = text;
    }
    setError(key, message) {
      const error = this.$(".error", key);
      error.hidden = !message;
      error.textContent = message || "";
    }

    changePage(key, page) {
      const items = this.state.results[key]?.items || [];
      const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
      this.state.pages[key] = Math.min(pages, Math.max(1, page));
      this.renderModule(key);
    }

    renderAll() { for (const module of MODULES) this.renderModule(module.key); }

    renderModule(key) {
      const result = this.state.results[key];
      const items = result?.items || [];
      const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
      this.state.pages[key] = Math.min(this.state.pages[key] || 1, pages);
      const page = this.state.pages[key];
      this.$(".results", key).hidden = !items.length;
      this.$(".empty", key).hidden = Boolean(items.length) || this.state.busy[key];
      const list = this.$(".rec-list", key);
      list.innerHTML = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(item => this.card(item)).join("");
      for (const image of list.querySelectorAll("img")) image.addEventListener("error", () => image.remove(), { once: true });
      const options = Array.from({ length: pages }, (_, index) => `<option value="${index + 1}" ${index + 1 === page ? "selected" : ""}>${index + 1}</option>`).join("");
      this.$(".pagination", key).innerHTML = items.length ? `<button type="button" data-page-direction="-1" ${page === 1 ? "disabled" : ""}>上一页</button><label>第 <select data-page-select aria-label="跳转到推荐页">${options}</select> / ${pages} 页</label><button type="button" data-page-direction="1" ${page === pages ? "disabled" : ""}>下一页</button>` : "";
    }

    card(item) {
      const title = item.nameCn || item.name || String(item.id);
      const url = `${location.origin}/subject/${item.id}`;
      const image = /^https?:\/\//.test(item.image || "") ? item.image : "";
      return `<article class="rec-card">
  <a class="cover" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="查看《${escapeHtml(title)}》">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" width="140" height="196">` : ""}</a>
  <h3 class="rec-name"><a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></h3>
  <p class="rec-final"><b>${item.final.toFixed(2)}</b></p>
  <p class="rec-parts">全站评分 ${item.site.toFixed(2)} · 标签评分 ${item.tag == null ? "—" : item.tag.toFixed(2)}</p>
</article>`;
    }

    /* 手动刷新：只由「更新」按钮触发。收藏（含标签）→ 标签库 → 候选池
       → 评分 → 逐个复核「不同演绎」→ 取满限额。任何一步失败都保留上次
       结果，只留一行错误说明。 */
    async refresh(key) {
      if (this.state.busy[key]) return;
      const module = MODULES.find(entry => entry.key === key);
      const other = MODULES.find(entry => entry.key !== key);
      this.setError(key, "");
      this.setBusy(key, true);
      try {
        const ownRows = await fetchCollections(module.subjectType, (done, total) => this.setProgress(key, `正在核对${module.title}的收藏… ${done}/${total}`));
        store.set(`collections:${key}`, ownRows.filter(row => row.rate > 0));
        let otherRows = store.get(`collections:${other.key}`)?.value || [];
        if (!otherRows.length) {
          try {
            otherRows = (await fetchCollections(other.subjectType)).filter(row => row.rate > 0);
            store.set(`collections:${other.key}`, otherRows);
          } catch { /* 另一媒介的评分只影响关联排除的覆盖面，取不到就降级 */ }
        }
        const tagDb = Core.buildTagDb(ownRows);
        const ratedIds = new Set(ownRows.filter(row => row.rate > 0).map(row => row.id).concat(otherRows.map(row => row.id)));
        this.setProgress(key, "正在读取全站排行候选…");
        const candidates = await fetchRanked(module.subjectType, done => this.setProgress(key, `正在读取全站排行候选… ${done}`));
        const scored = Core.scoreCandidates(candidates, tagDb, ratedIds);
        if (!this.relations) {
          const cached = store.get("relations");
          this.relations = cached && cached.value && typeof cached.value === "object" ? cached.value : {};
        }
        const loadRelations = async id => {
          const hit = this.relations[id];
          if (hit && Date.now() - hit.at < RELATION_TTL) return hit.list;
          const page = await requestJson(`https://api.bgm.tv/v0/subjects/${id}/subjects`);
          const list = Array.isArray(page) ? page.map(entry => ({ id: Number(entry && entry.id), relation: String(entry && entry.relation || "") })) : [];
          this.relations[id] = { at: Date.now(), list };
          if (++this.pendingRelationSaves % 10 === 0) store.set("relations", this.relations);
          await delay(REQUEST_DELAY);
          return list;
        };
        const { selected } = await Core.selectTop(scored, module.limit, ratedIds, loadRelations);
        store.set("relations", this.relations);
        const result = { items: selected, generatedAt: Date.now() };
        store.set(`result:${key}`, result);
        this.state.results[key] = result;
        this.state.pages[key] = 1;
        this.renderModule(key);
      } catch (error) {
        this.setError(key, `更新失败：${error.message}（已保留上次结果）`);
      } finally {
        this.setBusy(key, false);
        this.renderModule(key);
      }
    }

    styles() {
      return `${globalThis.BangumiProfileUI.css}
    .rec-module + .rec-module{margin-top:28px}
    .rec-list{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:18px}
    .cover{display:block;aspect-ratio:140/196;background:var(--soft);border-radius:6px;overflow:hidden}
    .cover img{display:block;width:100%;height:100%;object-fit:cover}
    .rec-name{margin:8px 0 0;font-size:13px;line-height:1.5}
    .rec-final{margin:6px 0 0;font-size:15px;color:var(--pink)}
    .rec-final b{font-weight:600}
    .rec-parts{margin:3px 0 0;font-size:11px;color:var(--muted)}
    .pagination{display:flex;gap:15px;margin-top:24px;border-top:1px solid var(--line)}
    .error{margin:10px 0 0;color:var(--link);font-size:12px}
    @container(max-width:620px){.rec-list{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @container(max-width:400px){.rec-list{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  const app = new RecommenderApp();
  const start = () => { if (app.mount()) globalThis.BangumiPersonalRecommender = app; };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
