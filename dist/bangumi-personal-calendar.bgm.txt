// ==UserScript==
// @name         我的放送表
// @namespace    https://bgm.tv/user/wylt
// @version      1.0.7
// @description  仅显示我的收藏；按日纵向排列，清晰封面、中文标题，支持站内私密收藏同步。
// @author       wylt
// @match        https://bgm.tv/
// @match        https://bgm.tv/calendar*
// @match        https://bangumi.tv/
// @match        https://bangumi.tv/calendar*
// @match        https://chii.in/
// @match        https://chii.in/calendar*
// @grant        none
// ==/UserScript==
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BangumiCalendarCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const labels = ['', '想看', '看过', '在看', '搁置', '抛弃'];
  const weekdays = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const routes = ['', 'wish', 'collect', 'do', 'on_hold', 'dropped'];
  const validId = n => Number.isSafeInteger(Number(n)) && Number(n) > 0;
  function imageURL(value) {
    try {
      const url = new URL(String(value || '').replace(/^\/\//, 'https://'));
      if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'lain.bgm.tv' || url.username || url.password) return '';
      url.protocol = 'https:';
      return url.href;
    } catch { return ''; }
  }
  function normalizeCalendar(data) {
    if (!Array.isArray(data) || data.length !== 7) throw new Error('放送表没有包含完整的一周');
    const days = new Map();
    for (const day of data) {
      const weekday = Number(day.weekday?.id ?? day.weekday);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || days.has(weekday) || !Array.isArray(day.items)) throw new Error('放送表星期数据无效');
      const seen = new Set();
      const items = day.items.map(item => {
        const id = Number(item.id);
        if (!validId(id)) throw new Error('放送条目 ID 无效');
        const original = String(item.name ?? item.original ?? '').trim();
        const title = String(item.name_cn ?? item.title ?? '').trim() || original || `条目 ${id}`;
        const images = item.images || {};
        return { id, title, original, image: imageURL(item.image || images.common || images.medium || images.large) };
      }).filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
      days.set(weekday, { weekday, items });
    }
    return [...days.values()].sort((a, b) => a.weekday - b.weekday);
  }
  function normalizeCollections(rows) {
    if (!Array.isArray(rows)) throw new Error('收藏列表无效');
    const result = new Map();
    for (const row of rows) {
      const id = Number(row.subject_id ?? row.id), type = Number(row.type);
      if (!validId(id) || !Number.isInteger(type) || type < 1 || type > 5) throw new Error('收藏条目或状态无效');
      if (result.has(id)) throw new Error('收藏分页存在重复条目，请重新同步');
      // Only membership and status are retained; ratings, tags and comments are never cached.
      result.set(id, { id, type });
    }
    return [...result.values()];
  }
  function intersect(calendar, collections) {
    const byId = new Map(collections.map(row => [row.id, row.type]));
    return calendar.map(day => ({ weekday: day.weekday, items: day.items.filter(item => byId.has(item.id) && byId.get(item.id) !== 2).map(item => ({ ...item, type: byId.get(item.id) })) }));
  }
  function dateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(`${value}T12:00:00`);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function shiftDate(value, offset) {
    if (!Number.isInteger(offset)) throw new Error('日期偏移必须是整数');
    const date = new Date(`${dateKey(value)}T12:00:00`);
    date.setDate(date.getDate() + offset);
    return dateKey(date);
  }
  function dateEntry(value, today) {
    const date = new Date(`${dateKey(value)}T12:00:00`), diff = Math.round((date - new Date(`${dateKey(today)}T12:00:00`)) / 86400000);
    return { weekday: date.getDay() || 7, date: dateKey(date), label: `${date.getMonth() + 1}/${date.getDate()}`, relative: diff === -1 ? '昨天' : diff === 0 ? '今天' : diff === 1 ? '明天' : '' };
  }
  function weekDates(anchor = new Date(), today = new Date()) {
    const date = new Date(`${dateKey(anchor)}T12:00:00`), mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);
    return Array.from({ length: 7 }, (_, index) => dateEntry(shiftDate(date, index), today));
  }
  function dateWindow(anchor = new Date(), count = 3, today = new Date()) {
    if (!Number.isInteger(count) || count < 1 || count > 7) throw new Error('显示日期列数无效');
    const first = Math.floor((count - 1) / 2);
    return Array.from({ length: count }, (_, index) => dateEntry(shiftDate(anchor, index - first), today));
  }
  async function collectPublic(loadPage, progress = () => {}) {
    let offset = 0, total;
    const rows = [];
    do {
      const page = await loadPage(offset);
      if (!Number.isSafeInteger(page.total) || page.total < 0 || !Array.isArray(page.data) || Number(page.offset) !== offset) throw new Error('收藏分页信息无效');
      if (total !== undefined && total !== page.total) throw new Error('收藏数量在同步中发生变化，请重新同步');
      total = page.total;
      if (!page.data.length && offset < total) throw new Error('收藏分页不完整，请重新同步');
      rows.push(...normalizeCollections(page.data));
      offset += page.data.length;
      if (offset > total) throw new Error('收藏数量与分页不一致');
      progress(offset, total);
    } while (offset < total);
    return normalizeCollections(rows);
  }
  function parseCalendarDocument(doc) {
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const root = doc.querySelector('.BgmCalendar');
    if (!root) throw new Error('无法读取站内放送表');
    return normalizeCalendar(names.map((name, index) => {
      const list = root.querySelector(`dd.${name} .coverList`);
      if (!list) throw new Error('站内放送表不完整');
      return { weekday: index + 1, items: Array.from(list.children).map(li => {
        const links = li.querySelectorAll('a[href^="/subject/"]');
        const id = links[0]?.getAttribute('href')?.match(/^\/subject\/(\d+)\/?$/)?.[1];
        const cover = li.getAttribute('style')?.match(/url\(['"]?([^'"\)]+)['"]?\)/)?.[1];
        return { id, name_cn: links[0]?.textContent, name: links[1]?.textContent, image: cover };
      }) };
    }));
  }
  function parseCollectionDocument(doc, username, type, pageNumber) {
    const list = doc.querySelector('#browserItemList');
    const path = `/anime/list/${encodeURIComponent(username)}/${routes[type]}`;
    const counts = Array.from(doc.querySelectorAll('a[href]')).filter(a => a.getAttribute('href')?.startsWith(`/anime/list/${encodeURIComponent(username)}/`) && /[（(]\d+[）)]/.test(a.textContent));
    const login = doc.querySelector('#navMenuNeue a[href^="/anime/list/"]')?.getAttribute('href');
    const owner = Array.from(doc.querySelectorAll('h1 a[href]')).some(a => a.getAttribute('href') === `/user/${encodeURIComponent(username)}`);
    if (!list || !owner || !login?.startsWith(`/anime/list/${encodeURIComponent(username)}/`)) throw new Error('站内收藏页无效或登录已失效');
    const current = counts.find(a => a.getAttribute('href') === path);
    const total = current ? Number(current.textContent.match(/[（(](\d+)[）)]/)[1]) : 0;
    const rows = normalizeCollections(Array.from(list.children).map(li => ({ id: li.id.match(/^item_(\d+)$/)?.[1], type })));
    if (rows.length > total || (!rows.length && total > 0)) throw new Error('站内收藏分页不完整');
    const next = Array.from(doc.querySelectorAll('.page_inner a[href]')).some(a => {
      const url = new URL(a.getAttribute('href'), 'https://bgm.tv');
      return url.pathname === path && Number(url.searchParams.get('page')) === pageNumber + 1;
    });
    return { rows, total, next };
  }
  return { labels, weekdays, routes, imageURL, normalizeCalendar, normalizeCollections, intersect, dateKey, shiftDate, weekDates, dateWindow, collectPublic, parseCalendarDocument, parseCollectionDocument };
});


