(function () {
  'use strict';
  const C = globalThis.BangumiTimelineCore;
  const USER = 'wylt', ID = 'bgmtl-personal', DB_NAME = 'bangumi-personal-timeline';
  const demo = document.body?.dataset.timelineDemo === 'true' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (!C || (!demo && !/^(bgm\.tv|bangumi\.tv|chii\.in)$/.test(location.hostname))) return;
  const home = location.pathname === '/', profile = /^\/user\/wylt\/?$/.test(location.pathname);
  if (!home && !profile && !demo) return;

  let db, host, shadow, state = C.freshState(USER), busy = false, channel, timer;
  let aborted = false, storageBlocked = false, message = '', drawnSignature = '';
  // Idle streams only need attention every 15 minutes. Remembering the next
  // due time lets the 30-second poll skip the full IndexedDB read meanwhile.
  let idleUntil = 0;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('state');
      req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
      req.onerror = () => reject(new Error('浏览器无法保存本地记录，请检查站点存储权限'));
      req.onblocked = () => reject(new Error('本地数据库被占用，请关闭其他 Bangumi 页面再试'));
    });
  }
  function read() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state'), req = tx.objectStore('state').get(USER);
      req.onsuccess = () => resolve(req.result || C.freshState(USER));
      req.onerror = () => reject(req.error);
    });
  }
  function save() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put(state, USER);
      tx.oncomplete = () => { channel?.postMessage('updated'); resolve(); };
      tx.onerror = tx.onabort = () => { storageBlocked = true; reject(new Error('本地保存失败，已停止同步')); };
    });
  }

  // Visual layer adapted from Mikuorz's “条目时间线可视化” heatmap.
  const css = `
    :host{display:block;min-width:0;margin-bottom:20px;--hm-text:#666;--hm-text-dim:#999;--hm-text-strong:#333;--hm-border:#eee;--hm-cell-empty:#f2f2f2;--hm-cell-l1:#f8cdd4;--hm-cell-l2:#ed7790;--hm-cell-l3:#c83d64;--hm-panel-bg:#fff;--hm-panel-border:rgba(240,145,153,.18)}
    :host([data-theme=dark]){--hm-text:#999;--hm-text-dim:#777;--hm-text-strong:#ccc;--hm-border:rgba(255,255,255,.08);--hm-cell-empty:rgba(255,255,255,.08);--hm-cell-l1:rgba(240,145,153,.32);--hm-cell-l2:rgba(240,112,137,.66);--hm-cell-l3:#ef6889;--hm-panel-bg:rgba(255,255,255,.03);--hm-panel-border:rgba(240,145,153,.12)}
    *{box-sizing:border-box}
    #hm-dashboard{border-radius:10px;padding:12px 15px;margin-bottom:20px;background:var(--hm-panel-bg);border:1px solid var(--hm-panel-border);color:var(--hm-text);font:12px/1.5 Arial,"Microsoft YaHei",sans-serif;overflow:hidden}
    #hm-dashboard .hm-scroll{overflow-x:auto;padding:4px 0 10px 0;scrollbar-width:thin;scrollbar-color:transparent transparent}
    #hm-dashboard .hm-scroll::-webkit-scrollbar{height:7px}
    #hm-dashboard .hm-scroll::-webkit-scrollbar-track,#hm-dashboard .hm-scroll::-webkit-scrollbar-thumb,#hm-dashboard .hm-scroll::-webkit-scrollbar-corner{background:transparent}
    #hm-dashboard .hm-scroll:hover{scrollbar-color:rgba(240,145,153,.3) transparent}
    #hm-dashboard .hm-scroll:hover::-webkit-scrollbar-thumb{background:rgba(240,145,153,.3);border-radius:4px}
    #hm-dashboard .hm-cell{transition:transform .15s,filter .15s;transform-box:fill-box;transform-origin:center}
    #hm-dashboard .hm-cell:hover{transform:scale(1.4);filter:drop-shadow(0 0 4px rgba(240,145,153,.5))}
    #hm-dashboard .hm-loading{height:112px;display:flex;align-items:center;justify-content:center;color:var(--hm-text-dim);font-size:11px}
    @media(prefers-reduced-motion:reduce){#hm-dashboard .hm-cell{transition:none!important}}
  `;

  function theme() {
    const attr = document.documentElement.getAttribute('data-theme');
    host.dataset.theme = attr === 'dark' || (attr !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  function mount() {
    if (document.getElementById(ID)) return false;
    host = document.createElement('div'); host.id = ID;
    if (demo) document.querySelector('#timeline-demo')?.append(host);
    else if (home) {
      const col = document.querySelector('#columnHomeB.column');
      if (!col) return false;
      col.prepend(host);
    } else {
      // Share the recommender gadget's sections area so section order is
      // deterministic regardless of which gadget executes first: flex order
      // 5 keeps the heatmap above the stats (10) and recommender (20) hosts.
      const column = document.querySelector('#user_home');
      if (!column) return false;
      let area = document.getElementById('bgmpr-profile-sections');
      if (!area) {
        area = document.createElement('div');
        area.id = 'bgmpr-profile-sections';
        area.style.cssText = 'display:flex;flex-direction:column;gap:32px;clear:both;width:100%;min-width:0;margin:28px 0 36px';
        const blog = column.querySelector('#blog');
        if (blog) blog.after(area); else column.append(area);
      }
      host.style.cssText = 'display:block;min-width:0;width:100%;order:5';
      area.append(host);
    }
    if (!host.isConnected) return false;
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${css}</style><section id="hm-dashboard" class="featuredItems" aria-label="时光机统计"><div style="margin-bottom:10px;"><h2 class="subtitle" style="color:#f09199;margin:0;font-size:14px;font-weight:700;border-bottom:none;">时光机统计</h2></div><div class="hm-chart-area"><div class="hm-loading">正在整理你的时间胶囊…</div></div></section>`;
    theme();
    new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme);
    return true;
  }

  function drawHeatmap(data) {
    const area = shadow.querySelector('.hm-chart-area');
    const counts = new Map(data.days.map(day => [day.key, day.count]));
    const cell = 9.5, gap = 2, padL = 30, padT = 20, padR = 12, rows = 7;
    const today = new Date(data.days[data.days.length - 1].time + 8 * 3600000);
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 364);
    const startDay = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - (startDay === 0 ? 6 : startDay - 1));
    const daysDiff = Math.floor((today - start) / C.DAY);
    const cols = Math.ceil((daysDiff + 1) / 7);
    const width = padL + cols * (cell + gap) + padR;
    const height = padT + rows * (cell + gap) + 4;
    const labels = ['一', '', '三', '', '五', '', '日'];
    const monthDrawn = Object.create(null);
    let svg = `<svg viewBox="0 0 ${width} ${height}" style="display:block;min-width:${width}px" role="img" aria-label="近一年每日标记集数热力图"><g transform="translate(${padL} ${padT})">`;
    labels.forEach((label, row) => {
      if (label) svg += `<text x="-8" y="${row * (cell + gap) + 8}" text-anchor="end" fill="var(--hm-text-dim)" font-size="9">${label}</text>`;
    });
    for (let offset = 0; offset <= daysDiff; offset++) {
      const cursor = new Date(start);
      cursor.setUTCDate(cursor.getUTCDate() + offset);
      const col = Math.floor(offset / 7), row = offset % 7;
      const key = cursor.toISOString().slice(0, 10), count = counts.get(key) || 0;
      if (row === 0) {
        const mon = cursor.toLocaleString('zh-CN', { month: 'short', timeZone: 'UTC' });
        if (!monthDrawn[mon] && col > 0 && col < cols) {
          monthDrawn[mon] = true;
          svg += `<text x="${col * (cell + gap)}" y="-8" fill="var(--hm-text-dim)" font-size="9" font-weight="600">${mon}</text>`;
        }
      }
      const fill = count === 0 ? 'var(--hm-cell-empty)' : count <= 3 ? 'var(--hm-cell-l1)' : count <= 9 ? 'var(--hm-cell-l2)' : 'var(--hm-cell-l3)';
      svg += `<rect class="hm-cell" x="${col * (cell + gap)}" y="${row * (cell + gap)}" width="${cell}" height="${cell}" rx="2" fill="${fill}" opacity="0"><title>${key}: ${count} 集</title></rect>`;
    }
    svg += '</g></svg>';
    const active = data.days.filter(day => day.count > 0).length;
    const activeRate = (active / data.days.length * 100).toFixed(1);
    const recentActive = data.days.slice(-30).filter(day => day.count > 0).length;
    area.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:2px;font-size:10px;color:var(--hm-text-dim);"><span style="display:flex;align-items:center;gap:7px;white-space:nowrap;"><span>近1年活跃率: <b style="color:#f09199;">${activeRate}%</b></span><span style="color:var(--hm-border);">·</span><span>近30天活跃: <b style="color:#f09199;">${recentActive}</b> 天</span></span><span style="display:flex;align-items:center;gap:3px;white-space:nowrap;">少${['empty', 'l1', 'l2', 'l3'].map(level => `<i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--hm-cell-${level});"></i>`).join('')}多</span></div><div class="hm-scroll">${svg}</div>`;
    const wrap = area.querySelector('.hm-scroll');
    setTimeout(() => { wrap.scrollLeft = wrap.scrollWidth; }, 0);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      area.querySelectorAll('.hm-cell').forEach(rect => { rect.style.opacity = '1'; });
    } else {
      [...area.querySelectorAll('.hm-cell')].reverse().forEach((rect, index) => {
        setTimeout(() => { rect.style.transition = 'opacity .2s ease,transform .15s,filter .15s'; rect.style.opacity = '1'; }, index * 3);
      });
    }
  }
  function render() {
    if (!shadow) return;
    const data = C.aggregate(state);
    const signature = data.days.map(day => day.count).join(',');
    if (signature !== drawnSignature && (data.total || data.complete)) {
      drawnSignature = signature;
      drawHeatmap(data);
    } else if (!data.total && !data.complete && message) {
      shadow.querySelector('.hm-loading').textContent = `加载失败：${message}`;
    } else if (!data.total && data.complete) {
      drawnSignature = signature;
      drawHeatmap(data);
    }
  }

  async function fetchPage(type, page) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const url = new URL(`/user/${USER}/timeline`, location.origin);
      url.searchParams.set('type', type); url.searchParams.set('page', page);
      const response = await fetch(url.href, { credentials: 'same-origin', signal: controller.signal, cache: 'no-store', headers: { Accept: 'text/html' } });
      if (!response.ok) {
        const error = new Error(response.status === 429 ? 'Bangumi 暂时限流，稍后自动重试' : `Bangumi 返回 ${response.status}`);
        error.cooldown = response.status === 429 ? Math.max(15 * 60000, Math.min(86400000, (Number(response.headers.get('Retry-After')) || 0) * 1000)) : 0;
        throw error;
      }
      if (new URL(response.url).origin !== location.origin || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Bangumi 返回了非时间胶囊页面');
      const html = await response.text();
      const inert = html.replace(/<(script|iframe|audio|video)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<(?:img|iframe|script|link|audio|video|source)\b[^>]*>/gi, '');
      return C.parsePage(new DOMParser().parseFromString(inert, 'text/html'), type, page, location.origin, USER);
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('连接超时，稍后自动重试');
      if (error instanceof TypeError) throw new Error('暂时无法连接 Bangumi');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function run(force = false) {
    if (!db || busy || demo || storageBlocked || !navigator.onLine) return;
    if (!force && Date.now() < idleUntil) return;
    if (!navigator.locks) { message = '当前浏览器不支持安全的多标签同步，请使用新版 Chrome'; render(); return; }
    await navigator.locks.request('bgmtl-sync-wylt', { ifAvailable: true }, async lock => {
      if (!lock) return;
      state = await read();
      const now = Date.now();
      const nextSyncAt = C.nextSyncAt(state, now);
      if (!force && nextSyncAt > now) { idleUntil = nextSyncAt; return; }
      busy = true; aborted = false; message = ''; render();
      try {
        for (const t of C.TYPES) {
          const s = state.streams[t];
          if (!s.complete && s.page > 1) s.page = Math.max(1, s.page - 2);
          if (s.refresh?.page > 1) s.refresh.page = Math.max(1, s.refresh.page - 1);
          if (s.complete && !s.refresh && (force || Date.now() - s.headAt >= C.REFRESH_INTERVAL)) {
            s.refresh = { page: 1, until: s.latestTime || 0, newest: s.latestTime || 0 };
          }
        }
        let made = 0;
        while (made < 24 && !aborted) {
          let worked = false;
          for (const t of C.TYPES) {
            if (aborted || made >= 24) break;
            const s = state.streams[t];
            if (s.complete && !s.refresh) continue;
            const page = s.refresh?.page || s.page;
            const result = await fetchPage(t, page);
            const cutoff = C.dayStart(Date.now()) - 364 * C.DAY;
            state.events = C.mergeEvents(state.events, result.events);
            if (result.oldest !== null) s.oldest = s.oldest === null ? result.oldest : Math.min(s.oldest, result.oldest);
            if (s.refresh) {
              s.refresh.newest = Math.max(s.refresh.newest, result.newest || 0);
              if (result.next === null || result.oldest < s.refresh.until || result.oldest < cutoff) {
                s.latestTime = s.refresh.newest; s.headAt = Date.now(); delete s.refresh;
              } else s.refresh.page = result.next;
            } else {
              if (page === 1) { s.latestTime = result.newest || s.latestTime; s.headAt = Date.now(); }
              s.page = result.next || page;
              if (result.next === null || result.oldest < cutoff) s.complete = true;
            }
            state.updatedAt = Date.now(); state.failures = 0; state.retryAt = 0;
            await save(); render(); made++; worked = true;
            if (!aborted) await delay(1500);
          }
          if (!worked) break;
        }
      } catch (error) {
        state.failures = (state.failures || 0) + 1;
        state.retryAt = Date.now() + Math.max(error.cooldown || 0, Math.min(3600000, 60000 * 2 ** Math.min(6, state.failures - 1)));
        message = error.message;
        try { await save(); } catch (storageError) { message = storageError.message; }
      } finally { idleUntil = C.nextSyncAt(state, Date.now()); busy = false; render(); }
    }).catch(error => { busy = false; message = error.message; render(); });
  }
  async function start() {
    if (!demo) {
      const loggedIn = document.querySelector('#dock a[title="时光机"]');
      if (!loggedIn || new URL(loggedIn.href).pathname !== `/user/${USER}`) return;
    }
    if (!mount()) return;
    try {
      db = await openDB(); state = await read(); idleUntil = C.nextSyncAt(state, Date.now());
      if (state.paused) { state.paused = false; await save(); }
      render();
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('bgmtl-personal');
        channel.onmessage = async event => {
          if (event.data === 'pause-request') aborted = true;
          else if (!busy) { state = await read(); idleUntil = C.nextSyncAt(state, Date.now()); render(); }
        };
      }
      run(); timer = setInterval(() => run(), 30000);
      window.addEventListener('online', () => { idleUntil = 0; run(); });
      window.addEventListener('pagehide', () => { aborted = true; clearInterval(timer); });
      window.addEventListener('pageshow', event => { if (event.persisted) { clearInterval(timer); idleUntil = 0; timer = setInterval(() => run(), 30000); run(); } });
    } catch (error) { message = error.message; render(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
