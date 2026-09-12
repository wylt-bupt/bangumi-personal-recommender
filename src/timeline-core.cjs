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
