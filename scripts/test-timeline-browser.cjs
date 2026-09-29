// Isolated headless Chrome; every bgm.tv request is fulfilled by local fixtures.
const { chromium } = require('playwright');
const { readFile } = require('node:fs/promises');
const assert = require('node:assert/strict');
const path = require('node:path');
const stamp = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const codePath = path.resolve('dist/bangumi-personal-timeline.user.js');
const now = Date.now();

// Batch progress is a checkpoint, so only its delta from the previous known
// checkpoint/episode belongs to that day. Collection actions never count.
const core = require('../src/timeline-core.cjs');
const episodeState = core.freshState('wylt');
const episodeDayA = core.dayStart(now) - 2 * core.DAY + 12 * 3600000;
const episodeDayB = core.dayStart(now) - core.DAY + 12 * 3600000;
episodeState.events = [
  { id: '5', type: 'progress', time: episodeDayB + 2000, source: 'web', subjects: ['248154'], text: '完成了 风が強く吹いている 12 of 23 话' },
  { id: '1', type: 'progress', time: episodeDayA, source: 'web', subjects: ['248154'], text: '完成了 风が強く吹いている 4 of 23 话' },
  { id: '6', type: 'subject', time: episodeDayB + 3000, source: 'web', subjects: ['248154'], text: '将 风が強く吹いている 标记为看过' },
  { id: '3', type: 'progress', time: episodeDayA + 2000, source: 'web', subjects: ['248154'], text: '看过 ep.6 裸の王様' },
  { id: '2', type: 'progress', time: episodeDayA + 1000, source: 'web', subjects: ['248154'], text: '看过 ep.5 灰かぶり' },
  { id: '4', type: 'progress', time: episodeDayB + 1000, source: 'web', subjects: ['248154'], text: '完成了 风が強く吹いている 9 of 23 话' }
];
episodeState.streams.progress.complete = true;
const episodeAggregate = core.aggregate(episodeState, now);
assert.equal(episodeAggregate.days.find(day => day.key === core.dayKey(episodeDayA)).count, 6);
assert.equal(episodeAggregate.days.find(day => day.key === core.dayKey(episodeDayB)).count, 6);
assert.equal(episodeAggregate.total, 12);

function fixture(type, page, extra = false) {
  const base = type === 'subject' ? 100 : 200;
  const rows = page === 1 ? [0, 1, 2].map(i => ({ id: base + i, time: now - (i + 1) * 86400000 })) : [{ id: base + 4, time: now - 400 * 86400000 }];
  if (extra && page === 1) rows.unshift({ id: base + 10, time: now - 1000 });
  return `<html><a href="/user/wylt">wylt</a><div id="timeline"><ul>${rows.map((event, i) => `<li id="tml_${event.id}"><span class="info_full">${type === 'progress' ? `看过 <a href="/subject/ep/${i + 1}">ep.${i + 1}</a>` : '收藏了'} <a href="/subject/${i + 1}">作品 &lt;img onerror=alert(1)&gt;</a><div class="card"><img src="https://never-request.invalid/cover.jpg"><a href="/subject/${i + 1}">封面</a></div><div class="date"><span title="${stamp(event.time)}">昨天</span> · ${i % 2 ? '<a href="/dev/app/1">API</a>' : 'web'}</div></span></li>`).join('')}</ul></div>${page === 1 ? `<a href="/user/wylt/timeline?type=${type}&page=2">下一页 ››</a>` : ''}</html>`;
}

