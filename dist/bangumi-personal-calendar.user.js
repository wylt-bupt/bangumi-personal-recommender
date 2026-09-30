// ==UserScript==
// @name         我的放送表
// @namespace    https://bgm.tv/user/wylt
// @version      1.0.2
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
  function intersect(calendar, collections, onlyWatching = false) {
    const byId = new Map(collections.map(row => [row.id, row.type]));
    return calendar.map(day => ({ weekday: day.weekday, items: day.items.filter(item => byId.has(item.id) && (!onlyWatching || byId.get(item.id) === 3)).map(item => ({ ...item, type: byId.get(item.id) })) }));
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
    :host{--ink:#333;--muted:#707070;--line:#e7e7e7;--surface:#fff;--soft:#f7f7f7;--accent:#ac3d58;--pink:#f09199;display:block;font:14px/1.6 Arial,"Microsoft YaHei",sans-serif;color:var(--ink);color-scheme:light}
    :host([data-theme=dark]){--ink:#ddd;--muted:#aaa;--line:#414141;--surface:#202020;--soft:#292929;--accent:#ef9caf;--pink:#ed8fa5;color-scheme:dark}
    *,*::before,*::after{box-sizing:border-box}[hidden]{display:none!important}button,select{font:inherit;color:inherit}button,a,select{touch-action:manipulation}a{color:inherit;text-decoration:none}a:hover{color:var(--accent)}button{cursor:pointer;background:transparent;border:0}button:disabled{cursor:default;opacity:.45}button:focus-visible,a:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
    .panel{padding:18px 14px 14px;background:var(--surface);border:1px solid var(--line);border-radius:3px;margin:0 0 20px;min-width:0}.toolbar{display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap}.toolbar h2{font-size:18px;font-weight:normal;line-height:1.4;margin:0 auto 0 0}.filters{display:flex;gap:4px}.filters button{min-height:44px;padding:6px 10px;border-bottom:2px solid transparent;color:var(--muted)}.filters button[aria-pressed=true]{color:var(--accent);border-color:var(--pink)}.refresh{min-height:44px;padding:6px 10px;color:var(--muted)}.refresh:hover{color:var(--accent)}.top-link{font-size:13px;color:var(--muted);padding:10px 0}
    .week-nav{display:flex;align-items:center;gap:4px;border-bottom:1px solid var(--line);margin-top:10px}.days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));flex:1;min-width:0}.days button{min-height:44px;padding:6px 0;color:var(--muted);font-size:13px}.days button[aria-pressed=true]{color:var(--ink);font-weight:normal}.days button.today{color:var(--accent);font-weight:bold}.arrow{min-width:44px;min-height:44px;font-size:24px;color:var(--muted)}.board{display:grid;grid-template-columns:repeat(var(--columns,3),minmax(0,1fr));gap:24px;margin-top:20px}.day{min-width:0}.day-head{margin-bottom:20px;padding:0 0 8px;border-bottom:3px solid var(--line)}.day.today .day-head{border-color:var(--pink)}.date{font-size:13px;color:var(--muted)}.day-head h3{margin:0;font-size:18px;font-weight:normal}.day.today h3{color:var(--accent);font-weight:bold}.relative{font-size:12px;color:var(--muted);margin-left:8px}.day-list{list-style:none;margin:0 0 0 3px;padding:0 0 0 14px;border-left:1px solid var(--line)}.entry{position:relative;margin-bottom:22px}.entry::before{content:'';position:absolute;left:-18px;top:8px;width:6px;height:6px;background:var(--line);border-radius:50%}.day.today .entry::before{background:var(--pink)}.subject{display:grid;grid-template-columns:72px minmax(0,1fr);gap:12px;align-items:start;min-height:100px}.cover{display:block;width:72px;height:100px;object-fit:contain;background:var(--soft);border-radius:3px}.no-cover{display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px}.title{display:block;font-size:14px;line-height:1.6;overflow-wrap:anywhere}.state{display:block;font-size:12px;color:var(--muted);margin-top:8px}.state.watching{color:var(--accent)}.empty{color:var(--muted);font-size:13px;padding:8px 0;min-height:100px}.foot{border-top:1px solid var(--line);padding-top:10px;margin-top:4px;display:flex;gap:4px 14px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--muted)}.foot button{color:var(--muted);min-height:36px;padding:4px 0;text-decoration:underline;text-underline-offset:3px}.note{margin:6px 0 0;color:var(--muted);font-size:12px}.message{margin:8px 0;font-size:13px;overflow-wrap:anywhere}.message:empty{display:none}.message.error{color:var(--accent)}.loading{color:var(--muted)}
    @media(max-width:480px){.panel{padding:12px 10px}.toolbar{gap:0 8px}.toolbar h2{width:100%;margin-bottom:4px}.top-link{margin-left:auto}.board{gap:16px}.subject{grid-template-columns:78px minmax(0,1fr)}.cover{width:78px;height:108px}.title{font-size:16px}.days button{font-size:12px}.arrow{min-width:36px}}
  `;
  shadow.innerHTML = `<style>${css}</style><section class="panel" aria-label="我的放送表"><div class="toolbar"><h2>我的放送表</h2><div class="filters" role="group" aria-label="收藏筛选"><button data-filter="all" aria-pressed="true">全部收藏</button><button data-filter="watching" aria-pressed="false">仅在看</button></div><button class="refresh">刷新</button><a class="top-link" href="/calendar${full ? '?personal=off' : ''}">${full ? '原始放送表' : '完整放送表'}</a></div><p class="message loading" role="status" aria-live="polite">正在核对我的收藏…</p><nav class="week-nav" aria-label="放送日期" hidden><button class="arrow prev" aria-label="前一天">‹</button><div class="days"></div><button class="arrow next" aria-label="后一天">›</button></nav><div class="board" hidden></div><div class="foot" hidden><span class="checked"></span><button class="complete">包含私密收藏</button><button class="restore">显示原始放送表</button></div><p class="note">按 Bangumi 每周放送表展示；具体播出时间及停播以官方公告为准。</p><button class="cancel" hidden>取消同步</button></section>`;
  const $ = selector => shadow.querySelector(selector);
  $('.complete').title = '通过站内登录态同步全部收藏；首次同步可能较慢，可以取消';
  $('.cancel').style.cssText = 'min-height:44px;padding:6px 10px';
  let calendar, collections, checkedAt = 0, source = 'public', watching = false, selectedDate = C.dateKey(), columns = 0, ready = false, originalView = false, busy = false, controller, storageBlocked = false, navChanged = false;
  const prefix = `bgm-personal-calendar:v1:${username}:`;
  function read(key) { try { return JSON.parse(localStorage.getItem(prefix + key)); } catch { return null; } }
  function save(key, value) { try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch { storageBlocked = true; } }
  function fresh(saved, ttl) { return saved && Number.isFinite(saved.at) && saved.at <= Date.now() && Date.now() - saved.at < ttl; }
  function restore(show) {
    originalView = show;
    originals.forEach(({ el, hidden, display }) => { el.hidden = show ? hidden : true; el.style.display = show ? display : 'none'; });
    $('.board').hidden = show || !ready; $('.week-nav').hidden = show || !ready;
    $('.restore').textContent = show ? '返回我的放送表' : '显示原始放送表';
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
    const dates = C.weekDates(selectedDate), visibleDates = C.dateWindow(selectedDate, columns), result = C.intersect(calendar, collections, watching);
    $('.board').style.setProperty('--columns', columns);
    const nav = document.createDocumentFragment(), board = document.createDocumentFragment();
    dates.forEach((day, index) => {
      const btn = element('button', day.relative === '今天' ? 'today' : '', C.weekdays[day.weekday]);
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
      if (!items.length) section.append(element('p', 'empty', watching ? '这天没有在看的番剧' : '这天没有收藏的番剧'));
      else {
        const list = element('ul', 'day-list');
        items.forEach(item => {
          const row = element('li', 'entry'), link = element('a', 'subject'); link.href = `/subject/${item.id}`;
          link.title = item.original && item.original !== item.title ? `${item.title}\n${item.original}` : item.title;
          if (item.image) {
            const img = element('img', 'cover'); img.src = item.image; img.alt = ''; img.width = 72; img.height = 100; img.loading = 'lazy'; img.decoding = 'async';
            img.addEventListener('error', () => img.replaceWith(element('span', 'cover no-cover', '暂无封面')), { once: true }); link.append(img);
          } else link.append(element('span', 'cover no-cover', '暂无封面'));
          const text = element('span'); text.append(element('span', 'title', item.title), element('span', `state${item.type === 3 ? ' watching' : ''}`, C.labels[item.type]));
          link.append(text); row.append(link); list.append(row);
        }); section.append(list);
      } board.append(section);
    });
    $('.days').replaceChildren(nav); $('.board').replaceChildren(board);
    if (focusedDay !== undefined) $(`[data-day="${focusedDay}"]`)?.focus();
    shadow.querySelectorAll('[data-filter]').forEach(btn => btn.setAttribute('aria-pressed', String((btn.dataset.filter === 'watching') === watching)));
    $('.checked').textContent = `${source === 'site' ? '含私密收藏' : '公开收藏'} · ${new Date(checkedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 核对${storageBlocked ? ' · 本地缓存不可用' : ''}`;
    $('.complete').textContent = source === 'site' ? '切换公开收藏' : '包含私密收藏';
    $('.foot').hidden = false; restore(originalView);
  }
  async function request(url, html = false) {
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 20000);
    const abort = () => timeout.abort(); controller.signal.addEventListener('abort', abort, { once: true });
    try {
      controller.signal.throwIfAborted();
      const response = await fetch(url, { signal: timeout.signal, credentials: html ? 'same-origin' : 'omit', headers: { Accept: html ? 'text/html' : 'application/json' } });
      if (!response.ok) throw new Error(response.status === 429 ? '请求过于频繁，请稍后刷新' : `请求失败 (${response.status})`);
      if (html) {
        if (new URL(response.url).pathname !== new URL(url, location.href).pathname) throw new Error('站内登录已失效或页面发生跳转');
        return new DOMParser().parseFromString(await response.text(), 'text/html');
      }
      return await response.json();
    } catch (error) {
      if (timeout.signal.aborted && !controller.signal.aborted) throw new Error('请求超时，请稍后刷新');
      throw error;
    } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); }
  }
  async function getCalendar(force) {
    const saved = read('calendar');
    if (!full && !force && fresh(saved, 3600000)) { try { return C.normalizeCalendar(saved.value); } catch {} }
    // On the calendar page the document itself is the canonical weekly list.
    let value;
    if (full && !demo) value = C.parseCalendarDocument(force ? await request('/calendar', true) : document);
    else {
      try { value = C.normalizeCalendar(await request('https://api.bgm.tv/calendar')); }
      catch (error) { if (controller.signal.aborted || demo) throw error; value = C.parseCalendarDocument(await request('/calendar', true)); }
    }
    save('calendar', { at: Date.now(), value }); return value;
  }
  async function siteCollections() {
    const all = [];
    for (let type = 1; type <= 5; type++) {
      let expected, page = 1, rows = [];
      for (;;) {
        status(`正在同步含私密的收藏… ${C.labels[type]} ${rows.length} 部`);
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
    const saved = read(`collections:${mode}`);
    if (!force && fresh(saved, 21600000)) { try { return { rows: C.normalizeCollections(saved.value), at: saved.at }; } catch {} }
    const rows = mode === 'site' ? await siteCollections() : await C.collectPublic(async offset => {
      if (offset) await pause();
      return request(`https://api.bgm.tv/v0/users/${username}/collections?subject_type=2&limit=100&offset=${offset}`);
    }, (count, total) => status(`正在核对我的收藏… ${count}/${total}`));
    return { rows, at: Date.now() };
  }
  function pause() {
    return new Promise((resolve, reject) => {
      const signal = controller.signal;
      signal.throwIfAborted();
      const stop = () => { clearTimeout(timer); reject(new DOMException('同步已取消', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, 180);
      signal.addEventListener('abort', stop, { once: true });
    });
  }
  async function sync(force = false, mode = source) {
    if (busy) return;
    busy = true; controller = new AbortController();
    $('.refresh').disabled = true; $('.complete').disabled = true; $('.cancel').hidden = false;
    status(mode === 'site' ? '正在同步含私密的收藏…' : '正在核对我的收藏…');
    try {
      const nextCalendar = await getCalendar(force), nextCollection = await getCollections(force, mode);
      controller.signal.throwIfAborted();
      if (!ready) originalView = false;
      calendar = nextCalendar; collections = nextCollection.rows; checkedAt = nextCollection.at; source = mode; ready = true;
      save(`collections:${mode}`, { at: checkedAt, value: collections }); save('mode', mode);
      status(''); render();
    } catch (error) {
      if (!ready) {
        try {
          const savedCalendar = read('calendar'), savedCollection = read(`collections:${mode}`);
          if (savedCalendar?.value && savedCollection?.value && Number.isFinite(savedCollection.at)) {
            calendar = C.normalizeCalendar(savedCalendar.value); collections = C.normalizeCollections(savedCollection.value); checkedAt = savedCollection.at; source = mode; ready = true; render();
          }
        } catch {}
      }
      if (!ready) { restore(true); $('.foot').hidden = false; $('.checked').textContent = ''; }
      status(controller.signal.aborted ? '同步已取消，保留已有放送表。' : `${error.message}。${ready ? '保留上次核对的收藏。' : '已保留原始放送表，可点击刷新重试。'}`, !controller.signal.aborted);
    } finally { busy = false; $('.refresh').disabled = false; $('.complete').disabled = false; $('.cancel').hidden = true; }
  }
  shadow.addEventListener('click', event => {
    const btn = event.target.closest('button'); if (!btn) return;
    if (btn.dataset.filter) { watching = btn.dataset.filter === 'watching'; render(); }
    else if (btn.dataset.day !== undefined) { navChanged = true; selectedDate = C.weekDates(selectedDate)[Number(btn.dataset.day)].date; render(); }
    else if (btn.classList.contains('prev')) { navChanged = true; selectedDate = C.shiftDate(selectedDate, -1); render(); }
    else if (btn.classList.contains('next')) { navChanged = true; selectedDate = C.shiftDate(selectedDate, 1); render(); }
    else if (btn.classList.contains('refresh')) sync(true);
    else if (btn.classList.contains('complete')) sync(true, source === 'site' ? 'public' : 'site');
    else if (btn.classList.contains('cancel')) controller?.abort();
    else if (btn.classList.contains('restore')) restore(!originalView);
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
  document.addEventListener('visibilitychange', () => {
    const today = C.dateKey();
    if (!document.hidden && dayKey !== today) {
      dayKey = today;
      if (!navChanged) selectedDate = today;
      render();
    }
  });
  source = read('mode') === 'site' ? 'site' : 'public';
  sync();
})();
