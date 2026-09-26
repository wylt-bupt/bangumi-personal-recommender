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
    // Average scores occupy a narrow numeric range, so raw min-max mapping
    // makes everything big and indistinguishable. Rank each score among the
    // observed levels, then apply a steep power curve (like the count cloud's
    // power-law shape): only the top few percent of tags become large while
    // the long tail stays small, which keeps differences readable and the
    // cloud compact. Tied scores share a level and thus the same size.
    const rounded = Math.round(Number(score) * 100) / 100;
    const levels = [...new Set(values.map(value => Math.round(value * 100) / 100))].sort((a, b) => a - b);
    if (levels.length < 2) return 26;
    const percentile = Math.max(0, Math.min(1, levels.indexOf(rounded) / (levels.length - 1)));
    return 12 + 38 * Math.pow(percentile, 4);
  }
  function isTemporalTag(value) {
    const tag = String(value || '').trim().replace(/\s+/g, '');
    return /^(?:19|20)\d{2}(?:年)?$/.test(tag)
      || /^(?:19|20)\d{2}(?:年|[-./])(?:0?[1-9]|1[0-2])(?:月)?(?:番|新番)?$/.test(tag)
      || /^(?:19|20)\d{2}年?(?:春|夏|秋|冬)(?:季|番|新番)?$/.test(tag)
      || /^(?:1|4|7|10)月(?:番|新番)$/.test(tag)
      || /^(?:19|20)\d0s$/i.test(tag);
  }
  function featuredTags(rows) {
    return rows.filter(row => Number(row.count) > 10 && !isTemporalTag(row.name)).sort((a,b) => b.count-a.count || a.name.localeCompare(b.name, 'zh-CN'));
  }
  function overlaps(a, b, gap = 2) {
    return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
  }
  // Traditional oval cloud: every qualified tag is placed and none is dropped.
  // The largest words claim the center and the rest follow a compressed spiral,
  // producing the dense horizontal silhouette used by classic projected word
  // clouds instead of filling the whole rectangular canvas.
  function packCloud(items, width) {
    if (!items.length) return { items: [], height: 0 };
    const order = [...items].sort((a, b) => (b.width * b.height) - (a.width * a.height) || a.index - b.index);
    // Very large sets and narrow screens still get more vertical room. Ordinary
    // desktop clouds target a broad ellipse close to the supplied reference.
    const generous = order.length > 250 ? 1.8 : order.length > 120 ? 1.05 : order.length > 80 ? 0.78 : 0.62;
    const aspectCap = width >= 460 ? generous : Math.max(1.12, generous);
    let best = null;
    for (const scale of [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46]) {
      const attempt = placeOrganic(order, width, scale);
      if (!best || attempt.height < best.height) best = attempt;
      if (attempt.height <= width * aspectCap + 1) break;
    }
    return { items: best.items, height: best.height, scale: best.scale, shape: 'oval', omitted: 0 };
  }
  function placeOrganic(order, width, scale) {
    const sized = order.map(item => ({
      ...item,
      width: Math.max(8, Math.ceil(item.width * scale)),
      height: Math.max(6, Math.ceil(item.height * scale)),
      fitScale: scale
    }));
    const totalArea = sized.reduce((sum, item) => sum + (item.width + 2) * (item.height + 2), 0);
    const centerX = width / 2;
    const centerY = Math.max(88, Math.ceil(totalArea / Math.max(1, width - 16) / 0.72) / 2);
    const cells = new Map(), cellSize = 40;
    const keys = (box, padding = 0) => {
      const result = [];
      for (let x = Math.floor((box.x - padding) / cellSize); x <= Math.floor((box.x + box.width + padding) / cellSize); x++)
        for (let y = Math.floor((box.y - padding) / cellSize); y <= Math.floor((box.y + box.height + padding) / cellSize); y++) result.push(x + ':' + y);
      return result;
    };
    const collides = box => keys(box).some(key => (cells.get(key) || []).some(other => overlaps(box, other)));
    const placed = [];
    let fallbackY = 8;
    for (const item of sized) {
      const seed = Math.abs(Number(item.seed) || item.index + 1);
      const phase = (seed % 6283) / 1000;
      const direction = seed % 2 ? 1 : -1;
      const angularStep = 0.31 + (seed % 11) / 100;
      let box;
      // The vertical component is deliberately compressed: the words themselves
      // define an oval outline while remaining ordinary accessible DOM buttons.
      for (let step = 0; step < 6000; step++) {
        const angle = phase + direction * step * angularStep;
        const radius = step * 0.72;
        const x = centerX + Math.cos(angle) * radius - item.width / 2;
        const y = centerY + Math.sin(angle) * radius * 0.52 - item.height / 2;
        if (x < 8 || x + item.width > width - 8 || y < 8) continue;
        const candidate = { ...item, x, y };
        if (!collides(candidate)) { box = candidate; break; }
      }
      if (!box) {
        // Guaranteed lane below the cloud: a qualified word is never dropped.
        box = { ...item, x: Math.max(4, (width - item.width) / 2), y: fallbackY };
      }
      fallbackY = Math.max(fallbackY, box.y + box.height + 3);
      placed.push(box);
      // Registration padding must exceed the collision gap (2): a pair sitting
      // 1.x px apart could otherwise land in adjacent grid cells and slip
      // through the collision check.
      for (const key of keys(box, 3)) {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(box);
      }
    }
    // Re-center vertically so the cloud fills its frame instead of drifting.
    const minY = Math.min(...placed.map(box => box.y));
    if (minY > 8) for (const box of placed) box.y -= minY - 8;
    const height = Math.ceil(Math.max(...placed.map(box => box.y + box.height))) + 8;
    return { items: placed, height, scale };
  }
  const api = { yearSeries, axis, fontSize, scoreFontSize, isTemporalTag, featuredTags, overlaps, packCloud };
  global.BangumiStatsViz = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
