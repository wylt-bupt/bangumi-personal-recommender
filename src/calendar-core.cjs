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
  function weekDates(now = new Date()) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    return Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(day); date.setDate(date.getDate() + offset);
      return { weekday: date.getDay() || 7, date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, label: `${date.getMonth() + 1}/${date.getDate()}`, relative: offset === 0 ? '今天' : offset === 1 ? '明天' : '' };
    });
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
  return { labels, weekdays, routes, imageURL, normalizeCalendar, normalizeCollections, intersect, weekDates, collectPublic, parseCalendarDocument, parseCollectionDocument };
});