(function () {
  'use strict';
  const C = globalThis.BangumiCalendarCore, ID = 'bgm-personal-calendar';
  const demo = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && document.body?.dataset.calendarDemo === 'true';
  if (!C || (!demo && !/^(bgm\.tv|bangumi\.tv|chii\.in)$/.test(location.hostname))) return;
  const full = demo ? document.body.dataset.calendarLayout === 'full' : /^\/calendar\/?$/.test(location.pathname);
  if (!demo && location.pathname !== '/' && !full) return;
  if (full && new URLSearchParams(location.search).get('personal') === 'off') return;
  if (document.getElementById(ID)) return;
  const ownerLink = document.querySelector('#navMenuNeue a[href^="/anime/list/"]');
  const username = demo ? 'calendar-demo' : ownerLink?.getAttribute('href')?.match(/^\/anime\/list\/([^/]+)\//)?.[1];
  if (!username) return; // Signed-out visitors retain the public calendar.
  const container = demo ? document.querySelector('#home_calendar') : full ? document.querySelector('.BgmCalendar')?.closest('.columns') : document.querySelector('#home_calendar');
  if (!container) return;
  const originals = Array.from(container.children).map(el => ({ el, hidden: el.hidden, display: el.style.display }));
  const host = document.createElement('div'); host.id = ID; container.prepend(host);
  host.style.cssText = 'display:block;width:100%;min-width:0;clear:both';
  const shadow = host.attachShadow({ mode: 'open' });
  const css = `
    :host{--ink:#333;--muted:#707070;--line:#e7e7e7;--surface:#fff;--soft:#f7f7f7;--accent:#ac3d58;--pink:#f09199;--pink-soft:#fff1f3;display:block;font:14px/1.6 Arial,"Microsoft YaHei",sans-serif;color:var(--ink);color-scheme:light}
    :host([data-theme=dark]){--ink:#ddd;--muted:#aaa;--line:#414141;--surface:#202020;--soft:#292929;--accent:#ef9caf;--pink:#ed8fa5;--pink-soft:#39282d;color-scheme:dark}
    *,*::before,*::after{box-sizing:border-box}[hidden]{display:none!important}button,select{font:inherit;color:inherit}button,a,select{touch-action:manipulation}a{color:inherit;text-decoration:none}a:hover{color:var(--accent)}button{cursor:pointer;background:transparent;border:0}button:disabled{cursor:default;opacity:.4}button:focus-visible,a:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
    .panel{padding:18px 14px 14px;background:var(--surface);border:1px solid var(--line);border-radius:15px;margin:0 0 20px;min-width:0}.toolbar{display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap}.heading{display:flex;align-items:center;gap:12px;margin-right:auto;flex-wrap:wrap}.toolbar h2{font-size:18px;font-weight:normal;line-height:1.4;margin:0}.today-jump{min-height:44px;padding:6px 10px;font-size:12px;color:var(--muted);border-radius:50px}.today-jump:hover{background:var(--soft);color:var(--accent)}.refresh{min-height:36px;min-width:44px;padding:6px 10px;font-size:12px;color:var(--muted);border-radius:6px;transition:background .18s,color .18s}.refresh:hover:not(:disabled){color:var(--accent);background:var(--pink-soft)}
    .week-nav{display:flex;align-items:center;gap:4px;border-bottom:1px solid var(--line);margin-top:10px}.days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));flex:1;min-width:0}.days button{position:relative;min-height:44px;padding:6px 0;color:var(--muted);font-size:13px}.days button[aria-pressed=true]{color:var(--accent);font-weight:bold}.days button[aria-pressed=true]::before{content:'';position:absolute;top:0;left:12%;right:12%;height:3px;background:var(--pink)}.arrow{min-width:44px;min-height:44px;font-size:24px;color:var(--muted)}.board{display:grid;grid-template-columns:repeat(var(--columns,3),minmax(0,1fr));gap:24px;margin-top:20px}.day{min-width:0}.day-head{margin-bottom:20px;padding:0 0 8px;border-bottom:3px solid var(--line)}.day.today .day-head{border-color:var(--pink)}.date{font-size:13px;color:var(--muted)}.day-head h3{margin:0;font-size:18px;font-weight:normal}.day.today h3{color:var(--accent);font-weight:bold}.relative{font-size:12px;color:var(--muted);margin-left:8px}.day-list{list-style:none;margin:0 0 0 3px;padding:0 0 0 14px;border-left:1px solid var(--line)}.entry{position:relative;margin-bottom:22px}.entry::before{content:'';position:absolute;left:-18px;top:8px;width:6px;height:6px;background:var(--line);border-radius:50%}.day.today .entry::before{background:var(--pink)}.subject{display:grid;grid-template-columns:72px minmax(0,1fr);gap:12px;align-items:start;min-height:100px}.cover{display:block;width:72px;height:100px;object-fit:contain;background:var(--soft);border-radius:3px}.no-cover{display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px}.title{display:block;font-size:14px;line-height:1.6;overflow-wrap:anywhere}.empty{color:var(--muted);font-size:13px;padding:8px 0;min-height:100px}.message{margin:8px 0;font-size:13px;overflow-wrap:anywhere}.message:empty{display:none}.message.error{color:var(--accent)}
    @media(max-width:480px){.panel{padding:12px 10px}.toolbar{gap:0 8px}.heading{flex:1;min-width:0;gap:8px}.refresh{min-height:44px}.board{gap:16px}.subject{grid-template-columns:78px minmax(0,1fr)}.cover{width:78px;height:108px}.title{font-size:16px}.days button{font-size:12px}.arrow{min-width:36px}}
  `;
  shadow.innerHTML = `<style>${css}</style><section class="panel" aria-label="我的放送表"><div class="toolbar"><div class="heading"><h2>我的放送表</h2><nav class="today-nav" aria-label="今天定位" hidden><button class="today-jump"></button></nav></div><button class="refresh update-button" type="button" title="核对个人收藏与最新放送表" aria-live="polite">更新</button></div><p class="message" role="status" aria-live="polite"></p><nav class="week-nav" aria-label="放送日期" hidden><button class="arrow prev" aria-label="前一天">‹</button><div class="days"></div><button class="arrow next" aria-label="后一天">›</button></nav><div class="board" hidden></div></section>`;
  const $ = selector => shadow.querySelector(selector);
  let calendar, collections, source = 'public', selectedDate = C.dateKey(), columns = 0, ready = false, busy = false, navChanged = false, revision = 0;
  const prefix = `bgm-personal-calendar:v1:${username}:`;
  function read(key) { try { return JSON.parse(localStorage.getItem(prefix + key)); } catch { return null; } }
  function save(key, value) { try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch {} }
  function fresh(saved, ttl) { return saved && Number.isFinite(saved.at) && saved.at <= Date.now() && Date.now() - saved.at < ttl; }
  function cachedCollections(mode) {
    const saved = read(`collections:${mode}`);
    if (!saved || !Number.isFinite(saved.at)) return null;
    try { return { rows: C.normalizeCollections(saved.value), at: saved.at }; } catch { return null; }
  }
  function restore(show) {
    originals.forEach(({ el, hidden, display }) => { el.hidden = show ? hidden : true; el.style.display = show ? display : 'none'; });
    $('.board').hidden = show || !ready; $('.week-nav').hidden = show || !ready; $('.today-nav').hidden = show || !ready;
  }
  function theme() {
    const value = document.documentElement.getAttribute('data-theme');
    host.dataset.theme = value === 'dark' || (value !== 'light' && matchMedia('(prefers-color-scheme:dark)').matches) ? 'dark' : 'light';
  }
  function status(text, error = false) { $('.message').textContent = text; $('.message').className = `message${error ? ' error' : ''}`; }
  function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
  function render() {
    if (!ready) return;
    const focusedDay = shadow.activeElement?.dataset.day;
    const todayDate = C.dateKey(), dates = C.weekDates(selectedDate, todayDate), visibleDates = C.dateWindow(selectedDate, columns, todayDate), result = C.intersect(calendar, collections);
    const today = C.weekDates(todayDate, todayDate).find(day => day.relative === '今天');
    $('.today-jump').textContent = `今天 · ${C.weekdays[today.weekday]}`;
    $('.today-jump').setAttribute('aria-label', `回到今天，${today.date} ${C.weekdays[today.weekday]}`);
    $('.today-nav').hidden = false;
    $('.board').style.setProperty('--columns', columns);
    const nav = document.createDocumentFragment(), board = document.createDocumentFragment();
    dates.forEach((day, index) => {
      const btn = element('button', '', C.weekdays[day.weekday]);
      btn.dataset.day = index; btn.dataset.date = day.date; btn.setAttribute('aria-pressed', String(day.date === selectedDate));
      if (day.relative === '今天') btn.setAttribute('aria-current', 'date');
      btn.setAttribute('aria-label', `${day.date} ${C.weekdays[day.weekday]}${day.relative ? ` ${day.relative}` : ''}`); nav.append(btn);
    });
    visibleDates.forEach(day => {
      const section = element('section', `day${day.relative === '今天' ? ' today' : ''}`);
      section.dataset.weekday = day.weekday; section.dataset.date = day.date;
      const head = element('div', 'day-head'), time = element('time', 'date', day.label); time.dateTime = day.date;
      const heading = element('h3', '', C.weekdays[day.weekday]);
      if (day.relative) heading.append(element('span', 'relative', day.relative));
      head.append(time, heading); section.append(head);
      const items = result.find(row => row.weekday === day.weekday).items;
      if (!items.length) section.append(element('p', 'empty', '暂无条目'));
      else {
        const list = element('ul', 'day-list');
        items.forEach(item => {
          const row = element('li', 'entry'), link = element('a', 'subject'); link.href = `/subject/${item.id}`;
          link.title = item.original && item.original !== item.title ? `${item.title}\n${item.original}` : item.title;
          if (item.image) {
            const img = element('img', 'cover'); img.src = item.image; img.alt = ''; img.width = 72; img.height = 100; img.loading = 'lazy'; img.decoding = 'async';
            img.addEventListener('error', () => img.replaceWith(element('span', 'cover no-cover', '暂无封面')), { once: true }); link.append(img);
          } else link.append(element('span', 'cover no-cover', '暂无封面'));
          const text = element('span'); text.append(element('span', 'title', item.title));
          link.append(text); row.append(link); list.append(row);
        }); section.append(list);
      } board.append(section);
    });
    $('.days').replaceChildren(nav); $('.board').replaceChildren(board);
    if (focusedDay !== undefined) $(`[data-day="${focusedDay}"]`)?.focus();
    $('.week-nav').hidden = false; $('.board').hidden = false;
  }
  async function request(url, html = false) {
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 20000);
    try {
      const response = await fetch(url, { signal: timeout.signal, credentials: html ? 'same-origin' : 'omit', headers: { Accept: html ? 'text/html' : 'application/json' } });
      if (!response.ok) throw new Error(response.status === 429 ? '请求过于频繁，请稍后刷新' : `请求失败 (${response.status})`);
      if (html) {
        if (new URL(response.url).pathname !== new URL(url, location.href).pathname) throw new Error('站内登录已失效或页面发生跳转');
        return new DOMParser().parseFromString(await response.text(), 'text/html');
      }
      return await response.json();
    } catch (error) {
      if (timeout.signal.aborted) throw new Error('请求超时，请稍后刷新');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function getCalendar(force) {
    const saved = read('calendar');
    if (!full && !force && fresh(saved, 3600000)) { try { return { rows: C.normalizeCalendar(saved.value), at: saved.at }; } catch {} }
    // On the calendar page the document itself is the canonical weekly list.
    let value;
    if (full && !demo) value = C.parseCalendarDocument(force ? await request('/calendar', true) : document);
    else {
      try { value = C.normalizeCalendar(await request('https://api.bgm.tv/calendar')); }
      catch (error) { if (demo) throw error; value = C.parseCalendarDocument(await request('/calendar', true)); }
    }
    return { rows: value, at: Date.now() };
  }
  async function siteCollections() {
    const all = [];
    for (let type = 1; type <= 5; type++) {
      let expected, page = 1, rows = [];
      for (;;) {
        const url = `/anime/list/${username}/${C.routes[type]}?page=${page}`;
        const result = C.parseCollectionDocument(await request(url, true), decodeURIComponent(username), type, page);
        if (expected !== undefined && expected !== result.total) throw new Error('收藏数量在同步中发生变化，请重新同步');
        expected = result.total; rows.push(...result.rows);
        C.normalizeCollections(rows);
        if (!result.next) { if (rows.length !== expected) throw new Error('站内收藏分页不完整，请重新同步'); break; }
        if (rows.length >= expected || page >= 1000) throw new Error('站内收藏分页异常');
        page++;
        await pause();
      }
      all.push(...rows);
      if (type < 5) await pause();
    }
    return C.normalizeCollections(all);
  }
  async function getCollections(force, mode) {
    const saved = cachedCollections(mode);
    if (!force && saved) return saved;
    const rows = mode === 'site' ? await siteCollections() : await C.collectPublic(async offset => {
      if (offset) await pause();
      return request(`https://api.bgm.tv/v0/users/${username}/collections?subject_type=2&limit=100&offset=${offset}`);
    });
    return { rows, at: Date.now() };
  }
  function pause() {
    return new Promise(resolve => setTimeout(resolve, 180));
  }
  function showCalendar(next) {
    calendar = next.rows; ready = true;
    save('calendar', { at: next.at, value: calendar });
    restore(false); render();
  }
  async function initialize() {
    const savedCollection = cachedCollections(source);
    if (!savedCollection) { sync(); return; } // First use or damaged storage requires one complete sync.
    collections = savedCollection.rows;
    const savedCalendar = read('calendar');
    let next, fromDocument = false;
    if (full && !demo) {
      try { next = { rows: C.parseCalendarDocument(document), at: Date.now() }; fromDocument = true; } catch {}
    }
    if (!next && savedCalendar && Number.isFinite(savedCalendar.at)) {
      try { next = { rows: C.normalizeCalendar(savedCalendar.value), at: savedCalendar.at }; } catch {}
    }
    // Paint saved results before starting any network request, even when the schedule is old.
    if (next) showCalendar(next);
    if (fromDocument || (!full && fresh(next, 3600000))) return;
    const current = revision;
    try {
      next = await getCalendar(false);
      if (current !== revision) return; // A manual refresh owns all later UI and cache writes.
      showCalendar(next); status('');
    } catch (error) {
      if (current !== revision) return;
      if (!ready) restore(true);
      status(ready ? `放送表更新失败，保留上次放送：${error.message}` : `放送表读取失败，显示原始放送表：${error.message}`, true);
    }
  }
  async function sync(force = false, mode = source) {
    if (busy) return;
    revision++;
    busy = true; $('.refresh').disabled = true; $('.refresh').textContent = '更新中…'; $('.panel').setAttribute('aria-busy', 'true');
    try {
      const nextCalendar = await getCalendar(force), nextCollection = await getCollections(force, mode);
      collections = nextCollection.rows; source = mode;
      save(`collections:${mode}`, { at: nextCollection.at, value: collections }); save('mode', mode);
      status(''); showCalendar(nextCalendar);
    } catch (error) {
      if (!ready) restore(true);
      status(ready ? `核对失败，保留上次收藏：${error.message}` : `核对失败，显示原始放送表：${error.message}`, true);
    } finally { busy = false; $('.refresh').disabled = false; $('.refresh').textContent = '更新'; $('.panel').setAttribute('aria-busy', 'false'); }
  }
  shadow.addEventListener('click', event => {
    const btn = event.target.closest('button'); if (!btn) return;
    if (btn.dataset.day !== undefined) { navChanged = true; selectedDate = C.weekDates(selectedDate)[Number(btn.dataset.day)].date; render(); }
    else if (btn.classList.contains('prev')) { navChanged = true; selectedDate = C.shiftDate(selectedDate, -1); render(); }
    else if (btn.classList.contains('next')) { navChanged = true; selectedDate = C.shiftDate(selectedDate, 1); render(); }
    else if (btn.classList.contains('today-jump')) { navChanged = false; selectedDate = C.dateKey(); render(); }
    else if (btn.classList.contains('refresh')) sync(true);
  });
  const media = matchMedia('(prefers-color-scheme:dark)'); media.addEventListener('change', theme);
  new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); theme();
  function resize(width) {
    const next = Math.min(full ? 4 : 3, Math.max(1, Math.floor((width - 28) / 250)));
    if (next !== columns) { columns = next; render(); }
  }
  if ('ResizeObserver' in globalThis) new ResizeObserver(entries => resize(entries[0].contentRect.width)).observe(host);
  resize(host.getBoundingClientRect().width);
  let dayKey = C.dateKey();
  function updateDay() {
    const today = C.dateKey();
    if (dayKey !== today) {
      dayKey = today;
      if (!navChanged) selectedDate = today;
      render();
    }
  }
  function watchMidnight() {
    const now = new Date(), next = new Date(now); next.setHours(24, 0, 0, 50);
    setTimeout(() => { updateDay(); watchMidnight(); }, next - now);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateDay(); });
  watchMidnight();
  source = read('mode') === 'site' ? 'site' : 'public';
  initialize();
})();
