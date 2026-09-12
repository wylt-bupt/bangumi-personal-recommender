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
    return max === min ? 30 : 12 + 38 * Math.pow(Math.max(0, Math.min(1, (count - min) / (max - min))), 0.82);
  }
  function scoreFontSize(score, scores) {
    const values = (Array.isArray(scores) ? scores : []).map(Number).filter(Number.isFinite);
    if (values.length < 2) return 26;
    // Average scores occupy a narrow numeric range. Use their empirical percentile
    // for visual weight, while keeping the exact score in the label/tooltip.
    const rounded = Math.round(Number(score) * 100) / 100;
    const levels = [...new Set(values.map(value => Math.round(value * 100) / 100))].sort((a, b) => a - b);
    if (levels.length < 2) return 26;
    const percentile = Math.max(0, Math.min(1, levels.indexOf(rounded) / (levels.length - 1)));
    return 13 + 35 * Math.pow(percentile, 1.65);
  }
  function isTemporalTag(value) {
    const tag = String(value || '').trim().replace(/\s+/g, '');
    return /^(?:19|20)\d{2}(?:年)?$/.test(tag)
      || /^(?:19|20)\d{2}(?:年|[-./])(?:0?[1-9]|1[0-2])(?:月)?(?:番|新番)?$/.test(tag)
      || /^(?:19|20)\d{2}年?(?:春|夏|秋|冬)(?:季|番|新番)?$/.test(tag)
      || /^(?:1|4|7|10)月(?:番|新番)$/.test(tag);
  }
  function featuredTags(rows) {
    return rows.filter(row => Number(row.count) > 10 && !isTemporalTag(row.name)).sort((a,b) => b.count-a.count || a.name.localeCompare(b.name, 'zh-CN'));
  }
  function circularItems(items, width, spread = false) {
    if (!items.length) return items;
    if (width >= 460) return items;
    const radius = Math.max(1, (width - 20) / 2);
    const budget = Math.PI * radius * radius * (width < 460 ? 0.38 : 0.36);
    const candidates = spread
      ? items.flatMap((_, index) => index >= Math.ceil(items.length / 2) ? [] : [items[index], items[items.length - 1 - index]]).filter((item, index, rows) => rows.indexOf(item) === index)
      : items;
    const selected = [];
    let area = 0;
    for (const item of candidates) {
      const next = (item.width + 5) * (item.height + 5);
      if (selected.length >= 8 && area + next > budget) {
        if (!spread) break;
        continue;
      }
      area += next;
      selected.push(item);
    }
    return selected.sort((a, b) => a.index - b.index);
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
    const baseHeight = Math.max(width * 1.02, 260);
    const maximumHeight = Math.max(width * 1.08, 260);
    const tryEllipse = (candidates, currentHeight, scale) => {
      candidates = candidates.map(item => ({
        ...item,
        width: Math.ceil(item.width * scale),
        height: Math.ceil(item.height * scale),
        fitScale: scale
      }));
      const placed = [];
      const cells = new Map(), cellSize = 56;
      const keys = (box, padding = 0) => {
        const result = [];
        for (let x = Math.floor((box.x - padding) / cellSize); x <= Math.floor((box.x + box.width + padding) / cellSize); x++)
          for (let y = Math.floor((box.y - padding) / cellSize); y <= Math.floor((box.y + box.height + padding) / cellSize); y++) result.push(x + ':' + y);
        return result;
      };
      const collides = box => keys(box).some(key => (cells.get(key) || []).some(other => overlaps(box, other)));
      const insideEllipse = box => {
        const radiusX = width / 2 - 8, radiusY = currentHeight / 2 - 8;
        const distanceX = Math.abs(box.x + box.width / 2 - width / 2) + box.width / 2;
        const distanceY = Math.abs(box.y + box.height / 2 - currentHeight / 2) + box.height / 2;
        return (distanceX / radiusX) ** 2 + (distanceY / radiusY) ** 2 <= 1;
      };
      for (const item of candidates) {
        let box;
        const seed = Math.abs(Number(item.seed) || item.index + 1);
        const phase = (seed % 6283) / 1000;
        const direction = seed % 2 ? 1 : -1;
        const angularStep = 0.31 + (seed % 11) / 100;
        for (let step = 0; step < 5200; step++) {
          const progress = step / 5200;
          const angle = phase + direction * step * angularStep;
          const radius = Math.pow(progress, 0.57);
          const candidate = {
            ...item,
            x: (width - item.width) / 2 + Math.cos(angle) * radius * (width / 2 - 10 - item.width / 2),
            y: (currentHeight - item.height) / 2 + Math.sin(angle) * radius * (currentHeight / 2 - 10 - item.height / 2)
          };
          if (insideEllipse(candidate) && !collides(candidate)) { box = candidate; break; }
        }
        if (!box) return null;
        placed.push(box);
        for (const key of keys(box, 5)) {
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(box);
        }
      }
      return placed;
    };
    let candidates = items.slice(), reduced = false;
    while (candidates.length) {
      const scales = reduced ? [0.78, 0.72] : [1, 0.92, 0.85, 0.78, 0.72];
      for (const scale of scales) {
        for (let attempt = 0; attempt < 4; attempt++) {
          const height = Math.ceil(Math.min(maximumHeight, baseHeight + width * 0.02 * attempt));
          const placed = tryEllipse(candidates, height, scale);
          if (placed) return { items: placed, height, scale, shape: 'ellipse', omitted: items.length - candidates.length };
        }
      }
      if (candidates.length <= 8) break;
      candidates = candidates.slice(0, Math.max(8, candidates.length - Math.max(1, Math.ceil(candidates.length * 0.1))));
      reduced = true;
    }
    return packDenseCloud(candidates, width);
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
      const seed = Math.abs(Number(item.seed) || item.index + 1);
      const phase = (seed % 6283) / 1000;
      const targetX = width / 2 + Math.cos(phase) * width * 0.17;
      const targetY = focusY + Math.sin(phase) * Math.min(width, height) * 0.12;
      let best;
      for (const rect of free) {
        if (rect.width < w || rect.height < h) continue;
        const x = Math.max(rect.x, Math.min(targetX - w / 2, rect.x + rect.width - w));
        const y = Math.max(rect.y, Math.min(targetY - h / 2, rect.y + rect.height - h));
        const distance = ((x + w / 2 - targetX) / width) ** 2 + ((y + h / 2 - targetY) / Math.min(height, width)) ** 2;
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
  const api = { yearSeries, axis, fontSize, scoreFontSize, isTemporalTag, featuredTags, circularItems, overlaps, packCloud, episodeDistribution, pieSlices };
  global.BangumiStatsViz = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
