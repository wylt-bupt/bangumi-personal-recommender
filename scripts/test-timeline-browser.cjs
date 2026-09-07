// Isolated headless Chrome; every bgm.tv request is fulfilled by local fixtures.
const { chromium } = require('playwright');
const { readFile } = require('node:fs/promises');
const assert = require('node:assert/strict');
const path = require('node:path');
const stamp = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const codePath = path.resolve('dist/bangumi-personal-timeline.user.js');
const now = Date.now();

function fixture(type, page, extra = false) {
  const base = type === 'subject' ? 100 : 200;
  const rows = page === 1 ? [0, 1, 2].map(i => ({ id: base + i, time: now - (i + 1) * 86400000 })) : [{ id: base + 4, time: now - 400 * 86400000 }];
  if (extra && page === 1) rows.unshift({ id: base + 10, time: now - 3600000 });
  return `<html><a href="/user/wylt">wylt</a><div id="timeline"><ul>${rows.map((event, i) => `<li id="tml_${event.id}"><span class="info_full">看过 <a href="/subject/${i + 1}">作品 &lt;img onerror=alert(1)&gt;</a><div class="card"><img src="https://never-request.invalid/cover.jpg"><a href="/subject/${i + 1}">封面</a></div><div class="date"><span title="${stamp(event.time)}">昨天</span> · ${i % 2 ? '<a href="/dev/app/1">API</a>' : 'web'}</div></span></li>`).join('')}</ul></div>${page === 1 ? `<a href="/user/wylt/timeline?type=${type}&page=2">下一页 ››</a>` : ''}</html>`;
}

