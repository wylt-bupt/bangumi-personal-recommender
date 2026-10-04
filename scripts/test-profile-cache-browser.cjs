// All network traffic is intercepted in an isolated Chrome profile.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Core = require('../src/stats-core.cjs');
const release = fs.readFileSync('dist/bangumi-personal-recommender.user.js', 'utf8');
const at = Date.now() - 120 * 86400000;
const rows = Array.from({ length: 120 }, (_, i) => ({ subject_id: i + 1, type: 2, rate: 7,
  tags: ['日常'], subject: { id: i + 1, type: 2, name: `动画 ${i}`, date: '2020-01-01', eps: 12 } }));
const feed = title => ({ schema: 1, owner: 'wylt', generatedAt: '2026-10-01T00:00:00Z',
  candidates: Array.from({ length: 18 }, (_, i) => ({ subject: { id: 9000 + i, type: 2, nameCn: title + i, tags: [], rating: {} }, predicted: 8 - i / 100 })) });
const html = theme => `<!doctype html><html data-theme="${theme}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:20px}#user_home{max-width:1000px;margin:auto}</style><div id="user_home"><div id="blog"></div></div><script src="/bundle.js"></script></html>`;
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  async function fixture(options = {}) {
    const context = await browser.newContext({ viewport: { width: options.width || 1200, height: 1000 } });
    const page = await context.newPage(), requests = [], errors = [];
    let unlock, feedCount = 0;
    const gate = new Promise(resolve => { unlock = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'bgm.tv') {
        if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'application/javascript', body: release });
        return route.fulfill({ contentType: 'text/html', body: url.pathname === '/seed' ? '<!doctype html>' : html(options.theme || 'light') });
      }
      requests.push(url.href);
      if (url.hostname === 'raw.githubusercontent.com') {
        const n = ++feedCount;
        if (options.holdFeed && n === 1) await gate;
        if (options.failFeed) return route.fulfill({ status: 503, body: '{}' });
        return route.fulfill({ json: feed(n === 1 ? '后台旧' : '手动新') });
      }
      if (url.hostname === 'api.bgm.tv') {
        if (options.holdCollections && url.pathname.includes('/collections')) await gate;
        if (options.failCollections && url.pathname.includes('/collections')) return route.fulfill({ status: 503, body: '{}' });
        if (url.pathname.includes('/collections')) {
          const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'));
          const data = rows.map(row => ({ ...row, rate: options.newRate ? 9 : 7, subject: { ...row.subject, date: options.newRate ? '2021-01-01' : '2020-01-01' } }));
          // Force a missing second page while keeping the declared total.
          return route.fulfill({ json: { total: data.length, data: options.partial && offset ? [] : data.slice(offset, offset + limit) } });
        }
        return route.fulfill({ json: [] });
      }
      return route.abort();
    });
    await page.goto('https://bgm.tv/seed');
    const seedRows = options.large ? [...rows, ...Array.from({ length: 5000 }, (_, i) => ({ ...rows[0], subject_id: 20000 + i, subject: { ...rows[0].subject, id: 20000 + i } }))] : rows;
    if (!options.missing) await page.evaluate(async ({ rows, compact, rawFeed, at, options }) => {
      const recRows = options.empty ? [] : rows.map(row => ({ subject_id: row.subject_id, rate: row.rate }));
      localStorage.setItem('bgmpr:v2:collections', options.corrupt ? '{broken' : JSON.stringify({ storedAt: at, value: recRows }));
      if (!options.noFeed) localStorage.setItem('bgmpr:v2:feed', options.corruptFeed ? '{broken' : JSON.stringify({ storedAt: options.freshFeed ? Date.now() : at, value: rawFeed }));
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('bgmpr-stats', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      const tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv');
      store.put({ storedAt: at, value: options.corrupt ? 'broken' : options.empty ? [] : compact }, 'stats:v1:wylt:collections:api');
      for (const row of compact) {
        store.put({ storedAt: at, value: [{ id: 1, name: '缓存导演', relation: '导演' }] }, `stats:v1:wylt:people:${row.subjectId}`);
        store.put({ storedAt: at, value: [] }, `stats:v1:wylt:cast:${row.subjectId}`);
      }
      store.put({ storedAt: at, value: { enabled: true, nextAt: 0 } }, 'stats:v1:wylt:enrichment:state');
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      db.close();
    }, { rows: seedRows, compact: seedRows.map(Core.compactCollection), rawFeed: feed('缓存'), at, options });
    await page.goto('https://bgm.tv/user/wylt');
    const rec = page.locator('#bgmpr-host'), stats = page.locator('#bgmstats-host');
    return { page, context, rec, stats, requests, errors, unlock,
      close: async () => { unlock(); await context.close(); } };
  }
  async function stable(f) {
    await f.rec.locator('.results').waitFor();
    await f.stats.locator('.year-column').first().waitFor();
    await f.stats.locator('[data-action="sync"]:enabled').waitFor({ state: 'attached' });
  }
  async function saved(f) {
    return f.page.evaluate(async () => {
      const db = await new Promise(resolve => { const r = indexedDB.open('bgmpr-stats', 1); r.onsuccess = () => resolve(r.result); });
      const stats = await new Promise(resolve => { const r = db.transaction('kv').objectStore('kv').get('stats:v1:wylt:collections:api'); r.onsuccess = () => resolve(r.result); });
      db.close(); return { rec: JSON.parse(localStorage.getItem('bgmpr:v2:collections')), stats };
    });
  }
  try {
    for (const width of [1200, 375]) {
      const f = await fixture({ freshFeed: true, holdCollections: true, width });
      try {
        await stable(f);
        for (const component of [f.stats, f.rec]) {
          const button = component.locator('.update-button');
          assert.equal(await button.innerText(), '更新');
          assert.equal(await button.isEnabled(), true);
          assert.deepEqual(await button.evaluate(el => {
            const css = getComputedStyle(el);
            return [css.fontSize, css.padding, css.borderRadius, css.minHeight];
          }), ['12px', '6px 10px', '6px', width === 375 ? '44px' : '36px']);
          assert.equal(await component.locator('.module-head details').count(), 0);
          await button.click();
          await component.getByRole('button', { name: '更新中…', exact: true }).waitFor();
          assert.equal(await component.locator('.update-button').isEnabled(), false);
        }
        f.unlock();
        await f.stats.locator('.update-button:enabled').waitFor();
        await f.rec.locator('.update-button:enabled').waitFor();
        assert.equal(await f.stats.locator('.update-button').innerText(), '更新');
        assert.equal(await f.rec.locator('.update-button').innerText(), '更新');
        assert.deepEqual(f.errors, []);
        console.log(`unified direct update controls and busy recovery at ${width}px`);
      } finally { await f.close(); }
    }
    for (const [width, theme] of [[1200, 'light'], [375, 'light'], [1200, 'dark']]) {
      const f = await fixture({ holdFeed: true, width, theme });
      try {
        await stable(f);
        assert.equal(await f.rec.locator('.recommendation-card').count(), 5);
        assert.equal(await f.rec.locator('.refresh-data').isEnabled(), true);
        assert.equal(f.requests.filter(url => url.includes('api.bgm.tv')).length, 0);
        await f.stats.getByRole('button', { name: '创作', exact: true }).click();
        assert.match(await f.stats.locator('.people-list').innerText(), /缓存导演/);
        const old = await saved(f); assert.equal(old.rec.storedAt, at); assert.equal(old.stats.storedAt, at);
        await f.rec.locator('[data-page-select]').selectOption('2');
        const selected = await f.rec.locator('.cover').first().getAttribute('href');
        await f.rec.locator('.evidence-panel summary').first().click();
        await f.rec.locator('[data-dismiss-id]').first().click();
        f.unlock();
        await f.rec.locator('h3').first().filter({ hasText: '后台旧' }).waitFor();
        assert.equal(await f.rec.locator('[data-page-select]').inputValue(), '2');
        assert.notEqual(await f.rec.locator('.cover').first().getAttribute('href'), selected);
        await f.rec.getByRole('button', { name: '撤销', exact: true }).click();
        assert.equal(await f.rec.locator('.cover').first().getAttribute('href'), selected);
        assert.deepEqual(await saved(f), old);
        assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await f.page.reload(); await stable(f);
        assert.equal(f.requests.filter(url => url.includes('api.bgm.tv')).length, 0);
        assert.deepEqual(await saved(f), old); assert.deepEqual(f.errors, []);
        console.log(`${width} ${theme}: 120-day cache, blocked feed, no collection/entity requests, reload, navigation passed`);
      } finally { await f.close(); }
    }
    for (const options of [{ freshFeed: true }, { noFeed: true, holdFeed: true }, { corruptFeed: true, holdFeed: true }, { failFeed: true }]) {
      const f = await fixture(options);
      try {
        await stable(f);
        if (options.freshFeed) assert.equal(f.requests.length, 0);
        if (options.noFeed || options.corruptFeed) assert.match(await f.rec.locator('.summary').innerText(), /内置 50 条/);
        if (options.failFeed) { await f.rec.locator('.error').waitFor(); assert.equal(await f.rec.locator('.recommendation-card').count(), 5); }
        assert.equal(f.requests.filter(url => url.includes('api.bgm.tv')).length, 0);
        console.log('independent feed cache/fallback passed: ' + JSON.stringify(options));
      } finally { await f.close(); }
    }
    {
      const f = await fixture({ empty: true, freshFeed: true });
      try {
        await f.rec.locator('.results').waitFor(); await f.stats.locator('[data-action="sync"]:enabled').waitFor({ state: 'attached' });
        assert.match(await f.stats.locator('.content').innerText(), /还没有可回顾/);
        assert.equal(f.requests.length, 0); await f.page.reload();
        await f.stats.locator('[data-action="sync"]:enabled').waitFor({ state: 'attached' }); assert.equal(f.requests.length, 0);
        console.log('valid empty caches stay empty without automatic sync');
      } finally { await f.close(); }
    }
    for (const options of [{ missing: true }, { corrupt: true }]) {
      const f = await fixture(options);
      try { await stable(f); assert.equal((await saved(f)).stats.value.length, 120); assert.equal((await saved(f)).rec.value.length, 120); console.log('first-use/corrupt caches sync complete pages'); }
      finally { await f.close(); }
    }
    for (const options of [{ failCollections: true }, { partial: true }]) {
      const f = await fixture({ freshFeed: true, ...options });
      try {
        await stable(f); const before = await saved(f);
        await f.rec.locator('.refresh-data').click(); await f.rec.locator('.error').waitFor();
        assert.equal(await f.rec.locator('.recommendation-card').count(), 5);
        await f.stats.locator('[data-action="sync"]').click();
        await f.stats.locator('.progress').filter({ hasText: '失败' }).waitFor();
        assert.ok(await f.stats.locator('.year-column').count());
        assert.deepEqual(await saved(f), before); console.log('failed/truncated manual refresh preserves both caches and views');
      } finally { await f.close(); }
    }
    {
      const f = await fixture({ holdFeed: true, newRate: true });
      try {
        await stable(f); await f.page.waitForRequest(url => url.url().includes('raw.githubusercontent.com'), { timeout: 500 }).catch(() => {});
        await f.rec.locator('.refresh-data').click(); await f.rec.locator('h3').first().filter({ hasText: '手动新' }).waitFor();
        const before = await saved(f); assert.equal(before.rec.value[0].rate, 9);
        f.unlock();
        await f.stats.locator('[data-action="sync"]').click();
        await f.stats.locator('[data-action="sync"]:enabled').waitFor({ state: 'attached' });
        assert.match(await f.stats.locator('.year-column').first().getAttribute('aria-label'), /2021/);
        assert.equal((await saved(f)).stats.value[0].rate, 9);
        assert.match(await f.rec.locator('h3').first().innerText(), /手动新/);
        const storedFeed = await f.page.evaluate(() => JSON.parse(localStorage.getItem('bgmpr:v2:feed')).value.candidates[0].subject.nameCn);
        assert.match(storedFeed, /手动新/); assert.deepEqual(f.errors, []);
        console.log('manual success, equal-count stats invalidation and late-feed race passed');
      } finally { await f.close(); }
    }
    {
      const f = await fixture({ large: true, freshFeed: true });
      try {
        await stable(f); const value = await saved(f);
        assert.equal(value.rec.value.length, 5120); assert.equal(value.stats.value.length, 5120);
        assert.equal(f.requests.length, 0); console.log('5120-member caches render with no network traffic');
      } finally { await f.close(); }
    }
    {
      const f = await fixture({ freshFeed: true });
      try {
        await stable(f); assert.equal(f.requests.length, 0);
        const requested = f.page.waitForResponse(response => /\/persons$|\/characters$/.test(new URL(response.url()).pathname));
        await f.stats.getByRole('button', { name: '创作', exact: true }).click(); await f.stats.locator('[data-action="all"]').click();
        await requested;
        assert.ok(f.requests.some(url => /\/persons$|\/characters$/.test(new URL(url).pathname)));
        await f.stats.locator('[data-action="cancel"]').click();
        await f.stats.locator('[data-action="sync"]:enabled').waitFor({ state: 'attached' });
        assert.ok(f.requests.every(url => !url.includes('/collections'))); console.log('entity refresh starts only on explicit completion and can pause');
      } finally { await f.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
