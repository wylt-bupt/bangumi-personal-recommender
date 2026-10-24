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
    @container (max-width:460px){#hm-dashboard .hm-fig-controls{margin-left:0}}
    /* 图例：色阶（热力图，展示用）与系列开关（柱状图）同一行高、同一字号、同一记号尺寸 */
    #hm-dashboard .hm-legend,#hm-dashboard .hm-scale{display:inline-flex;align-items:center;gap:2px;font-size:11px;color:var(--hm-text-dim);white-space:nowrap}
    #hm-dashboard .hm-legend-key{display:inline-flex;align-items:center;gap:5px;min-height:24px;padding:0 3px;border:1px solid transparent;border-radius:4px;background:transparent;color:var(--hm-text-dim);font:inherit;font-size:11px;cursor:pointer}
    #hm-dashboard .hm-legend-key i{display:block;width:8px;height:8px;flex:none;border:1px solid var(--hm-border);border-radius:1px;background:var(--hm-accent)}
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
    /* 动量：势头用文字表达，涨粉、跌灰，不往图里添墨。 */
    #hm-dashboard .hm-delta{white-space:nowrap}
    #hm-dashboard .hm-delta.up{color:var(--hm-accent)}
    #hm-dashboard .hm-delta.down{color:var(--hm-text-dim)}
    #hm-dashboard .hm-trend-plot{position:relative}
    #hm-dashboard .hm-trend-plot:focus-visible{outline:1px solid var(--hm-accent);outline-offset:3px}
    #hm-dashboard .hm-trend{display:block;width:100%;height:auto}
    /* 网格：发丝虚线，零线转实线——基线要能被眼睛抓住。 */
    #hm-dashboard .hm-grid-line{stroke:var(--hm-border);stroke-width:1;stroke-dasharray:3 4}
    #hm-dashboard .hm-grid-line.zero{stroke:var(--hm-text-dim);stroke-dasharray:none;opacity:.55}
    #hm-dashboard .hm-tick,#hm-dashboard .hm-axis-label{fill:var(--hm-text-dim);font:9px Arial,"Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums}
    #hm-dashboard .hm-month-label{fill:var(--hm-text-dim);font:600 9px Arial,"Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums}
    /* 柱子按周/月聚合后比原来粗，靠留缝分隔，圆角让柱墙不显得生硬。
       峰值桶用色阶最深的一档并标真值，是整张图的视觉入口；封顶桶顶部
       加一条深色切角帽，说明“这条被截断了”，读数条里有完整数字。 */
    #hm-dashboard .hm-bar{fill:var(--hm-accent)}
    #hm-dashboard .hm-bar.peak,#hm-dashboard .hm-bar-cap{fill:var(--hm-cell-l3)}
    #hm-dashboard .hm-peak-label{fill:var(--hm-text-dim);font:600 9px Arial,"Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums}
    #hm-dashboard .hm-guide-line{stroke:var(--hm-text-dim);stroke-width:1;stroke-dasharray:2 3}
    #hm-dashboard .hm-guide-bar{fill:var(--hm-accent)}
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
  // Trend chart: weekly/monthly totals as honest-length bars, drawn in the
  // ledger's idiom — a few hairline gridlines with a solid baseline, a linear
  // axis where height ∝ episodes (extreme binge buckets are capped at the
  // ceiling and labelled rather than squeezed by a log transform), and a
  // pointer/keyboard readout instead of native tooltips.
  // 趋势图与热力图分工：热力图回答“哪天看了多少”，这里回答宏观三件事——
  // 势头（动量进标题行文字，不画进图）、周/月之间的体量对比、补番爆发的
  // 位置与强度。柱子按日历周（周一起）/自然月聚合，长度与集数严格成正比；
  // 峰值桶深色并标真值，超过轴顶的爆发桶封顶加切角帽。只有 ≤60 天的日粒度
  // （新账号）才保留零安全对数轴——20 倍的按日偏态线性轴罩不住。
  const UNIT_LABEL = { day: '日', week: '周', month: '月' };
  const hiddenSeries = new Set();
  let trendGeom = null, trendIndex = -1, trendView = null;

  // 粒度由数据跨度与绘图区宽度决定：≤60 天逐日；跨两年以上、或周桶挤不进
  // 每桶 5.5px 的横向预算时退到自然月；其余一律日历周。
  function trendGrain(n, plotWidth) {
    if (n <= 60) return 'day';
    if (n > 800 || Math.ceil(n / 7) * 5.5 > plotWidth) return 'month';
    return 'week';
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
    const bucket = view.buckets[index], count = bucket.count;
    trendIndex = index;
    guide.style.display = '';
    guide.setAttribute('transform', `translate(${trendGeom.x(index).toFixed(2)},0)`);
    const bar = guide.querySelector('.hm-guide-bar');
    bar.setAttribute('x', '-1.5'); bar.setAttribute('y', (trendGeom.y(count) - 1.5).toFixed(2));
    bar.style.display = hiddenSeries.has('count') || !count ? 'none' : '';
    const current = index === view.buckets.length - 1 ? `（${view.unit === '月' ? '本月' : view.unit === '周' ? '本周' : '今日'}）` : '';
    readout.hidden = false;
    readout.innerHTML = `<time>${bucketSpan(bucket)}</time><span>每${view.unit} <b>${count}</b> 集${current}</span>`;
  }
  function toggleSeries(key) {
    if (key !== 'count') return;
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
    // padT 留出峰值真值标签（9px）的呼吸空间。
    const padL = 36, padR = 8, padT = 18, padB = 22;
    const plotW = Math.max(1, width - padL - padR), height = padT + plotH + padB;
    const grain = trendGrain(n, plotW);
    const buckets = grain === 'day' ? C.bucketSeries(days, 1) : C.calendarBuckets(days, grain);
    const nb = buckets.length;
    const counts = buckets.map(bucket => bucket.count);
    const unit = UNIT_LABEL[grain];
    const unitLabel = `每${unit}`;
    // 轴随粒度走：逐日 20 倍偏态用零安全对数轴；周/月桶用线性轴，长度恢复
    // “与集数成正比”的比较契约，剩余偏态交给封顶与峰值标注。
    const axis = grain === 'day' ? C.countAxis(counts) : C.volumeAxis(counts);
    // 势头是趋势图的职责之一，但它是派生统计：一行文字说得比一条叠在柱上
    // 的折线更准。只统计完整桶，当前周/月不参与。
    const trend = C.momentum(buckets, 4);
    const momentumChip = trend.recent == null || trend.count < 8 ? '' :
      ` · 近4${unit} 均<b>${Number(trend.recent.toFixed(1))}</b> 集/${unit}` +
      (trend.delta == null ? '' : ` <span class="hm-delta ${trend.delta >= 0 ? 'up' : 'down'}">${trend.delta >= 0 ? '↑' : '↓'}${Math.abs(Math.round(trend.delta * 100))}%</span>`);
    const legend = `<span class="hm-legend"><button type="button" class="hm-legend-key" data-series="count" aria-pressed="${!hiddenSeries.has('count')}"><i aria-hidden="true"></i><span>${unitLabel}集数</span></button></span>`;
    // 头部行与热力图同构：左标题、中摘要（合计、粒度、动量）、右图例 + 范围切换。
    const head = `<div class="hm-fig-head"><h3 class="hm-fig-title">每日活跃</h3><span class="hm-fig-meta hm-trend-total">共 <b>${trendSeries.total}</b> 集${grain !== 'day' ? ` · 按${unit}` : ''}${momentumChip}</span><div class="hm-fig-controls">${legend}${toggle}</div></div>`;
    const y = value => padT + (1 - axis.position(value)) * plotH;
    // 等宽槽位整体居中：桶少时不贴左轴，桶多时自然铺满。
    const band = Math.min(plotW / nb, 64);
    const bandX0 = padL + (plotW - band * nb) / 2;
    const x = index => bandX0 + (index + 0.5) * band;
    // 柱宽留缝 + 圆角：柱墙变粗之后，靠缝隙分隔比靠描边干净。
    const barW = Math.max(1, Math.min(26, band * 0.72));
    const radius = Math.min(2, barW / 3).toFixed(2);
    const base = y(0);
    // 峰值桶是整张图的视觉入口：深色 + 顶部真值，一眼知道最猛的一段在哪。
    let peakIndex = -1, peakValue = 0;
    for (let index = 0; index < nb; index++) {
      if (counts[index] > peakValue) { peakValue = counts[index]; peakIndex = index; }
    }

    // 线性轴的刻度间距均匀，16px 抽稀一般不会触发；保留同一套逻辑兜底
    // （日粒度对数轴与极窄容器仍需要），顶部刻度优先。
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
    // 刻度标签从最低一档起算，但柱子总要有个落地线，基线单独画。
    grid += `<line class="hm-grid-line zero" x1="${padL}" x2="${padL + plotW}" y1="${base.toFixed(1)}" y2="${base.toFixed(1)}"/>`;
    let bars = '';
    if (!hiddenSeries.has('count')) {
      for (let index = 0; index < nb; index++) {
        if (!counts[index]) continue;
        // 爆发桶超出轴顶：柱子封顶画到头，切角帽标出“这不是全部”，峰值
        // 桶再标真值——截断是显式的，读数条里也拿得到完整数字。
        const clipped = axis.cap && counts[index] > axis.hi;
        const top = clipped ? padT : y(counts[index]);
        const classes = ['hm-bar'];
        if (index === peakIndex) classes.push('peak');
        if (clipped) classes.push('capped');
        bars += `<rect class="${classes.join(' ')}" x="${(x(index) - barW / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(1, base - top).toFixed(2)}" rx="${radius}"/>`;
        if (clipped) bars += `<rect class="hm-bar-cap" x="${(x(index) - barW / 2).toFixed(2)}" y="${padT.toFixed(2)}" width="${barW.toFixed(2)}" height="2.5"/>`;
        if (index === peakIndex) bars += `<text class="hm-peak-label" x="${x(index).toFixed(1)}" y="${(clipped ? padT - 4 : top - 4).toFixed(1)}" text-anchor="middle">${peakValue}</text>`;
      }
    }
    // 横轴由日历桶驱动：周桶在月份变化处标 M/D（落在真实周一上），月桶在
    // 每年 1 月标四位年份，日桶沿用按月变化标 M/D。按像素抽稀保留。
    const yearLabels = grain === 'month';
    let labels = '', previous = -Infinity, marker = '';
    for (let index = 0; index < nb; index++) {
      const key = buckets[index].key;
      const current = yearLabels ? key.slice(0, 4) : key.slice(0, 7);
      if (current === marker) continue;
      marker = current;
      if (yearLabels && key.slice(5, 7) !== '01') continue;
      const lx = x(index);
      if (lx - previous < 44) continue;
      previous = lx;
      const text = yearLabels ? key.slice(0, 4) : `${Number(key.slice(5, 7))}/${Number(key.slice(8))}`;
      labels += `<text class="hm-axis-label" x="${lx.toFixed(1)}" y="${height - 6}" text-anchor="middle">${text}</text>`;
    }
    const pending = range === 'all' && !state.streams.progress.deep;
    const hint = pending ? `<div class="hm-trend-hint">正在回溯更早的记录，已回溯到 ${days[0].key}…</div>` : '';
    area.innerHTML = head +
      `<div class="hm-trend-plot" tabindex="0" role="img" aria-label="活跃趋势柱状图，按${unit}统计，当前${range === 'all' ? '全部' : '近一年'}范围，左右方向键可逐${unit}查看"><svg class="hm-trend" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${grid}${bars}${labels}<g class="hm-guide" style="display:none"><line class="hm-guide-line" x1="0" x2="0" y1="${padT}" y2="${padT + plotH}"/><rect class="hm-guide-bar" width="3" height="3"/></g></svg><div class="hm-readout" hidden></div></div>` +
      hint;
    trendView = { buckets, unit, grain };
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
