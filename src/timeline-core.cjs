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
