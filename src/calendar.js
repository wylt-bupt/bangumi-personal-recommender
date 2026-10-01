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
    .panel{padding:18px 14px 14px;background:var(--surface);border:1px solid var(--line);border-radius:3px;margin:0 0 20px;min-width:0}.toolbar{display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap}.toolbar h2{font-size:18px;font-weight:normal;line-height:1.4;margin:0 auto 0 0}.refresh{min-height:44px;padding:6px 10px;color:var(--muted)}.refresh:hover{color:var(--accent)}
    .week-nav{display:flex;align-items:center;gap:4px;border-bottom:1px solid var(--line);margin-top:10px}.days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));flex:1;min-width:0}.days button{min-height:44px;padding:6px 0;color:var(--muted);font-size:13px}.days button[aria-pressed=true]{color:var(--ink);font-weight:normal}.days button.today{color:var(--accent);font-weight:bold}.arrow{min-width:44px;min-height:44px;font-size:24px;color:var(--muted)}.board{display:grid;grid-template-columns:repeat(var(--columns,3),minmax(0,1fr));gap:24px;margin-top:20px}.day{min-width:0}.day-head{margin-bottom:20px;padding:0 0 8px;border-bottom:3px solid var(--line)}.day.today .day-head{border-color:var(--pink)}.date{font-size:13px;color:var(--muted)}.day-head h3{margin:0;font-size:18px;font-weight:normal}.day.today h3{color:var(--accent);font-weight:bold}.relative{font-size:12px;color:var(--muted);margin-left:8px}.day-list{list-style:none;margin:0 0 0 3px;padding:0 0 0 14px;border-left:1px solid var(--line)}.entry{position:relative;margin-bottom:22px}.entry::before{content:'';position:absolute;left:-18px;top:8px;width:6px;height:6px;background:var(--line);border-radius:50%}.day.today .entry::before{background:var(--pink)}.subject{display:grid;grid-template-columns:72px minmax(0,1fr);gap:12px;align-items:start;min-height:100px}.cover{display:block;width:72px;height:100px;object-fit:contain;background:var(--soft);border-radius:3px}.no-cover{display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px}.title{display:block;font-size:14px;line-height:1.6;overflow-wrap:anywhere}.empty{color:var(--muted);font-size:13px;padding:8px 0;min-height:100px}.message{margin:8px 0;font-size:13px;overflow-wrap:anywhere}.message:empty{display:none}.message.error{color:var(--accent)}
    @media(max-width:480px){.panel{padding:12px 10px}.toolbar{gap:0 8px}.toolbar h2{width:100%;margin-bottom:4px}.board{gap:16px}.subject{grid-template-columns:78px minmax(0,1fr)}.cover{width:78px;height:108px}.title{font-size:16px}.days button{font-size:12px}.arrow{min-width:36px}}
  `;
  shadow.innerHTML = `<style>${css}</style><section class="panel" aria-label="我的放送表"><div class="toolbar"><h2>我的放送表</h2><button class="refresh" aria-live="polite">刷新核对个人收藏</button></div><p class="message" role="status" aria-live="polite"></p><nav class="week-nav" aria-label="放送日期" hidden><button class="arrow prev" aria-label="前一天">‹</button><div class="days"></div><button class="arrow next" aria-label="后一天">›</button></nav><div class="board" hidden></div></section>`;
  const $ = selector => shadow.querySelector(selector);
  let calendar, collections, source = 'public', selectedDate = C.dateKey(), columns = 0, ready = false, busy = false, navChanged = false;
  const prefix = `bgm-personal-calendar:v1:${username}:`;
  function read(key) { try { return JSON.parse(localStorage.getItem(prefix + key)); } catch { return null; } }
  function save(key, value) { try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch {} }
  function fresh(saved, ttl) { return saved && Number.isFinite(saved.at) && saved.at <= Date.now() && Date.now() - saved.at < ttl; }
  function restore(show) {
    originals.forEach(({ el, hidden, display }) => { el.hidden = show ? hidden : true; el.style.display = show ? display : 'none'; });
    $('.board').hidden = show || !ready; $('.week-nav').hidden = show || !ready;
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
    const dates = C.weekDates(selectedDate), visibleDates = C.dateWindow(selectedDate, columns), result = C.intersect(calendar, collections);
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
      if (!items.length) section.append(element('p', 'empty', '无收藏'));
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
    if (!full && !force && fresh(saved, 3600000)) { try { return C.normalizeCalendar(saved.value); } catch {} }
    // On the calendar page the document itself is the canonical weekly list.
    let value;
    if (full && !demo) value = C.parseCalendarDocument(force ? await request('/calendar', true) : document);
    else {
      try { value = C.normalizeCalendar(await request('https://api.bgm.tv/calendar')); }
      catch (error) { if (demo) throw error; value = C.parseCalendarDocument(await request('/calendar', true)); }
    }
    save('calendar', { at: Date.now(), value }); return value;
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
    const saved = read(`collections:${mode}`);
    if (!force && fresh(saved, 21600000)) { try { return { rows: C.normalizeCollections(saved.value), at: saved.at }; } catch {} }
    const rows = mode === 'site' ? await siteCollections() : await C.collectPublic(async offset => {
      if (offset) await pause();
      return request(`https://api.bgm.tv/v0/users/${username}/collections?subject_type=2&limit=100&offset=${offset}`);
    });
    return { rows, at: Date.now() };
  }
  function pause() {
    return new Promise(resolve => setTimeout(resolve, 180));
  }
  async function sync(force = false, mode = source) {
    if (busy) return;
    busy = true; $('.refresh').disabled = true; $('.refresh').textContent = '核对中…';
    try {
      const nextCalendar = await getCalendar(force), nextCollection = await getCollections(force, mode);
      if (!ready) restore(false);
      calendar = nextCalendar; collections = nextCollection.rows; source = mode; ready = true;
      save(`collections:${mode}`, { at: nextCollection.at, value: collections }); save('mode', mode);
      status(''); render();
    } catch (error) {
      if (!ready) {
        try {
          const savedCalendar = read('calendar'), savedCollection = read(`collections:${mode}`);
          if (savedCalendar?.value && savedCollection?.value && Number.isFinite(savedCollection.at)) {
            calendar = C.normalizeCalendar(savedCalendar.value); collections = C.normalizeCollections(savedCollection.value); source = mode; ready = true; restore(false); render();
          }
        } catch {}
      }
      if (!ready) restore(true);
      status(ready ? `核对失败，保留上次收藏：${error.message}` : `核对失败，显示原始放送表：${error.message}`, true);
    } finally { busy = false; $('.refresh').disabled = false; $('.refresh').textContent = '刷新核对个人收藏'; }
  }
  shadow.addEventListener('click', event => {
    const btn = event.target.closest('button'); if (!btn) return;
    if (btn.dataset.day !== undefined) { navChanged = true; selectedDate = C.weekDates(selectedDate)[Number(btn.dataset.day)].date; render(); }
    else if (btn.classList.contains('prev')) { navChanged = true; selectedDate = C.shiftDate(selectedDate, -1); render(); }
    else if (btn.classList.contains('next')) { navChanged = true; selectedDate = C.shiftDate(selectedDate, 1); render(); }
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
