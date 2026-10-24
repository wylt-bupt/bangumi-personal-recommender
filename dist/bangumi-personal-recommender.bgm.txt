// ==UserScript==
// @name         Bangumi 个性推荐
// @namespace    https://bgm.tv/user/wylt
// @version      1.0.0
// @description  个人主页的动画与书籍推荐：按标签均分与全站评分折算排序，仅手动更新。
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


(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BangumiRecommenderCore = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  /* ── 标签分数库 ──
     数据来自我评过分的条目（rate > 0，不限收藏状态——想看/看过/抛弃都算，
     只要打了分）身上的全站用户标注标签（subject.tags，不是我自己的标注）。
     我对该作品的 10 分制评分就是每个标签在该作品下获得的分数；
     标签分数 = 这些得分的均分（1-10）。 */
  function buildTagDb(ratedRows) {
    const acc = new Map();
    for (const row of ratedRows || []) {
      const rate = Number(row && row.rate);
      const tags = row && row.subject && Array.isArray(row.subject.tags) ? row.subject.tags : [];
      if (!(rate > 0)) continue;
      for (const tag of tags) {
        if (!tag || typeof tag.name !== 'string' || !tag.name) continue;
        const entry = acc.get(tag.name) || { sum: 0, n: 0 };
        entry.sum += rate;
        entry.n += 1;
        acc.set(tag.name, entry);
      }
    }
    const db = new Map();
    for (const [name, entry] of acc) db.set(name, entry.sum / entry.n);
    return db;
  }

  /* 未评分作品的标签分：它身上所有用户标签的标签分数均分 ÷ 2（1-5）。
     一个已知标签都没有时返回 null，届时推荐评分只由全站分构成。 */
  function tagScore(tags, tagDb) {
    const known = [];
    for (const tag of tags || []) {
      if (!tag || typeof tag.name !== 'string' || !tag.name) continue;
      const score = tagDb ? tagDb.get(tag.name) : undefined;
      if (Number.isFinite(score)) known.push(score);
    }
    if (!known.length) return null;
    return known.reduce((sum, value) => sum + value, 0) / known.length / 2;
  }

  /* ── 候选池评分 ──
     rows 是排行榜接口的条目列表项（自带 platform / tags / rating）。
     排除：我已打分的条目（ratedIds；仅收藏未评分的照常参与）、全站评分
     人数不足 500 的、platform 为 OVA 的。单项分数 1-5：全站分 ÷ 2；
     标签分 = 标签均分 ÷ 2；推荐评分 = 两项平均，保留 2 位小数。
     排序：推荐评分降序，同分按全站评分人数多者优先。 */
  const MIN_RATINGS = 500;
  function scoreCandidates(rows, tagDb, ratedIds, minRatings = MIN_RATINGS) {
    const floor = Number.isFinite(minRatings) ? minRatings : MIN_RATINGS;
    const scored = [];
    for (const subject of rows || []) {
      const id = Number(subject && subject.id);
      const rating = (subject && subject.rating) || {};
      const total = Number(rating.total) || 0;
      if (!Number.isSafeInteger(id) || id <= 0 || (ratedIds && ratedIds.has(id))) continue;
      if (total < floor) continue;
      if (subject.platform === 'OVA') continue;
      const site = (Number(rating.score) || 0) / 2;
      const tag = tagScore(subject.tags, tagDb);
      scored.push({
        id,
        name: (subject.name || '').trim(),
        nameCn: (subject.name_cn || '').trim(),
        image: (subject.images && (subject.images.common || subject.images.medium || subject.images.large)) || '',
        platform: subject.platform || '',
        site,
        tag,
        total,
        final: Number(((tag == null ? site : (site + tag) / 2)).toFixed(2)),
      });
    }
    scored.sort((a, b) => b.final - a.final || b.total - a.total || a.id - b.id);
    return scored;
  }

  /* ── 资格复核与选优 ──
     候选自身关联条目（relationsOf 注入带缓存的采集）中出现我已评分的作品
     且关系标注为「不同演绎」时排除；按得分从高到低取满 limit 部为止。 */
  const EXCLUDED_RELATION = '不同演绎';
  async function selectTop(scored, limit, ratedIds, relationsOf) {
    const selected = [];
    const excluded = [];
    for (const candidate of scored || []) {
      if (selected.length >= limit) break;
      const relations = (await relationsOf(candidate.id)) || [];
      const isRemake = relations.some(entry => entry && entry.relation === EXCLUDED_RELATION && ratedIds.has(Number(entry.id)));
      if (isRemake) {
        excluded.push(candidate.id);
        continue;
      }
      selected.push(candidate);
    }
    return { selected, excluded };
  }

  return { MIN_RATINGS, EXCLUDED_RELATION, buildTagDb, tagScore, scoreCandidates, selectTop };
});


(function bootstrapBangumiRecommender() {
  "use strict";
  const Core = globalThis.BangumiRecommenderCore;
  if (!Core || document.getElementById("bgmpr-host")) return;
  const APP_VERSION = "1.0.0";

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
        rows.push({
          id,
          rate: Number(row.rate) || 0,
          tags: Array.isArray(subject.tags) ? subject.tags.filter(tag => tag && typeof tag.name === "string").map(tag => tag.name) : [],
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

