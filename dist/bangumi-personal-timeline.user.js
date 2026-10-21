// ==UserScript==
// @name         个人时光机
// @namespace    https://bgm.tv/user/wylt
// @version      1.0.24
// @description  活跃度热力图；仅统计每日标记看过的集数，数据保存在浏览器本地。
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
  const REFRESH_INTERVAL = 15 * 60 * 1000;
  const TYPES = ['subject', 'progress'];
  const SYNC_TYPES = ['progress'];
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
    return { schema: 1, user, deep: false, events: [], streams: Object.fromEntries(SYNC_TYPES.map(t => [t, { page: 1, complete: false, deep: false, oldest: null, headAt: 0 }])), paused: false, retryAt: 0, failures: 0, updatedAt: 0 };
  }
  function mergeEvents(old, incoming) {
    const map = new Map(old.map(e => [e.id, e]));
    incoming.forEach(e => map.set(e.id, e));
    return [...map.values()].sort((a, b) => b.time - a.time || Number(b.id) - Number(a.id));
  }
  function nextSyncAt(state, now = Date.now()) {
    if (Number(state?.retryAt || 0) > now) return Number(state.retryAt);
    let next = Infinity;
    for (const type of SYNC_TYPES) {
      const stream = state?.streams?.[type];
      if (!stream || !stream.complete || stream.refresh) return 0;
      // Full-history backfill requested but not finished: keep working now.
      if (state.deep && !stream.deep) return 0;
      const checkedAt = Number(stream.headAt || state?.updatedAt || 0);
      if (!checkedAt) return 0;
      next = Math.min(next, checkedAt + REFRESH_INTERVAL);
    }
    return next;
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
    const text = event.text.trim();
    const key = progressSubjectKey(event);
    const previous = progress.get(key) || 0;
    const checkpoint = /^完成了\s/.test(text) && text.match(/(?:^|\s)(\d+)\s+of\s+\d+\s*话(?:\s|$)/i);
    if (checkpoint) {
      const current = Number(checkpoint[1]);
      progress.set(key, Math.max(previous, current));
      return Math.max(0, current - previous);
    }
    const episode = text.match(/^看过\s+(?:ep|sp)\.\s*(\d+)\b/i);
    if (!episode) return 0;
    progress.set(key, Math.max(previous, Number(episode[1])));
    return 1;
  }
  function aggregate(state, now = Date.now()) {
    const start = dayStart(now) - 364 * DAY;
    const end = dayStart(now) + DAY;
    const daily = Object.create(null), hourly = Array(24).fill(0), weekly = Array(7).fill(0), sources = Object.create(null);
    const progress = new Map();
    let total = 0;
    const events = state.events.filter(e => e.type === 'progress' && e.time <= now).sort((a, b) => a.time - b.time || Number(a.id) - Number(b.id));
    for (const e of events) {
      // Older progress entries establish the baseline for later batch updates,
      // but only confirmed watched episodes contribute to the heatmap.
      const amount = progressUnits(e, progress);
      if (e.time < start || amount === 0) continue;
      const key = dayKey(e.time), d = new Date(e.time + 8 * 3600000);
      daily[key] = (daily[key] || 0) + amount;
      hourly[d.getUTCHours()] += amount;
      weekly[(d.getUTCDay() + 6) % 7] += amount;
      const name = e.source === 'web' ? '网页端' : e.source === 'mobile' ? '移动端' : e.source;
      sources[name] = (sources[name] || 0) + amount;
      total += amount;
    }
    const stream = state.streams.progress;
    const coverage = stream.complete ? start : stream.oldest === null ? end : dayStart(stream.oldest) + DAY;
    const days = Array.from({ length: 365 }, (_, i) => {
      const time = start + i * DAY, key = dayKey(time);
      return { key, time, count: daily[key] || 0, known: time >= coverage };
    });
    const completedDays = days.slice(-31, -1);
    const average30 = completedDays.every(day => day.known)
      ? completedDays.reduce((sum, day) => sum + day.count, 0) / 30 : null;
    const ranked = Object.entries(sources).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    const platform = ranked.length <= 5 ? ranked : [...ranked.slice(0, 4), { name: '其他', count: ranked.slice(4).reduce((sum, x) => sum + x.count, 0) }];
    return { days, hourly, weekly, platform, total, complete: stream.complete, start, end, average30 };
  }
  // Trailing mean over the whole series. Callers slice afterwards: computing it
  // on a visible window would restart the sum and understate the first days.
  function rollingMean(values, window = 7) {
    const size = Math.max(1, Math.floor(window));
    let sum = 0;
    return values.map((value, index) => {
      sum += value;
      if (index >= size) sum -= values[index - size];
      return sum / Math.min(index + 1, size);
    });
  }
  /* ── 逐日序列按固定天数聚合 ──
     窄窗口里一天一根柱子会挤成发丝墙，噪声反倒是全部信息。按 7/14/30 天
     聚合成桶之后，每根柱子的高度是一段时间的合计，形状才重新读得出来；
     末尾不足一桶的照常保留，读数条会如实显示起止日期。 */
  function bucketSeries(days, size) {
    const step = Math.max(1, Math.floor(size || 1));
    const source = days || [];
    if (step === 1) return source.map(day => ({ key: day.key, endKey: day.key, days: 1, count: day.count, mean: day.mean }));
    const buckets = [];
    for (let start = 0; start < source.length; start += step) {
      const slice = source.slice(start, start + step);
      const count = slice.reduce((sum, day) => sum + day.count, 0);
      const mean = slice.reduce((sum, day) => sum + day.mean, 0) / slice.length;
      buckets.push({ key: slice[0].key, endKey: slice[slice.length - 1].key, days: slice.length, count, mean });
    }
    return buckets;
  }
  function niceStep(value) {
    const power = Math.pow(10, Math.floor(Math.log10(Math.max(value, 1))));
    const fraction = value / power;
    return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  }
  /* ── 纵轴：零安全对数刻度（与账本日支出图同一套视觉语言）──
     逐日集数是典型的脉冲序列：一个补番日能顶平时二十天。线性轴下普通日子
     全部压成发丝。但对数压缩也不能一味往上抬——抬过头了，1 集的日子会顶到
     绘图区四分之一高，图片面积跟数量又对不上。所以压缩力度锚在最低刻度线
     上：纵轴最低标 5 集，让它固定落在 22% 高度，5 集以下按对数自然收在底部，
     顶部留给少数高峰。刻度只出 5/10/20/50… 这类整数，像素密度交给调用方筛。 */
  const AXIS_BASE = 5, BASE_HEIGHT = 0.22, MIN_COMPRESS = 0.05, MAX_COMPRESS = 25;
  function countAxis(values) {
    const finite = (values || []).filter(value => Number.isFinite);
    const max = finite.length ? Math.max(...finite) : 0;
    const unit = Math.max(1, niceStep(max / 5 || 1));
    // +0.5：最大值正好落在刻度上时也要留出头顶的一点空隙，否则最高的柱子贴边。
    // 下限取最低刻度：再小的值域也得有一条刻度线撑着。
    const hi = Math.max(AXIS_BASE, Math.ceil((max + 0.5) / unit) * unit);
    // ratio(c) 随 c 单调递减：c 越小，低值被抬得越高。
    const ratio = c => Math.log1p(AXIS_BASE / c) / Math.log1p(hi / c);
    let c = MAX_COMPRESS;
    if (ratio(MIN_COMPRESS) <= BASE_HEIGHT) c = MIN_COMPRESS;
    else if (ratio(MAX_COMPRESS) > BASE_HEIGHT) c = MAX_COMPRESS;
    else {
      let low = MIN_COMPRESS, high = MAX_COMPRESS;
      for (let step = 0; step < 40; step++) {
        const mid = Math.sqrt(low * high);
        if (ratio(mid) > BASE_HEIGHT) low = mid; else high = mid;
      }
      c = Math.sqrt(low * high);
    }
    const transform = value => Math.sign(value) * Math.log1p(Math.abs(value) / c);
    const top = transform(hi);
    const ticks = [];
    for (let power = 1; power <= hi; power *= 10) {
      for (const multiple of [1, 2, 5]) {
        const value = power * multiple;
        if (value >= AXIS_BASE && value < hi && value !== ticks[ticks.length - 1]) ticks.push(value);
      }
    }
    ticks.push(hi);
    return { lo: 0, hi, unit, constant: c, ticks, position: value => transform(value) / top };
  }
  // Continuous daily series for the trend chart: "year" mirrors the heatmap
  // window, "all" stretches back to the oldest synced progress record. Each day
  // carries its own trailing mean so the line never restarts mid-window.
  function dailySeries(state, now = Date.now(), range = 'year') {
    const events = state.events.filter(e => e.type === 'progress' && e.time <= now).sort((a, b) => a.time - b.time || Number(a.id) - Number(b.id));
    const progress = new Map();
    const daily = Object.create(null);
    let oldestTime = Infinity;
    for (const e of events) {
      const amount = progressUnits(e, progress);
      if (amount === 0) continue;
      if (e.time < oldestTime) oldestTime = e.time;
      const key = dayKey(e.time);
      daily[key] = (daily[key] || 0) + amount;
    }
    const end = dayStart(now);
    let start = end - 364 * DAY;
    if (range === 'all' && Number.isFinite(oldestTime)) start = Math.min(start, dayStart(oldestTime));
    if (!Number.isFinite(oldestTime)) return { days: [], total: 0, oldestTime: null };
    // 均线要看得到窗口之前的日子：只拿可见段求平均会让头 6 天整体偏低。
    const fullStart = Math.min(start, dayStart(oldestTime));
    const counts = [];
    for (let time = fullStart; time <= end; time += DAY) counts.push(daily[dayKey(time)] || 0);
    const means = rollingMean(counts, 7);
    const offset = Math.round((start - fullStart) / DAY);
    const days = counts.slice(offset).map((count, index) => ({
      key: dayKey(start + index * DAY),
      time: start + index * DAY,
      count,
      mean: means[offset + index],
    }));
    return { days, total: days.reduce((sum, day) => sum + day.count, 0), oldestTime };
  }
  return { DAY, REFRESH_INTERVAL, TYPES, SYNC_TYPES, dayKey, dayStart, parseTime, parsePage, freshState, mergeEvents, nextSyncAt, aggregate, dailySeries, bucketSeries, rollingMean, countAxis, importBackup, normalizeEvent, progressUnits };
});