const rootHTML = '<!doctype html><html lang="zh-CN" data-theme="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;background:#fafafa}#columnHomeB{width:min(100%,820px);margin:auto}</style><div id="dock"><a href="https://bgm.tv/user/wylt" title="时光机">wylt</a></div><div id="columnHomeB" class="column"></div></html>';
const profileHTML = '<!doctype html><html lang="zh-CN" data-theme="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;background:#fafafa}#user_home{width:min(100%,820px);margin:auto}#blog{height:20px}</style><div id="dock"><a href="https://bgm.tv/user/wylt" title="时光机">wylt</a></div><div id="user_home"><div id="blog"></div></div></html>';

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
    if (url.pathname === '/user/wylt') return route.fulfill({ status: 200, contentType: 'text/html', body: profileHTML });
    assert.equal(url.pathname, '/user/wylt/timeline');
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    await new Promise(resolve => setTimeout(resolve, 30));
    await route.fulfill({ status: fail ? 429 : 200, contentType: 'text/html', body: fail ? 'Rate limited' : fixture(url.searchParams.get('type'), Number(url.searchParams.get('page')), extra) });
    inflight--;
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const load = async (target, url = 'https://bgm.tv/') => { await target.goto(url); await target.addScriptTag({ content: code }); await target.locator('#bgmtl-personal').waitFor(); };
  const prepareRefresh = () => page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('bangumi-personal-timeline', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const database = req.result, tx = database.transaction('state', 'readwrite'), store = tx.objectStore('state'), get = store.get('wylt');
      get.onsuccess = () => {
        const value = get.result;
        value.retryAt = 0;
        value.updatedAt = 0;
        for (const stream of Object.values(value.streams)) { stream.headAt = 1; delete stream.refresh; }
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
    assert.ok(requests.every(value => new URL(value).searchParams.get('type') !== 'subject'), 'collection activities are no longer fetched');
    const cellCount = await page.locator('.hm-cell').count();
    assert.ok(cellCount >= 7 && cellCount <= 371, `expected visible days from aligned weeks, got ${cellCount} cells`);
    assert.ok(await page.locator('.hm-cell title').allTextContents().then(titles => titles.some(title => title.startsWith(core.dayKey(now)))), 'the current day must remain visible');
    assert.equal(await page.locator('button,nav,details,input,.platform-row,.week-row').count(), 0, 'the component exposes only the heatmap');
    assert.equal(await page.locator('h2').textContent(), '活跃度热力图');
    assert.equal(await page.locator('#hm-dashboard').getAttribute('aria-label'), '活跃度热力图');
    assert.equal(await page.locator('#hm-dashboard p').count(), 0, 'no redundant subtitle copy');
    assert.equal(await page.locator('.hm-chart-area i').count(), 4);
    assert.match(await page.locator('.hm-cell').last().locator('title').textContent(), /\d{4}-\d{2}-\d{2}: \d+ 集/);
    const monthLabelBoxes = await page.locator('.hm-month-label').evaluateAll(labels => labels.map(label => {
      const box = label.getBBox(), date = label.getAttribute('data-date');
      const dayCell = [...label.ownerSVGElement.querySelectorAll('.hm-cell')].find(cell => cell.querySelector('title')?.textContent.startsWith(`${date}:`));
      return { text: label.textContent, date, x: box.x, right: box.x + box.width, labelX: label.getAttribute('x'), dayX: dayCell?.getAttribute('x') };
    }));
    assert.ok(monthLabelBoxes.every(label => label.date.endsWith('-01') && label.labelX === label.dayX), `month labels should align with day 1 columns: ${JSON.stringify(monthLabelBoxes)}`);
    for (let index = 1; index < monthLabelBoxes.length; index++) {
      assert.ok(monthLabelBoxes[index - 1].right <= monthLabelBoxes[index].x, `month labels overlap: ${JSON.stringify(monthLabelBoxes)}`);
    }
    const firstDay = core.dayKey(now - core.DAY);
    assert.ok((await page.locator('.hm-cell title').allTextContents()).includes(`${firstDay}: 1 集`), 'a collection on the same day must not add another episode');
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
    assert.ok(await page.locator('#hm-dashboard').evaluate(element => element.classList.contains('home-layout')));
    const heatColors = await page.locator('#hm-dashboard').evaluate(element => ['empty', 'l1', 'l2', 'l3'].map(level => getComputedStyle(element).getPropertyValue(`--hm-cell-${level}`).trim()));
    assert.deepEqual(heatColors, ['#f2f2f2', '#f8cdd4', '#ed7790', '#c83d64']);
    assert.ok(await page.locator('.hm-scroll').evaluate(element => element.scrollWidth <= element.clientWidth), 'the heatmap must fit without horizontal scrolling');
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

    const visibleWeeks = {}, oldestVisibleDays = {};
    for (const [width, height, theme] of [[1200, 900, 'light'], [375, 812, 'light'], [667, 375, 'light'], [1200, 900, 'dark']]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      await page.waitForFunction(() => document.querySelector('#bgmtl-personal')?.shadowRoot?.querySelector('svg')?.getAttribute('width') && document.querySelector('#bgmtl-personal').shadowRoot.querySelector('.hm-scroll').scrollWidth <= document.querySelector('#bgmtl-personal').shadowRoot.querySelector('.hm-scroll').clientWidth);
      await page.waitForFunction(() => [...document.querySelector('#bgmtl-personal').shadowRoot.querySelectorAll('.hm-cell')].every(cell => getComputedStyle(cell).opacity === '1'));
      visibleWeeks[width] = await page.locator('.hm-cell').evaluateAll(cells => new Set(cells.map(cell => cell.getAttribute('x'))).size);
      oldestVisibleDays[width] = await page.locator('.hm-cell title').first().textContent();
      assert.ok(await page.locator('#hm-dashboard').isVisible());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px ${theme} page overflow`);
      await page.screenshot({ path: `artifacts/timeline-heatmap-${width}-${theme}.png`, fullPage: true });
    }
    assert.ok(visibleWeeks[1200] > visibleWeeks[375], `wide layout should show more history: ${JSON.stringify(visibleWeeks)}`);
    assert.ok(oldestVisibleDays[1200] < oldestVisibleDays[375], 'a wider layout should reveal earlier dates');

    // The profile keeps the original full-year, horizontally scrollable chart.
    const profilePage = await context.newPage();
    profilePage.on('pageerror', error => errors.push(error.message));
    await profilePage.setViewportSize({ width: 375, height: 812 });
    await load(profilePage, 'https://bgm.tv/user/wylt');
    await profilePage.locator('.hm-cell').first().waitFor({ state: 'visible', timeout: 30000 });
    assert.ok(await profilePage.locator('#hm-dashboard').evaluate(element => element.classList.contains('profile-layout')));
    assert.equal(await profilePage.locator('.hm-cell').count(), cellCount, 'profile shows the same full-year day range');
    assert.equal(await profilePage.locator('.hm-month-label').count(), 0, 'profile retains the original week-based month labels');
    const profileScroll = profilePage.locator('.hm-scroll');
    assert.equal(await profileScroll.evaluate(element => getComputedStyle(element).overflowX), 'auto');
    assert.ok(await profileScroll.evaluate(element => element.scrollWidth > element.clientWidth), 'profile retains horizontal scrolling on narrow screens');
    assert.ok(await profileScroll.locator('svg').evaluate(element => Number.parseFloat(element.style.minWidth) > 500), 'profile retains the full-year SVG width');
    await profilePage.waitForFunction(() => {
      const element = document.querySelector('#bgmtl-personal')?.shadowRoot?.querySelector('.hm-scroll');
      return element && element.scrollLeft + element.clientWidth >= element.scrollWidth - 2;
    });
    assert.deepEqual(errors, []);
    await profilePage.close();

    // A cached heatmap renders immediately and does not refetch history while fresh.
    const beforeReload = requests.length;
    await load(page); await page.locator('.hm-cell').first().waitFor();
    const reloadRequests = requests.slice(beforeReload).map(value => new URL(value));
    assert.ok(reloadRequests.every(url => url.pathname === '/' || url.searchParams.get('page') === '1'), `cached reload must not refetch historical pages: ${reloadRequests.map(url => url.href).join(', ')}`);

    // Stale cursors refresh automatically; there is no sync control in the UI.
    extra = true; await prepareRefresh(); await load(page);
    await page.waitForFunction(() => /近1年活跃率:\s*1\.1%/.test(document.querySelector('#bgmtl-personal').shadowRoot.querySelector('.hm-chart-area').textContent), null, { timeout: 30000 });
    const updated = await readState();
    assert.ok(updated.events.some(event => event.id === '210'), 'new progress record added incrementally');

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
    console.log('PASS: homepage adaptive heatmap without scrolling; profile full-year scroll layout; parsing protection, current-day visibility, multi-tab lock, local cache reload, automatic incremental sync, 429 backoff, desktop/mobile/dark/reduced-motion, no external requests');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
