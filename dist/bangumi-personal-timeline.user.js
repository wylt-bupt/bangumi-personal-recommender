// ==UserScript==
// @name         个人时光机
// @namespace    https://bgm.tv/user/wylt
// @version      1.0.6
// @description  原版风格的年度标记热力图；保留每条活动，并按实际新增集数计算批量进度。
// @author       Mikuorz（原版界面），wylt（本地数据适配）
// @match        https://bgm.tv/*
// @match        https://bangumi.tv/*
// @match        https://chii.in/*
// @grant        none
// ==/UserScript==
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BangumiTimelineCore = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const TYPES = ['subject', 'progress'];
  const pad = n => String(n).padStart(2, '0');
  const dayKey = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
  const dayStart = ms => Date.parse(dayKey(ms) + 'T00:00:00+08:00');
  function parseTime(text) {
    const m = String(text || '').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return NaN;
    const key = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    const ms = Date.parse(`${key}T${pad(m[4])}:${m[5]}:${m[6] || '00'}+08:00`);
    return Number(m[4]) < 24 && Number(m[5]) < 60 && Number(m[6] || 0) < 60 && Number.isFinite(ms) && dayKey(ms) === key ? ms : NaN;
  }
  function normalizeEvent(e) {
    if (!e || !/^\d{1,15}$/.test(String(e.id)) || !TYPES.includes(e.type) || !Number.isFinite(e.time) || e.time < Date.UTC(2008, 0, 1) || e.time > Date.now() + DAY) throw new Error('备份中的活动记录无效');
    return { id: String(e.id), type: e.type, time: e.time, source: String(e.source || '未知').slice(0, 60), text: String(e.text || '').slice(0, 1000), subjects: [...new Set((Array.isArray(e.subjects) ? e.subjects : []).map(String).filter(s => /^\d{1,12}$/.test(s)))].slice(0, 100) };
  }
  function parsePage(doc, type, page, origin, user) {
    if (!TYPES.includes(type)) throw new Error('未知的活动类型');
    const timeline = doc.querySelector('#timeline');
    const profile = Array.from(doc.querySelectorAll('a[href]')).some(a => {
      try { return new URL(a.getAttribute('href'), origin).pathname === `/user/${user}`; } catch { return false; }
    });
    if (!timeline || !profile || doc.querySelector('input[type="password"]')) throw new Error('未读到时间胶囊，请确认仍然登录 Bangumi');
    const rows = [...timeline.querySelectorAll('li[id^="tml_"]')];
    const events = rows.map(row => {
      const date = row.querySelector('.date');
      const stamp = date && [...date.querySelectorAll('[data-original-title],[title],time')].map(el => el.getAttribute('data-original-title') || el.getAttribute('title') || el.getAttribute('datetime')).find(s => Number.isFinite(parseTime(s)));
      const time = parseTime(stamp);
      if (!Number.isFinite(time)) throw new Error('时间胶囊格式发生变化，已保留上次数据');
      const source = (date.textContent.split('·').slice(1).join('·').trim() || '未知');
      const info = row.querySelector('.info_full,.info') || row;
      const subjects = [...info.querySelectorAll('a[href]')].map(a => {
        try { return new URL(a.getAttribute('href'), origin).pathname.match(/^\/subject\/(\d+)\/?$/)?.[1]; } catch { return null; }
      }).filter(Boolean);
      const clone = info.cloneNode(true);
      clone.querySelectorAll('.card,.date,.tml_del,.collectInfo').forEach(el => el.remove());
      return normalizeEvent({ id: row.id.slice(4), type, time, source, subjects, text: clone.textContent.replace(/\s+/g, ' ').trim() });
    });
    if (!rows.length && !/没有|暂无|空空|尚未|还没/.test(timeline.textContent)) throw new Error('时间胶囊为空但没有空记录提示，暂不标记同步完成');
    const nextLink = [...doc.querySelectorAll('a[href]')].find(a => /下一页/.test(a.textContent));
    let next = null;
    if (nextLink) {
      const url = new URL(nextLink.getAttribute('href'), origin);
      const n = Number(url.searchParams.get('page'));
      if (url.origin !== origin || url.pathname !== `/user/${user}/timeline` || url.searchParams.get('type') !== type || !Number.isInteger(n) || n !== page + 1 || n > 10000) throw new Error('分页地址异常，已停止同步');
      next = n;
    }
    return { events, next, oldest: events.length ? Math.min(...events.map(e => e.time)) : null, newest: events.length ? Math.max(...events.map(e => e.time)) : null };
  }
  function freshState(user) {
    return { schema: 1, user, events: [], streams: Object.fromEntries(TYPES.map(t => [t, { page: 1, complete: false, oldest: null, headAt: 0 }])), paused: false, retryAt: 0, failures: 0, updatedAt: 0 };
  }
  function mergeEvents(old, incoming) {
    const map = new Map(old.map(e => [e.id, e]));
    incoming.forEach(e => map.set(e.id, e));
    return [...map.values()].sort((a, b) => b.time - a.time || Number(b.id) - Number(a.id));
  }
  function importBackup(text, user, state) {
    if (text.length > 30 * 1024 * 1024) throw new Error('备份文件超过 30 MB');
    const data = JSON.parse(text);
    if (data.format !== 'bangumi-personal-timeline' || data.schema !== 1 || data.user !== user || !Array.isArray(data.events) || data.events.length > 100000) throw new Error('请选择此账号的个人时光机备份');
    const events = data.events.map(normalizeEvent);
    // Import records, never trust imported cursors or claims of complete coverage.
    return { ...state, events: mergeEvents(state.events, events) };
  }
  function progressSubjectKey(event) {
    if (event.subjects[0]) return `subject:${event.subjects[0]}`;
    return `text:${event.text.replace(/\bep\.\s*\d+\b/ig, '').replace(/\d+\s+of\s+\d+\s*话/ig, '').replace(/\s+/g, ' ').trim()}`;
  }
  function progressUnits(event, progress) {
    const key = progressSubjectKey(event);
    const previous = progress.get(key) || 0;
    const checkpoint = event.text.match(/(?:^|\s)(\d+)\s+of\s+\d+\s*话(?:\s|$)/i);
    if (checkpoint) {
      const current = Number(checkpoint[1]);
      progress.set(key, Math.max(previous, current));
      return Math.max(0, current - previous);
    }
    const episode = event.text.match(/\bep\.\s*(\d+)\b/i);
    if (episode) progress.set(key, Math.max(previous, Number(episode[1])));
    // Specials and older timeline formats may not expose an episode number,
    // but each progress entry still represents at least one marked episode.
    return 1;
  }
  function aggregate(state, now = Date.now()) {
    const start = dayStart(now) - 364 * DAY;
    const end = dayStart(now) + DAY;
    const daily = Object.create(null), hourly = Array(24).fill(0), weekly = Array(7).fill(0), sources = Object.create(null);
    const progress = new Map();
    let total = 0;
    const events = state.events.filter(e => e.time <= now).sort((a, b) => a.time - b.time || Number(a.id) - Number(b.id));
    for (const e of events) {
      // Preserve the original heatmap contract: every timeline activity counts
      // at least once. Progress checkpoints only increase that weight when one
      // action represents multiple newly marked episodes.
      const amount = e.type === 'progress' ? Math.max(1, progressUnits(e, progress)) : 1;
      if (e.time < start) continue;
      const key = dayKey(e.time), d = new Date(e.time + 8 * 3600000);
      daily[key] = (daily[key] || 0) + amount;
      hourly[d.getUTCHours()] += amount;
      weekly[(d.getUTCDay() + 6) % 7] += amount;
      const name = e.source === 'web' ? '网页端' : e.source === 'mobile' ? '移动端' : e.source;
      sources[name] = (sources[name] || 0) + amount;
      total += amount;
    }
    const coverage = Math.max(...TYPES.map(type => {
      const stream = state.streams[type];
      return stream.complete ? start : stream.oldest === null ? end : dayStart(stream.oldest) + DAY;
    }));
    const days = Array.from({ length: 365 }, (_, i) => {
      const time = start + i * DAY, key = dayKey(time);
      return { key, time, count: daily[key] || 0, known: time >= coverage };
    });
    const ranked = Object.entries(sources).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    const platform = ranked.length <= 5 ? ranked : [...ranked.slice(0, 4), { name: '其他', count: ranked.slice(4).reduce((sum, x) => sum + x.count, 0) }];
    return { days, hourly, weekly, platform, total, complete: TYPES.every(t => state.streams[t].complete), start, end };
  }
  return { DAY, TYPES, dayKey, dayStart, parseTime, parsePage, freshState, mergeEvents, aggregate, importBackup, normalizeEvent, progressUnits };
});


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
      const blog = document.querySelector('#user_home #blog');
      if (!blog) return false;
      blog.after(host); host.style.marginTop = '28px';
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
    if (!navigator.locks) { message = '当前浏览器不支持安全的多标签同步，请使用新版 Chrome'; render(); return; }
    await navigator.locks.request('bgmtl-sync-wylt', { ifAvailable: true }, async lock => {
      if (!lock) return;
      state = await read();
      if (state.retryAt > Date.now()) return;
      busy = true; aborted = false; message = ''; render();
      try {
        for (const t of C.TYPES) {
          const s = state.streams[t];
          if (!s.complete && s.page > 1) s.page = Math.max(1, s.page - 2);
          if (s.refresh?.page > 1) s.refresh.page = Math.max(1, s.refresh.page - 1);
          if (!s.refresh && s.latestTime && (force || Date.now() - s.headAt > 15 * 60000)) s.refresh = { page: 1, until: s.latestTime, newest: s.latestTime };
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
      } finally { busy = false; render(); }
    }).catch(error => { busy = false; message = error.message; render(); });
  }
  async function start() {
    if (!demo) {
      const loggedIn = document.querySelector('#dock a[title="时光机"]');
      if (!loggedIn || new URL(loggedIn.href).pathname !== `/user/${USER}`) return;
    }
    if (!mount()) return;
    try {
      db = await openDB(); state = await read();
      if (state.paused) { state.paused = false; await save(); }
      render();
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('bgmtl-personal');
        channel.onmessage = async event => {
          if (event.data === 'pause-request') aborted = true;
          else if (!busy) { state = await read(); render(); }
        };
      }
      run(); timer = setInterval(() => run(), 30000);
      window.addEventListener('online', () => run());
      window.addEventListener('pagehide', () => { aborted = true; clearInterval(timer); });
      window.addEventListener('pageshow', event => { if (event.persisted) { clearInterval(timer); timer = setInterval(() => run(), 30000); run(); } });
    } catch (error) { message = error.message; render(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
