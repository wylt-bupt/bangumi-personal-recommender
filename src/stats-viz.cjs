(function attachStatsViz(global) {
  'use strict';
  // Pure geometry: no libraries, network access, or changes to collection data.
  function yearSeries(rows) {
    const counts = new Map(rows.filter(row => /^\d{4}$/.test(String(row.year))).map(row => [Number(row.year), Math.max(0, Number(row.count) || 0)]));
    if (!counts.size) return [];
    const first = Math.min(...counts.keys()), last = Math.max(...counts.keys());
    return Array.from({ length: last - first + 1 }, (_, index) => ({ year: last - index, count: counts.get(last - index) || 0 }));
  }
  function axis(maximum) {
    const raw = Math.max(1, maximum) / 4;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const step = Math.max(1, Math.ceil([1, 2, 2.5, 5, 10].map(n => n * magnitude).find(n => n >= raw)));
    return { max: step * 4, ticks: Array.from({ length: 5 }, (_, i) => step * i) };
  }
  function fontSize(count, min, max) {
    return max === min ? 32 : 14 + 58 * Math.pow(Math.max(0, Math.min(1, (count - min) / (max - min))), 0.85);
  }
  function featuredTags(rows) {
    return rows.filter(row => Number(row.count) > 10).sort((a,b) => b.count-a.count || a.name.localeCompare(b.name, 'zh-CN'));
  }
  function seasonDistribution(rows) {
    const groups = [1,4,7,10].map((month, index) => ({ month, label: month + ' 月番', season: ['冬','春','夏','秋'][index], count: 0, rated: 0, scoreSum: 0 }));
    let unknown = 0;
    for (const row of rows) {
      const match = String(row.subject?.date || '').match(/^\d{4}-(\d{2})(?:-|$)/);
      const month = Number(match?.[1]);
      if (!Number.isInteger(month) || month < 1 || month > 12) { unknown++; continue; }
      const group = groups[Math.floor((month - 1) / 3)];
      group.count++;
      const rate = Number(row.rate);
      if (rate > 0 && rate <= 10) { group.rated++; group.scoreSum += rate; }
    }
    const total = groups.reduce((sum, group) => sum + group.count, 0);
    return { total, unknown, groups: groups.map(group => ({ ...group, share: total ? group.count / total : 0, average: group.rated ? group.scoreSum / group.rated : null })) };
  }
  function overlaps(a, b, gap = 5) {
    return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
  }
  function episodeDistribution(rows) {
    const counts = new Map();
    for (const row of rows) {
      const eps = Number(row.eps);
      if (Number.isInteger(eps) && eps > 0) counts.set(eps, (counts.get(eps) || 0) + 1);
    }
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const ranked = [...counts].map(([eps, count]) => ({ eps, count })).sort((a, b) => b.count - a.count || a.eps - b.eps);
    // At most five common episode counts plus one combined low-frequency slice.
    const common = ranked.filter(row => row.count / total >= 0.03).slice(0, 5);
    const kept = new Set(common.map(row => row.eps));
    const rest = ranked.filter(row => !kept.has(row.eps));
    const groups = common.map(row => ({ ...row, label: row.eps + ' 话' }));
    if (rest.length) groups.push({ label: '其他', count: rest.reduce((sum, row) => sum + row.count, 0), members: rest.sort((a,b) => a.eps-b.eps) });
    return { total, groups: groups.map(row => ({ ...row, share: row.count / total })) };
  }
  function pieSlices(groups) {
    let position = -Math.PI / 2;
    return groups.map(group => {
      const angle = group.share * 2 * Math.PI, end = position + angle;
      const startPoint = [120 + 110 * Math.cos(position), 120 + 110 * Math.sin(position)];
      const endPoint = [120 + 110 * Math.cos(end), 120 + 110 * Math.sin(end)];
      const path = group.share >= 1 - 1e-10 ? 'M120 10 A110 110 0 1 1 120 230 A110 110 0 1 1 120 10 Z'
        : 'M120 120 L' + startPoint.join(' ') + ' A110 110 0 ' + (angle > Math.PI ? 1 : 0) + ' 1 ' + endPoint.join(' ') + ' Z';
      const middle = position + angle / 2;
      position = end;
      return { ...group, path, labelX: 120 + 73 * Math.cos(middle), labelY: 120 + 73 * Math.sin(middle) };
    });
  }
  function packCloud(items, width) {
    if (!items.length) return { items: [], height: 0 };
    if (items.length > 100) return packDenseCloud(items, width);
    const area = items.reduce((sum, item) => sum + (item.width + 8) * (item.height + 8), 0);
    const height = Math.max(220, Math.ceil(area / Math.max(1, width - 16) / 0.58));
    const placed = [];
    const cells = new Map(), cellSize = 64;
    const keys = (box, padding = 0) => {
      const result = [];
      for (let x = Math.floor((box.x - padding) / cellSize); x <= Math.floor((box.x + box.width + padding) / cellSize); x++)
        for (let y = Math.floor((box.y - padding) / cellSize); y <= Math.floor((box.y + box.height + padding) / cellSize); y++) result.push(x + ':' + y);
      return result;
    };
    const collides = box => keys(box).some(key => (cells.get(key) || []).some(other => overlaps(box, other)));
    let bottom = height;
    for (const item of items) {
      let box;
      // Deterministic elliptical spiral: the most frequent term stays central.
      for (let step = 0; step < 2200; step++) {
        const angle = step * 0.38, radius = Math.sqrt(step / 2200) * 0.75;
        const candidate = { ...item, x: (width - item.width) / 2 + Math.cos(angle) * radius * width, y: (height - item.height) / 2 + Math.sin(angle) * radius * height };
        if (candidate.x < 8 || candidate.x + item.width > width - 8 || candidate.y < 8 || candidate.y + item.height > height - 8) continue;
        if (!collides(candidate)) { box = candidate; break; }
      }
      // A non-overlapping fallback keeps unusually long labels; nothing is dropped.
      if (!box) { box = { ...item, x: Math.max(8, (width - item.width) / 2), y: bottom + 8 }; bottom += item.height + 8; }
      placed.push(box);
      for (const key of keys(box, 5)) {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(box);
      }
    }
    const top = Math.min(...placed.map(item => item.y));
    const end = Math.max(...placed.map(item => item.y + item.height));
    const actualHeight = Math.max(220, end - top + 24);
    return { items: placed.map(item => ({ ...item, y: item.y - top + (actualHeight - (end - top)) / 2 })), height: actualHeight };
  }
  function packDenseCloud(items, width) {
    // Complete clouds can contain hundreds of rare tags. Free-rectangle packing
    // avoids the long fallback tail of a bounded spiral without dropping tags.
    const area = items.reduce((sum, item) => sum + (item.width + 5) * (item.height + 5), 0);
    let height = Math.max(220, Math.ceil(area / Math.max(1, width - 16) / 0.72));
    const focusY = Math.min(180, height / 2);
    let free = [{ x: 8, y: 8, width: width - 16, height: height - 16 }];
    const placed = [];
    for (const item of items) {
      const w = Math.min(width - 16, item.width + 5), h = item.height + 5;
      let best;
      for (const rect of free) {
        if (rect.width < w || rect.height < h) continue;
        const x = Math.max(rect.x, Math.min((width - w) / 2, rect.x + rect.width - w));
        const y = Math.max(rect.y, Math.min(focusY - h / 2, rect.y + rect.height - h));
        const distance = ((x + w / 2 - width / 2) / width) ** 2 + ((y + h / 2 - focusY) / Math.min(height, width)) ** 2;
        if (!best || distance < best.distance) best = { x, y, width: w, height: h, distance };
      }
      if (!best) {
        free.push({ x: 8, y: height, width: width - 16, height: h });
        best = { x: 8, y: height, width: w, height: h };
        height += h;
      }
      const split = [];
      for (const r of free) {
        if (!overlaps(r, best, 0)) { split.push(r); continue; }
        if (best.x > r.x) split.push({ ...r, width: best.x - r.x });
        if (best.x + w < r.x + r.width) split.push({ ...r, x: best.x + w, width: r.x + r.width - best.x - w });
        if (best.y > r.y) split.push({ ...r, height: best.y - r.y });
        if (best.y + h < r.y + r.height) split.push({ ...r, y: best.y + h, height: r.y + r.height - best.y - h });
      }
      free = split.filter((a, i) => !split.some((b, j) => i !== j && a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height && (j < i || a.width !== b.width || a.height !== b.height)));
      placed.push({ ...item, x: best.x, y: best.y });
    }
    return { items: placed, height: Math.max(...placed.map(item => item.y + item.height)) + 12 };
  }
  const api = { yearSeries, axis, fontSize, featuredTags, seasonDistribution, overlaps, packCloud, episodeDistribution, pieSlices };
  global.BangumiStatsViz = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