(function () {
  'use strict';
  const C = globalThis.BangumiTimelineCore;
  const USER = 'wylt', ID = 'bgmtl-personal', DB_NAME = 'bangumi-personal-timeline';
  const demo = document.body?.dataset.timelineDemo === 'true' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (!C || (!demo && !/^(bgm\.tv|bangumi\.tv|chii\.in)$/.test(location.hostname))) return;
  const home = location.pathname === '/', profile = /^\/user\/wylt\/?$/.test(location.pathname);
  if (!home && !profile && !demo) return;
  const homeLayout = home || demo;

  let db, host, shadow, state = C.freshState(USER), busy = false, channel, timer;
  let aborted = false, storageBlocked = false, message = '', drawnSignature = '', drawnWidth = -1, chartData = null;
  let range = 'year', trendSignature = '', trendWidth = -1, trendSeries = null;
  try { if (localStorage.getItem('bgmtl-chart-range') === 'all') range = 'all'; } catch (error) { /* 私密模式忽略 */ }
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
    :host{display:block;min-width:0;margin-bottom:20px;--hm-text:#666;--hm-text-dim:#999;--hm-text-strong:#333;--hm-heading:#777;--hm-accent:#f09199;--hm-accent-soft:rgba(240,145,153,.1);--hm-border:#eee;--hm-cell-empty:#f2f2f2;--hm-cell-l1:#f8cdd4;--hm-cell-l2:#ed7790;--hm-cell-l3:#c83d64;--hm-panel-bg:#fff;--hm-readout-bg:#fff;--hm-panel-border:rgba(240,145,153,.18)}
    :host([data-theme=dark]){--hm-text:#999;--hm-text-dim:#777;--hm-text-strong:#ccc;--hm-heading:#bbb;--hm-accent:#e99aa7;--hm-accent-soft:rgba(233,154,167,.14);--hm-border:rgba(255,255,255,.08);--hm-cell-empty:rgba(255,255,255,.08);--hm-cell-l1:rgba(240,145,153,.32);--hm-cell-l2:rgba(240,112,137,.66);--hm-cell-l3:#ef6889;--hm-panel-bg:rgba(255,255,255,.03);--hm-readout-bg:#262626;--hm-panel-border:rgba(240,145,153,.12)}
    *{box-sizing:border-box}
    #hm-dashboard{min-width:0;color:var(--hm-text);font:12px/1.5 Arial,"Microsoft YaHei",sans-serif;container-type:inline-size}
    /* 首页右栏空间紧，仍给一张轻卡片；个人主页与「动画回顾」一样无卡片、靠模块头分隔。 */
    #hm-dashboard.home-layout{border-radius:10px;padding:12px 15px;background:var(--hm-panel-bg);border:1px solid var(--hm-panel-border);overflow:hidden}
    /* 模块头：与「动画回顾」「个性推荐」同一套写法（18px 常规字重 + 下划线分隔） */
    #hm-dashboard .module-head{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px;padding:0 0 9px;border-bottom:1px solid var(--hm-border);margin:0 0 14px}
    #hm-dashboard .module-head h2{margin:0;font-size:18px;font-weight:400;line-height:1.4;color:var(--hm-heading)}
    #hm-dashboard.home-layout .module-head{padding-bottom:8px;margin-bottom:10px}
    #hm-dashboard.home-layout .module-head h2{font-size:14px;font-weight:700;color:var(--hm-accent)}
    /* 子图：热力图与柱状图共用一条头部行——左标题、中摘要、右图例与控件。 */
    #hm-dashboard .hm-figure{min-width:0}
    #hm-dashboard .hm-figure+.hm-figure{margin-top:16px;padding-top:14px;border-top:1px solid var(--hm-border)}
    #hm-dashboard .hm-fig-head{display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;min-height:24px;margin-bottom:8px;padding-right:10px;font-size:11px;color:var(--hm-text-dim)}
    #hm-dashboard .hm-fig-title{margin:0;font-size:13px;font-weight:600;line-height:1.4;color:var(--hm-text-strong)}
    #hm-dashboard .hm-fig-meta{font-variant-numeric:tabular-nums}
    #hm-dashboard .hm-fig-meta b{font-weight:400;color:var(--hm-accent)}
    #hm-dashboard .hm-fig-meta .sep{color:var(--hm-border)}
    #hm-dashboard .hm-fig-controls{display:flex;align-items:center;flex-wrap:wrap;gap:6px 14px;margin-left:auto}
    /* 窄屏：标题行拆成两行时，图例跟着左对齐，不要孤零零地贴在右边。 */
    @container (max-width:460px){#hm-dashboard .hm-fig-controls{margin-left:0}#hm-dashboard .hm-mean-line{stroke-width:1.6}}
    /* 图例：色阶（热力图，展示用）与系列开关（柱状图）同一行高、同一字号、同一记号尺寸 */
    #hm-dashboard .hm-legend,#hm-dashboard .hm-scale{display:inline-flex;align-items:center;gap:2px;font-size:11px;color:var(--hm-text-dim);white-space:nowrap}
    #hm-dashboard .hm-legend-key{display:inline-flex;align-items:center;gap:5px;min-height:24px;padding:0 3px;border:1px solid transparent;border-radius:4px;background:transparent;color:var(--hm-text-dim);font:inherit;font-size:11px;cursor:pointer}
    #hm-dashboard .hm-legend-key i{display:block;width:8px;height:8px;flex:none;border:1px solid var(--hm-border);border-radius:1px;background:var(--hm-accent)}
    #hm-dashboard .hm-legend-key i.line{width:14px;height:0;border:0;border-top:1.5px solid var(--hm-text-strong);border-radius:0;background:none}
    #hm-dashboard .hm-legend-key:hover{border-color:var(--hm-border);color:var(--hm-text)}
    #hm-dashboard .hm-legend-key:focus-visible{outline:1px solid var(--hm-accent);outline-offset:1px}
    #hm-dashboard .hm-legend-key[aria-pressed=false]{opacity:.45}
    #hm-dashboard .hm-legend-key[aria-pressed=false] span{text-decoration:line-through}
    #hm-dashboard .hm-scale{padding-left:2px}
    #hm-dashboard .hm-scale i{display:block;width:9px;height:9px;border-radius:2px}
    #hm-dashboard .hm-scale .sw-empty{background:var(--hm-cell-empty)}
    #hm-dashboard .hm-scale .sw-l1{background:var(--hm-cell-l1)}
    #hm-dashboard .hm-scale .sw-l2{background:var(--hm-cell-l2)}
    #hm-dashboard .hm-scale .sw-l3{background:var(--hm-cell-l3)}
    #hm-dashboard .hm-toggle{display:inline-flex;border:1px solid var(--hm-border);border-radius:4px;overflow:hidden}
    #hm-dashboard .hm-toggle button{padding:4px 9px;border:0;border-radius:0;background:transparent;color:var(--hm-text-dim);font:inherit;font-size:11px;line-height:1.3;cursor:pointer}
    #hm-dashboard .hm-toggle button+button{border-left:1px solid var(--hm-border)}
    #hm-dashboard .hm-toggle button[aria-pressed=true]{color:var(--hm-accent);background:var(--hm-accent-soft)}
    #hm-dashboard.home-layout .hm-scroll{overflow:hidden;padding:4px 0}
    #hm-dashboard.profile-layout .hm-scroll{overflow-x:auto;padding:4px 0 10px;scrollbar-width:thin;scrollbar-color:transparent transparent}
    #hm-dashboard.profile-layout .hm-scroll::-webkit-scrollbar{height:7px}
    #hm-dashboard.profile-layout .hm-scroll::-webkit-scrollbar-track,#hm-dashboard.profile-layout .hm-scroll::-webkit-scrollbar-thumb,#hm-dashboard.profile-layout .hm-scroll::-webkit-scrollbar-corner{background:transparent}
    #hm-dashboard.profile-layout .hm-scroll:hover{scrollbar-color:rgba(240,145,153,.3) transparent}
    #hm-dashboard.profile-layout .hm-scroll:hover::-webkit-scrollbar-thumb{background:rgba(240,145,153,.3);border-radius:4px}
    #hm-dashboard .hm-cell{transition:transform .15s,filter .15s;transform-box:fill-box;transform-origin:center}
    #hm-dashboard .hm-cell:hover{transform:scale(1.4);filter:drop-shadow(0 0 4px rgba(240,145,153,.5))}
    #hm-dashboard .hm-loading{height:112px;display:flex;align-items:center;justify-content:center;color:var(--hm-text-dim);font-size:11px}
    #hm-dashboard .hm-trend-total{white-space:nowrap;font-variant-numeric:tabular-nums}
    #hm-dashboard .hm-trend-total b{color:var(--hm-accent);font-weight:400}
    #hm-dashboard .hm-trend-plot{position:relative}
    #hm-dashboard .hm-trend-plot:focus-visible{outline:1px solid var(--hm-accent);outline-offset:3px}
    #hm-dashboard .hm-trend{display:block;width:100%;height:auto}
    /* 网格：发丝虚线，零线转实线——基线要能被眼睛抓住。 */
    #hm-dashboard .hm-grid-line{stroke:var(--hm-border);stroke-width:1;stroke-dasharray:3 4}
    #hm-dashboard .hm-grid-line.zero{stroke:var(--hm-text-dim);stroke-dasharray:none;opacity:.55}
    #hm-dashboard .hm-tick,#hm-dashboard .hm-axis-label{fill:var(--hm-text-dim);font:9px Arial,"Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums}
    #hm-dashboard .hm-month-label{fill:var(--hm-text-dim);font:600 9px Arial,"Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums}
    /* 柱子按周/月聚合后比原来粗，靠留缝分隔，圆角让柱墙不显得生硬。 */
    #hm-dashboard .hm-bar{fill:var(--hm-accent)}
    #hm-dashboard .hm-mean-line{fill:none;stroke:var(--hm-text-strong);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;opacity:.9}
    #hm-dashboard .hm-guide-line{stroke:var(--hm-text-dim);stroke-width:1;stroke-dasharray:2 3}
    #hm-dashboard .hm-guide-bar{fill:var(--hm-accent)}
    #hm-dashboard .hm-guide-mean{fill:var(--hm-text-strong)}
    /* 读数条：图给形状，这里给精确读数，位置固定在右上角不遮挡主体。 */
    #hm-dashboard .hm-readout{position:absolute;top:6px;right:8px;max-width:calc(100% - 16px);display:flex;align-items:baseline;flex-wrap:wrap;justify-content:flex-end;gap:2px 12px;padding:3px 8px;border:1px solid var(--hm-border);background:var(--hm-readout-bg);font-size:11px;color:var(--hm-text-dim);font-variant-numeric:tabular-nums;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.06)}
    #hm-dashboard .hm-readout time{color:var(--hm-text)}
    #hm-dashboard .hm-readout b{color:var(--hm-text);font-weight:400}
    #hm-dashboard .hm-trend-empty{height:120px;display:flex;align-items:center;justify-content:center;border:1px solid var(--hm-border);color:var(--hm-text-dim);font-size:11px}
    #hm-dashboard .hm-trend-hint{margin-top:6px;font-size:11px;color:var(--hm-text-dim)}
    @media(prefers-reduced-motion:reduce){#hm-dashboard .hm-cell{transition:none!important}}
  `;

  // 月标宽度实测一次即可：9px 下的「10月」和「1月」差 6px，按字符数估会把
  // 相邻标签算重叠或算松。canvas 只建一次，重复取 context 不额外开销。
  let labelCanvas;
  function labelWidth(text) {
    if (!labelCanvas) labelCanvas = document.createElement('canvas').getContext('2d');
    if (labelCanvas) labelCanvas.font = '600 9px Arial, "Microsoft YaHei", sans-serif';
    return labelCanvas ? labelCanvas.measureText(text).width : [...text].length * 9;
  }

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
    // 首页右栏只有 350px 宽，柱状图塞进去既挤又难读：首页只留热力图，
    // 趋势图仅出现在个人主页。没有这块节点，drawTrend 自然不会被调用。
    shadow.innerHTML = `<style>${css}</style><section id="hm-dashboard" class="${homeLayout ? 'home-layout' : 'profile-layout'}" aria-labelledby="bgmtl-title"><header class="module-head"><h2 id="bgmtl-title">活跃度</h2></header><div class="hm-figure hm-figure-heat"><div class="hm-fig-head"><h3 class="hm-fig-title">活跃热力图</h3><span class="hm-fig-meta" data-role="heat-meta">正在统计…</span><div class="hm-fig-controls"><span class="hm-scale" role="img" aria-label="色块越深代表当日观看集数越多">少<i class="sw-empty"></i><i class="sw-l1"></i><i class="sw-l2"></i><i class="sw-l3"></i>多</span></div></div><div class="hm-chart-area"><div class="hm-loading">正在整理你的观看进度…</div></div></div>${homeLayout ? '' : '<div class="hm-figure hm-figure-trend"><div class="hm-trend-area"></div></div>'}</section>`;
    if (homeLayout) {
      new ResizeObserver(entries => {
        const width = entries[0]?.contentRect.width || 0;
        if (chartData && Math.abs(width - drawnWidth) > 0.5) drawHeatmap(chartData, false);
      }).observe(shadow.querySelector('.hm-chart-area'));
    } else {
      new ResizeObserver(entries => {
        const width = entries[0]?.contentRect.width || 0;
        if (trendSeries && Math.abs(width - trendWidth) > 0.5) drawTrend(true);
      }).observe(shadow.querySelector('.hm-trend-area'));
    }
    shadow.addEventListener('click', event => {
      const rangeButton = event.target.closest('[data-range]');
      if (rangeButton) {
        if (rangeButton.getAttribute('aria-pressed') !== 'true') setRange(rangeButton.dataset.range);
        return;
      }
      const legendButton = event.target.closest('[data-series]');
      if (legendButton) toggleSeries(legendButton.dataset.series);
    });
    theme();
    new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme);
    return true;
  }

  function drawHeatmap(data, animate = true) {
    const area = shadow.querySelector('.hm-chart-area');
    const counts = new Map(data.days.map(day => [day.key, day.count]));
    const cell = 9.5, gap = 2, padL = 30, padT = 20, padR = 12, rows = 7;
    const today = new Date(data.days[data.days.length - 1].time + 8 * 3600000);
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 364);
    const startDay = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - (startDay === 0 ? 6 : startDay - 1));
    const daysDiff = Math.floor((today - start) / C.DAY);
    const allCols = Math.ceil((daysDiff + 1) / 7);
    const availableWidth = area.clientWidth;
    const cols = homeLayout ? Math.max(1, Math.min(allCols, Math.floor((availableWidth - padL - padR) / (cell + gap)))) : allCols;
    const firstOffset = homeLayout ? (allCols - cols) * 7 : 0;
    const width = padL + cols * (cell + gap) + padR;
    const height = padT + rows * (cell + gap) + 4;
    const weekdays = ['一', '', '三', '', '五', '', '日'];
    const monthLabels = [];
    const svgAttrs = homeLayout ? `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"` : `viewBox="0 0 ${width} ${height}"`;
    let svg = `<svg ${svgAttrs} style="display:block${homeLayout ? '' : `;min-width:${width}px`}" role="img" aria-label="${homeLayout ? '每日观看集数' : '近一年每日观看集数'}热力图"><g transform="translate(${padL} ${padT})">`;
    weekdays.forEach((label, row) => {
      if (label) svg += `<text x="-8" y="${row * (cell + gap) + 8}" text-anchor="end" fill="var(--hm-text-dim)" font-size="9">${label}</text>`;
    });
    for (let offset = firstOffset; offset <= daysDiff; offset++) {
      const cursor = new Date(start);
      cursor.setUTCDate(cursor.getUTCDate() + offset);
      const col = Math.floor((offset - firstOffset) / 7), row = offset % 7;
      const key = cursor.toISOString().slice(0, 10), count = counts.get(key) || 0;
      // 月标只认「某月 1 号所在的列」：每月恰好出现一次，位置也就贴着真实的
      // 月份边界。按每周一标会让窗口首月（只剩一周尾巴）的标签挤到下一个月标
      // 旁边，两块文字直接叠住；按月份名去重还会把跨年窗口末尾的同名月份丢掉。
      if (cursor.getUTCDate() === 1) {
        monthLabels.push({ x: col * (cell + gap), text: cursor.toLocaleString('zh-CN', { month: 'short', timeZone: 'UTC' }), date: key });
      }
      const fill = count === 0 ? 'var(--hm-cell-empty)' : count <= 3 ? 'var(--hm-cell-l1)' : count <= 9 ? 'var(--hm-cell-l2)' : 'var(--hm-cell-l3)';
      svg += `<rect class="hm-cell" x="${col * (cell + gap)}" y="${row * (cell + gap)}" width="${cell}" height="${cell}" rx="2" fill="${fill}" opacity="0"><title>${key}: ${count} 集</title></rect>`;
    }
    // 窄栏（首页）从右往左保留放得下的标签，宽图（个人主页）一年每月一个，
    // 只做右边界收口与重叠兜底——两边都靠实测文字宽度判断，不靠字符数估。
    const measured = monthLabels.map(label => ({ ...label, width: labelWidth(label.text) }));
    const plotRight = cols * (cell + gap);
    const visible = [];
    if (homeLayout) {
      let nextLabelX = Infinity;
      for (let index = measured.length - 1; index >= 0; index--) {
        const label = measured[index];
        if (label.x + label.width + 4 <= nextLabelX) { visible.push(label); nextLabelX = label.x; }
      }
      visible.reverse();
    } else {
      let previousRight = -Infinity;
      for (const label of measured) {
        const x = Math.min(label.x, plotRight - label.width);
        if (x < previousRight + 4) continue;
        visible.push({ ...label, x });
        previousRight = x + label.width;
      }
    }
    visible.forEach(label => {
      svg += `<text class="hm-month-label" data-date="${label.date}" x="${label.x.toFixed(1)}" y="-8">${label.text}</text>`;
    });
    svg += '</g></svg>';
    const active = data.days.filter(day => day.count > 0).length;
    const activeRate = (active / data.days.length * 100).toFixed(1);
    const recentActive = data.days.slice(-30).filter(day => day.count > 0).length;
    // 摘要写在子图头部行（与柱状图的「共 N 集」同一位置、同一字号），图里只放图。
    const meta = shadow.querySelector('[data-role="heat-meta"]');
    if (meta) meta.innerHTML = homeLayout
      ? `近30天活跃 <b>${recentActive}</b> 天<span class="sep"> · </span>日均 <b>${data.average30 === null ? '—' : data.average30.toFixed(1)}</b> 集`
      : `近一年活跃率 <b>${activeRate}%</b><span class="sep"> · </span>近30天活跃 <b>${recentActive}</b> 天`;
    area.innerHTML = `<div class="hm-scroll">${svg}</div>`;
    drawnWidth = area.clientWidth;
    if (!homeLayout) {
      const wrap = area.querySelector('.hm-scroll');
      setTimeout(() => { wrap.scrollLeft = wrap.scrollWidth; }, 0);
    }
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      area.querySelectorAll('.hm-cell').forEach(rect => { rect.style.opacity = '1'; });
    } else {
      [...area.querySelectorAll('.hm-cell')].reverse().forEach((rect, index) => {
        setTimeout(() => { rect.style.transition = 'opacity .2s ease,transform .15s,filter .15s'; rect.style.opacity = '1'; }, index * 3);
      });
    }
  }
  // Trend chart: episode bars with a smoothed average line, drawn in the
  // ledger's idiom — hairline grid with a solid baseline, integer ticks on a
  // zero-safe log scale (a single binge day would otherwise flatten every
  // ordinary day into a sliver), and a pointer/keyboard readout instead of
  // native tooltips.
  // 一天一根柱子只在窗口够宽时才成立：365 天摊到 780px 上每根不到 1.2px，
  // 画出来是一片毛刺墙，波动本身就是噪声。所以柱子按跨度自动收成
  // 每周/每两周/每月，均线再在桶序列上取 30 天左右的窗口二次平滑。
  const TREND_SERIES = [
    { key: 'count', label: '每日集数', kind: 'bar' },
    { key: 'mean', label: '7 日均线', kind: 'line' },
  ];
  // 只保留有日历意义的粒度：三天一档读起来既不像日也不像周，没有意义。
  const BUCKET_STEPS = [1, 7, 14, 30, 90];
  const UNIT_LABEL = { 1: '日', 7: '周', 14: '两周', 30: '月', 90: '季' };
  const hiddenSeries = new Set();
  let trendGeom = null, trendIndex = -1, trendView = null;

  // 每根桶至少给 5.5px 的横向预算（柱宽约 4px + 缝隙）：低于这个宽度的柱子
  // 会互相糊在一起。窄屏也尽量停在“周”这一档，均线的单位才和宽屏一致；
  // 跨度超过两年就整体退到月桶，回顾视图不该堆上百根柱子。
  function bucketStep(n, plotWidth) {
    if (n <= 60) return 1;
    if (n > 800) return 30;
    const maxBuckets = Math.max(8, Math.floor(plotWidth / 5.5));
    return BUCKET_STEPS.slice(1).find(step => Math.ceil(n / step) <= maxBuckets) || 30;
  }
  // 均线的平滑窗口按“约 30 天”折算成桶数：逐日视图仍是 7 日均线，
  // 周桶 4 窗、双周桶 2 窗，月桶本身已经足够平滑，不再二次平均。
  // 线算的是“每桶平均集数”，和柱子的合计同量纲，不会一高一低各说各话。
  function smoothWindow(step) {
    if (step === 1) return 7;
    return Math.max(2, Math.min(6, Math.round(30 / step)));
  }
  function bucketSpan(bucket) {
    const start = bucket.key.replace(/-/g, '/');
    if (bucket.days === 1) return start;
    const sameYear = bucket.endKey.slice(0, 4) === bucket.key.slice(0, 4);
    return `${start}–${sameYear ? bucket.endKey.slice(5).replace('-', '/') : bucket.endKey.replace(/-/g, '/')}`;
  }

  function trendKey() {
    return `${range}:${state.events.length}:${state.deep ? 1 : 0}:${state.streams.progress.deep ? 1 : 0}:${[...hiddenSeries].sort().join(',')}`;
  }
  // 指针读数：窄柱根本悬不准原生 <title>，改成竖线 + 右上角读数条（与账本一致），
  // 键盘左右方向键也能逐桶查看。元素每次重绘都是新的，直接绑在节点上即可。
  function bindTrend(area) {
    const plot = area.querySelector('.hm-trend-plot'), svg = area.querySelector('svg.hm-trend');
    if (!plot || !svg) return;
    const at = clientX => {
      const bounds = svg.getBoundingClientRect();
      if (!bounds.width || !trendGeom) return -1;
      const pointer = (clientX - bounds.left) / bounds.width * trendGeom.width;
      return Math.max(0, Math.min(trendGeom.n - 1, Math.floor((pointer - trendGeom.bandX0) / trendGeom.band)));
    };
    plot.addEventListener('pointermove', event => showTrend(at(event.clientX)));
    plot.addEventListener('pointerleave', () => showTrend(-1));
    plot.addEventListener('blur', () => showTrend(-1));
    plot.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (!trendGeom) return;
      event.preventDefault();
      const from = trendIndex < 0 ? trendGeom.n - 1 : trendIndex;
      showTrend(Math.max(0, Math.min(trendGeom.n - 1, from + (event.key === 'ArrowLeft' ? -1 : 1))));
    });
  }
  function showTrend(index) {
    const area = shadow.querySelector('.hm-trend-area');
    const guide = area?.querySelector('.hm-guide'), readout = area?.querySelector('.hm-readout');
    if (!guide || !readout) { trendIndex = -1; return; }
    const view = trendView;
    if (index < 0 || !view || !view.buckets.length || !trendGeom) {
      trendIndex = -1; guide.style.display = 'none'; readout.hidden = true; return;
    }
    const bucket = view.buckets[index], count = bucket.count, mean = view.means[index];
    trendIndex = index;
    guide.style.display = '';
    guide.setAttribute('transform', `translate(${trendGeom.x(index).toFixed(2)},0)`);
    const bar = guide.querySelector('.hm-guide-bar'), dot = guide.querySelector('.hm-guide-mean');
    bar.setAttribute('x', '-1.5'); bar.setAttribute('y', (trendGeom.y(count) - 1.5).toFixed(2));
    dot.setAttribute('x', '-1.5'); dot.setAttribute('y', (trendGeom.y(mean) - 1.5).toFixed(2));
    bar.style.display = hiddenSeries.has('count') || !count ? 'none' : '';
    dot.style.display = hiddenSeries.has('mean') ? 'none' : '';
    readout.hidden = false;
    readout.innerHTML = `<time>${bucketSpan(bucket)}</time><span>每${view.unit} <b>${count}</b> 集</span>` +
      `<span>${view.meanLabel} <b>${mean.toFixed(1)}</b></span>`;
  }
  function toggleSeries(key) {
    if (!TREND_SERIES.some(item => item.key === key)) return;
    if (hiddenSeries.has(key)) hiddenSeries.delete(key); else hiddenSeries.add(key);
    trendIndex = -1;
    trendSignature = trendKey();
    drawTrend();
  }
  function drawTrend(useCache = false) {
    if (homeLayout) return false; // 首页只留热力图
    const area = shadow.querySelector('.hm-trend-area');
    if (!area) return false;
    const width = area.clientWidth;
    if (width < 80) return false;
    if (!useCache || !trendSeries) trendSeries = C.dailySeries(state, Date.now(), range);
    trendWidth = width;
    const days = trendSeries.days, n = days.length;
    if (!n) {
      trendGeom = null; trendView = null; trendIndex = -1;
      area.innerHTML = `<div class="hm-fig-head"><h3 class="hm-fig-title">每日活跃</h3><span class="hm-fig-meta hm-trend-total">共 <b>${trendSeries.total}</b> 集</span><div class="hm-fig-controls"><span class="hm-legend"></span><span class="hm-toggle"><button type="button" data-range="year" aria-pressed="${range === 'year'}">近一年</button><button type="button" data-range="all" aria-pressed="${range === 'all'}">全部</button></span></div></div><div class="hm-trend-empty">还没有可统计的进度记录</div>`;
      return true;
    }
    const toggle = `<span class="hm-toggle"><button type="button" data-range="year" aria-pressed="${range === 'year'}">近一年</button><button type="button" data-range="all" aria-pressed="${range === 'all'}">全部</button></span>`;
    const plotH = Math.max(140, Math.min(220, Math.round(width * 0.36)));
    const padL = 36, padR = 8, padT = 12, padB = 22;
    const plotW = Math.max(1, width - padL - padR), height = padT + plotH + padB;
    const step = bucketStep(n, plotW);
    const buckets = C.bucketSeries(days, step);
    const nb = buckets.length;
    const counts = buckets.map(bucket => bucket.count);
    const smoothing = smoothWindow(step);
    const means = smoothing > 1 ? C.rollingMean(counts, smoothing) : counts.slice();
    const unit = UNIT_LABEL[step];
    const meanLabel = smoothing > 1 ? `${smoothing} ${unit}均线` : `${unit}均线`;
    const unitLabel = `每${unit}`;
    // 刻度按“集数”标定：图的面积讲的是记录，均线只是参考线，把它混进
    // 分位数会把压缩力度稀释掉。隐藏集数时才改用均线标定。
    const axis = C.countAxis(hiddenSeries.has('count') ? means : counts);
    const legend = `<span class="hm-legend">${TREND_SERIES.map(item => `<button type="button" class="hm-legend-key" data-series="${item.key}" aria-pressed="${!hiddenSeries.has(item.key)}"><i class="${item.kind === 'line' ? 'line' : ''}" aria-hidden="true"></i><span>${item.key === 'count' ? `${unitLabel}集数` : meanLabel}</span></button>`).join('')}</span>`;
    // 头部行与热力图同构：左标题、中摘要（带统计粒度）、右图例 + 范围切换。
    const head = `<div class="hm-fig-head"><h3 class="hm-fig-title">每日活跃</h3><span class="hm-fig-meta hm-trend-total">共 <b>${trendSeries.total}</b> 集${step > 1 ? ` · 按${unit}` : ''}</span><div class="hm-fig-controls">${legend}${toggle}</div></div>`;
    const y = value => padT + (1 - axis.position(value)) * plotH;
    // 等宽槽位整体居中：桶少时不贴左轴，桶多时自然铺满。
    const band = Math.min(plotW / nb, 64);
    const bandX0 = padL + (plotW - band * nb) / 2;
    const x = index => bandX0 + (index + 0.5) * band;
    // 柱宽留缝 + 圆角：柱墙变粗之后，靠缝隙分隔比靠描边干净。
    const barW = Math.max(1, Math.min(26, band * 0.72));
    const radius = Math.min(2, barW / 3).toFixed(2);
    const base = y(0);

    // 对数轴上的刻度间距不再均匀：按像素筛一遍，太密的丢掉；顶部刻度优先，
    // 16px 是 9px 字号仍能分开的最小行距，22px 会把 40/50 这类中间档连带丢掉。
    const placedTicks = [];
    for (const tick of axis.ticks) {
      const gy = y(tick);
      if (placedTicks.length && Math.abs(gy - placedTicks[placedTicks.length - 1].y) < 16) {
        if (tick !== axis.hi) continue;
        placedTicks.pop();
      }
      placedTicks.push({ tick, y: gy });
    }
    let grid = '';
    for (const { tick, y: tickY } of placedTicks) {
      const gy = tickY.toFixed(1);
      grid += `<line class="hm-grid-line" x1="${padL}" x2="${padL + plotW}" y1="${gy}" y2="${gy}"/>` +
        `<text class="hm-tick" x="${padL - 5}" y="${(Number(gy) + 3).toFixed(1)}" text-anchor="end">${tick}</text>`;
    }
    // 刻度标签从最低一档（5 集）起算，但柱子总要有个落地线，基线单独画。
    grid += `<line class="hm-grid-line zero" x1="${padL}" x2="${padL + plotW}" y1="${base.toFixed(1)}" y2="${base.toFixed(1)}"/>`;
    let bars = '';
    if (!hiddenSeries.has('count')) {
      for (let index = 0; index < nb; index++) {
        if (!counts[index]) continue;
        const top = y(counts[index]);
        bars += `<rect class="hm-bar" x="${(x(index) - barW / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(1, base - top).toFixed(2)}" rx="${radius}"/>`;
      }
    }
    const average = hiddenSeries.has('mean') || nb < 2 ? '' : `<polyline class="hm-mean-line" points="${means.map((value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(' ')}"/>`;
    // 横轴：桶边界不对齐日历，改成“月份变化时标一次”，再按像素抽稀；
    // 跨度超过一年就直接标四位年份，八年历史里的「18/1」会被读成 1 月 1 日。
    const longSpan = n > 400;
    let labels = '', previous = -Infinity, marker = '';
    for (let index = 0; index < nb; index++) {
      const key = buckets[index].key;
      const current = longSpan ? key.slice(0, 4) : key.slice(0, 7);
      if (current === marker) continue;
      marker = current;
      const lx = x(index);
      if (lx - previous < 44) continue;
      previous = lx;
      const text = longSpan ? key.slice(0, 4) : `${Number(key.slice(5, 7))}/${Number(key.slice(8))}`;
      labels += `<text class="hm-axis-label" x="${lx.toFixed(1)}" y="${height - 6}" text-anchor="middle">${text}</text>`;
    }
    const pending = range === 'all' && !state.streams.progress.deep;
    const hint = pending ? `<div class="hm-trend-hint">正在回溯更早的记录，已回溯到 ${days[0].key}…</div>` : '';
    area.innerHTML = head +
      `<div class="hm-trend-plot" tabindex="0" role="img" aria-label="活跃趋势柱状图与${meanLabel}，按${unit}统计，当前${range === 'all' ? '全部' : '近一年'}范围，左右方向键可逐${unit}查看"><svg class="hm-trend" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${grid}${bars}${average}${labels}<g class="hm-guide" style="display:none"><line class="hm-guide-line" x1="0" x2="0" y1="${padT}" y2="${padT + plotH}"/><rect class="hm-guide-bar" width="3" height="3"/><rect class="hm-guide-mean" width="3" height="3"/></g></svg><div class="hm-readout" hidden></div></div>` +
      hint;
    trendView = { buckets, means, step, unit, meanLabel };
    trendGeom = { width, n: nb, band, bandX0, x, y };
    if (trendIndex >= 0) showTrend(Math.min(trendIndex, nb - 1));
    bindTrend(area);
    return true;
  }
  function ensureDeep() {
    if (state.deep || state.streams.progress.deep) return;
    state.deep = true;
    save().catch(() => {});
    idleUntil = 0;
    run();
  }
  function setRange(value) {
    if (value !== 'all' && value !== 'year') return;
    range = value;
    try { localStorage.setItem('bgmtl-chart-range', range); } catch (error) { /* 私密模式忽略 */ }
    if (range === 'all') ensureDeep();
    render();
  }
  function render() {
    if (!shadow) return;
    const data = C.aggregate(state);
    const signature = `${data.end}:${data.days.map(day => `${day.count}/${day.known}`).join(',')}`;
    if (signature !== drawnSignature && (data.total || data.complete)) {
      drawnSignature = signature;
      chartData = data;
      drawHeatmap(data);
    } else if (!data.total && !data.complete && message) {
      const loading = shadow.querySelector('.hm-loading');
      if (loading) loading.textContent = `加载失败：${message}`;
    } else if (!data.total && data.complete) {
      drawnSignature = signature;
      chartData = data;
      drawHeatmap(data);
    }
    const key = trendKey();
    if (key !== trendSignature && drawTrend()) trendSignature = key;
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
        for (const t of C.SYNC_TYPES) {
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
          for (const t of C.SYNC_TYPES) {
            if (aborted || made >= 24) break;
            const s = state.streams[t];
            if (s.complete && !s.refresh && (s.deep || !state.deep)) continue;
            const page = s.refresh?.page || s.page;
            const result = await fetchPage(t, page);
            // A deep backfill has no date cutoff: only the last page completes it.
            const cutoff = state.deep ? 0 : C.dayStart(Date.now()) - 364 * C.DAY;
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
              if (result.next === null || result.oldest < cutoff) {
                s.complete = true;
                if (result.next === null) s.deep = true;
              }
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
      // 深回溯只服务于趋势图，首页没有趋势图就别去翻十几年的旧记录。
      if (!homeLayout && range === 'all') ensureDeep();
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