const rootHTML = '<!doctype html><html lang="zh-CN" data-theme="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;background:#fafafa}#columnHomeB{width:min(100%,820px);margin:auto}</style><div id="dock"><a href="https://bgm.tv/user/wylt" title="时光机">wylt</a></div><div id="columnHomeB" class="column"></div></html>';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const code = await readFile(codePath, 'utf8');
  const context = await browser.newContext();
  let fail = false, extra = false, requests = [], inflight = 0, maxInflight = 0;
  const errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (url.origin !== 'https://bgm.tv') throw new Error(`Unexpected external request: ${url.href}`);
    if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: rootHTML });
    assert.equal(url.pathname, '/user/wylt/timeline');
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    await new Promise(resolve => setTimeout(resolve, 30));
    await route.fulfill({ status: fail ? 429 : 200, contentType: 'text/html', body: fail ? 'Rate limited' : fixture(url.searchParams.get('type'), Number(url.searchParams.get('page')), extra) });
    inflight--;
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const load = async target => { await target.goto('https://bgm.tv/'); await target.addScriptTag({ content: code }); await target.locator('#bgmtl-personal').waitFor(); };
  const prepareRefresh = () => page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('bangumi-personal-timeline', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const database = req.result, tx = database.transaction('state', 'readwrite'), store = tx.objectStore('state'), get = store.get('wylt');
      get.onsuccess = () => {
        const value = get.result;
        value.retryAt = 0;
        for (const stream of Object.values(value.streams)) { stream.headAt = 0; delete stream.refresh; }
        store.put(value, 'wylt');
      };
      tx.oncomplete = () => { database.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  const readState = () => page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('bangumi-personal-timeline', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const database = req.result, get = database.transaction('state').objectStore('state').get('wylt');
      get.onsuccess = () => { database.close(); resolve(get.result); };
      get.onerror = () => reject(get.error);
    };
  }));
  try {
    await load(page);
    const peer = await context.newPage(); await load(peer);
    await page.locator('.hm-cell').first().waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForFunction(() => new Promise(resolve => {
      const req = indexedDB.open('bangumi-personal-timeline', 1);
      req.onsuccess = () => { const get = req.result.transaction('state').objectStore('state').get('wylt'); get.onsuccess = () => resolve(Object.values(get.result.streams).every(stream => stream.complete)); };
    }), null, { timeout: 60000 });
    assert.equal(maxInflight, 1, 'only one tab may sync at a time');
    const cellCount = await page.locator('.hm-cell').count();
    assert.ok(cellCount >= 365 && cellCount <= 371, `expected a complete aligned year, got ${cellCount} cells`);
    assert.equal(await page.locator('button,nav,details,input,.platform-row,.week-row').count(), 0, 'the component exposes only the heatmap');
    assert.equal(await page.locator('h2').textContent(), '时光机统计');
    assert.equal(await page.locator('#hm-dashboard p').count(), 0, 'no redundant subtitle copy');
    assert.equal(await page.locator('.hm-chart-area i').count(), 4);
    assert.match(await page.locator('.hm-chart-area').textContent(), /近1年活跃率:\s*0\.8%\s*·\s*近30天活跃:\s*3\s*天少多/);
    assert.equal(await page.locator('img').count(), 0, 'remote covers never enter live DOM');
    const style = await page.locator('#hm-dashboard').evaluate(element => {
      const computed = getComputedStyle(element);
      const title = getComputedStyle(element.querySelector('h2'));
      const cellWidth = element.querySelector('.hm-cell').getAttribute('width');
      return { padding: computed.padding, radius: computed.borderRadius, titleSize: title.fontSize, titleColor: title.color, cellWidth };
    });
    assert.equal(style.padding, '12px 15px'); assert.equal(style.radius, '10px');
    assert.equal(style.titleSize, '14px'); assert.equal(style.titleColor, 'rgb(240, 145, 153)');
    assert.equal(style.cellWidth, '9.5');
    const heatColors = await page.locator('#hm-dashboard').evaluate(element => ['empty', 'l1', 'l2', 'l3'].map(level => getComputedStyle(element).getPropertyValue(`--hm-cell-${level}`).trim()));
    assert.deepEqual(heatColors, ['#f2f2f2', '#f8cdd4', '#ed7790', '#c83d64']);
    await page.waitForTimeout(1300);
    assert.ok(await page.locator('.hm-scroll').evaluate(element => element.scrollWidth <= element.clientWidth || (element.scrollLeft > 0 && element.scrollLeft + element.clientWidth >= element.scrollWidth - 2)));
    await peer.close();

    const parserResult = await page.evaluate(({ html }) => {
      const core = BangumiTimelineCore;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const parsed = core.parsePage(doc, 'subject', 1, location.origin, 'wylt');
      const rejects = [];
      for (const bad of [html.replace('page=2', 'page=8'), html.replace(/title="\d{4}[^"]+"/g, ''), '<html>Login</html>']) {
        try { core.parsePage(new DOMParser().parseFromString(bad, 'text/html'), 'subject', 1, location.origin, 'wylt'); rejects.push(false); } catch { rejects.push(true); }
      }
      return { count: parsed.events.length, source: parsed.events[1].source, text: parsed.events[0].text, rejects };
    }, { html: fixture('subject', 1) });
    assert.equal(parserResult.count, 3); assert.equal(parserResult.source, 'API');
    assert.ok(!parserResult.text.includes('封面')); assert.deepEqual(parserResult.rejects, [true, true, true]);

    for (const [width, height, theme] of [[1200, 900, 'light'], [375, 812, 'light'], [667, 375, 'light'], [1200, 900, 'dark']]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      assert.ok(await page.locator('#hm-dashboard').isVisible());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px ${theme} page overflow`);
      await page.screenshot({ path: `artifacts/timeline-heatmap-${width}-${theme}.png`, fullPage: true });
    }

    // A cached heatmap renders immediately and does not refetch history while fresh.
    const beforeReload = requests.length;
    await load(page); await page.locator('.hm-cell').first().waitFor();
    const reloadRequests = requests.slice(beforeReload).map(value => new URL(value));
    assert.ok(reloadRequests.every(url => url.pathname === '/' || url.searchParams.get('page') === '1'), 'cached reload must not refetch historical pages');

    // Stale cursors refresh automatically; there is no sync control in the UI.
    extra = true; await prepareRefresh(); await load(page);
    await page.waitForFunction(() => /近1年活跃率:\s*1\.1%/.test(document.querySelector('#bgmtl-personal').shadowRoot.querySelector('.hm-chart-area').textContent), null, { timeout: 30000 });
    const updated = await readState();
    assert.ok(updated.events.length >= 7, 'new records added incrementally');

    // Rate limiting stores a cooldown but never replaces the cached chart with an error panel.
    fail = true; await prepareRefresh(); const beforeFailure = requests.length; await load(page);
    await page.waitForFunction(() => new Promise(resolve => {
      const req = indexedDB.open('bangumi-personal-timeline', 1);
      req.onsuccess = () => { const get = req.result.transaction('state').objectStore('state').get('wylt'); get.onsuccess = () => resolve(get.result.retryAt > Date.now()); };
    }), null, { timeout: 10000 });
    assert.ok(requests.length > beforeFailure);
    assert.ok(await page.locator('.hm-cell').first().isVisible());
    assert.ok(!(await page.locator('.hm-chart-area').textContent()).includes('加载失败'));

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await load(page); await page.locator('.hm-cell').first().waitFor();
    assert.equal(await page.locator('.hm-cell').first().evaluate(element => getComputedStyle(element).transitionDuration), '0s');
    assert.deepEqual(errors, []);
    console.log('PASS: original heatmap-only UI, parsing protection, aligned annual coverage, multi-tab lock, local cache reload, automatic incremental sync, 429 backoff, desktop/mobile/dark/reduced-motion, no external requests');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
