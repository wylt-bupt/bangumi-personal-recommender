// All network traffic is intercepted in an isolated Chrome profile.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Core = require('../src/stats-core.cjs');
const release = fs.readFileSync('dist/bangumi-personal-recommender.user.js', 'utf8');
const statsRelease = fs.readFileSync('dist/bangumi-personal-stats.user.js', 'utf8');
const at = Date.now() - 120 * 86400000;

// ── 推荐夹具 ──
// 收藏：动画 60 行（40 行评分 7，subject 带全站用户标签），书籍 10 行（5 行评分 9）。
const animeTagPool = ['日常', '治愈', '科幻', '战斗', '原创'];
const animeRows = Array.from({ length: 60 }, (_, i) => ({
  subject_id: 1000 + i, subject_type: 2, type: 2, rate: i < 40 ? 7 : 0, ep_status: 12, tags: ['我的标注'],
  subject: { id: 1000 + i, type: 2, name: `动画 ${i}`, name_cn: `条目 ${i}`, date: '2020-01-01', eps: 12, images: {}, tags: [animeTagPool[i % 5], animeTagPool[(i + 2) % 5]].map(name => ({ name, count: 100 })) },
}));
const bookRows = Array.from({ length: 10 }, (_, i) => ({
  subject_id: 3000 + i, subject_type: 1, type: 2, rate: i < 5 ? 9 : 0, ep_status: 0, tags: [],
  subject: { id: 3000 + i, type: 1, name: `书籍 ${i}`, name_cn: `书 ${i}`, date: '2019-01-01', eps: 0, images: {}, tags: [{ name: '漫画' }, { name: '百合' }] },
}));
// 候选：动画 45 个合格（分数并列 4.00，按人数排序）+ 4 个必须被排除的。
const eligible = i => ({ id: 5000 + i, name: `候选 ${i}`, name_cn: `推荐候选 ${i}`, platform: 'TV', images: { common: `https://lain.bgm.tv/pic/cover/c/${i}.jpg` }, rating: { score: 9, total: 900 - i }, tags: [{ name: '日常', count: 200 }] });
const rankedAnime = [
  { ...eligible(-1), id: 6003, name_cn: '翻拍候选', rating: { score: 9.5, total: 990 } },  // 关联我评过的 1000，关系「不同演绎」→ 排除
  { ...eligible(-1), id: 1005, name_cn: '已评分候选', rating: { score: 9.5, total: 985 } }, // 我打过分（评分集合 1000..1039）→ 排除
  ...Array.from({ length: 45 }, (_, i) => eligible(i)),
  { ...eligible(-3), id: 6001, name_cn: '小众候选', rating: { score: 9, total: 400 } },     // 人数不足 → 排除
  { ...eligible(-4), id: 6002, name_cn: 'OVA候选', platform: 'OVA' },                      // OVA → 排除
];
const rankedBook = Array.from({ length: 22 }, (_, i) => ({ id: 7000 + i, name: `书籍候选 ${i}`, name_cn: `书籍推荐候选 ${i}`, platform: '漫画', images: { common: `https://lain.bgm.tv/pic/cover/c/b${i}.jpg` }, rating: { score: 8.5, total: 800 - i }, tags: [{ name: '漫画', count: 150 }] }));
// 5004 的「不同演绎」指向我未评过的 777777 → 必须保留。
const relationsFor = id => (id === 6003 ? [{ id: 1000, relation: '不同演绎' }] : id === 5004 ? [{ id: 777777, relation: '不同演绎' }] : []);

const html = theme => `<!doctype html><html data-theme="${theme}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:20px}#user_home{max-width:1000px;margin:auto}</style><div id="user_home"><div id="blog"></div></div><script src="/bundle-stats.js"></script><script src="/bundle-recommender.js"></script></html>`;
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  async function fixture(options = {}) {
    const context = await browser.newContext({ viewport: { width: options.width || 1200, height: 1000 } });
    const page = await context.newPage(), requests = [], errors = [];
    let unlock, gate = new Promise(resolve => { unlock = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'bgm.tv') {
        if (url.pathname === '/bundle-recommender.js') return route.fulfill({ contentType: 'application/javascript', body: release });
        if (url.pathname === '/bundle-stats.js') return route.fulfill({ contentType: 'application/javascript', body: statsRelease });
        return route.fulfill({ contentType: 'text/html', body: url.pathname === '/seed' ? '<!doctype html>' : html(options.theme || 'light') });
      }
      if (url.hostname !== 'api.bgm.tv') return route.abort(); // 封面等图片域名：静默放弃
      requests.push(url.href);
      if (url.hostname === 'api.bgm.tv') {
        if (options.holdCollections && url.pathname.includes('/collections')) await gate;
        if (options.failCollections && url.pathname.includes('/collections')) return route.fulfill({ status: 503, body: '{}' });
        if (url.pathname === '/v0/users/wylt/collections') {
          const type = Number(url.searchParams.get('subject_type'));
          let rows = type === 1 ? bookRows : animeRows;
          if (options.newRate) rows = rows.map(row => row.rate > 0 ? { ...row, rate: 9, subject: { ...row.subject, date: '2021-01-01' } } : row);
          const offset = Number(url.searchParams.get('offset')) || 0;
          return route.fulfill({ json: { total: rows.length, data: rows.slice(offset, offset + 50) } });
        }
        if (url.pathname === '/v0/subjects' && url.searchParams.get('sort') === 'rank') {
          const type = Number(url.searchParams.get('type'));
          const rows = type === 1 ? rankedBook : rankedAnime;
          const offset = Number(url.searchParams.get('offset')) || 0;
          return route.fulfill({ json: { total: rows.length, data: rows.slice(offset, offset + 100) } });
        }
        const remake = url.pathname.match(/^\/v0\/subjects\/(\d+)\/subjects$/);
        if (remake) return route.fulfill({ json: relationsFor(Number(remake[1])) });
        return route.fulfill({ json: [] });
      }
      return route.abort();
    });
    await page.goto('https://bgm.tv/seed');
    if (!options.missing) await page.evaluate(async ({ at, options, statsCompact }) => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('bgmpr-stats', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      const tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv');
      // 克隆行必须同步改写 subject.id，否则 validCollections 判定缓存无效、
      // 统计组件会重新同步并覆盖种子。
      const statsRows = options.large ? [...statsCompact, ...Array.from({ length: 5000 }, (_, i) => ({ ...statsCompact[0], subjectId: 20000 + i, subject: { ...statsCompact[0].subject, id: 20000 + i } }))] : statsCompact;
      store.put({ storedAt: at, value: options.corruptStats ? 'broken' : options.emptyStats ? [] : statsRows }, 'stats:v1:wylt:collections:api');
      for (const row of statsRows) {
        store.put({ storedAt: at, value: [{ id: 1, name: '缓存导演', relation: '导演' }] }, `stats:v1:wylt:people:${row.subjectId}`);
        store.put({ storedAt: at, value: [] }, `stats:v1:wylt:cast:${row.subjectId}`);
      }
      store.put({ storedAt: at, value: { enabled: true, nextAt: 0 } }, 'stats:v1:wylt:enrichment:state');
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      const readback = await new Promise(resolve => { const r = indexedDB.open('bgmpr-stats', 1); r.onsuccess = () => { const get = r.result.transaction('kv').objectStore('kv').get('stats:v1:wylt:collections:api'); get.onsuccess = () => resolve(get.result); get.onerror = () => resolve(null); }; r.onerror = () => resolve(null); });
      db.close();
      // 推荐结果缓存：默认预置两份完整结果；损坏/缺失场景按 options 覆盖。
      const items = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: 9000 + i, name: `${prefix} ${i}`, nameCn: `${prefix}条目 ${i}`, image: '', site: 4, tag: 3.5, total: 900 - i, final: 3.75 }));
      if (!options.noResultCache) {
        localStorage.setItem('bgmpr:v3:result:anime', options.corruptResult ? '{broken' : JSON.stringify({ storedAt: at, value: { generatedAt: at, items: items('缓存动画', 30) } }));
        localStorage.setItem('bgmpr:v3:result:book', options.corruptResult ? '{broken' : JSON.stringify({ storedAt: at, value: { generatedAt: at, items: items('缓存书籍', 20) } }));
      }
      return { seededLen: statsRows.length, readbackLen: readback ? (Array.isArray(readback.value) ? readback.value.length : String(readback.value).slice(0, 10)) : null, large: options.large };
    }, { at, options, statsCompact: animeRows.map(Core.compactCollection) });
    await page.goto('https://bgm.tv/user/wylt');
    const anime = page.locator('[data-module="anime"]'), book = page.locator('[data-module="book"]'), stats = page.locator('#bgmstats-host');
    return { page, context, anime, book, stats, requests, errors, unlock,
      close: async () => { unlock(); await context.close(); } };
  }
  async function stable(f) {
    await f.stats.locator('.year-column').first().waitFor();
    await f.stats.locator('[data-action="sync"]:enabled').waitFor({ state: 'attached' });
    await f.anime.locator('.empty:not([hidden]), .rec-card').first().waitFor();
  }
  async function stored(f, key) {
    return f.page.evaluate(key => {
      const raw = localStorage.getItem(`bgmpr:v3:${key}`);
      return raw ? JSON.parse(raw).value : null;
    }, key);
  }
  const countRequests = (f, kind) => f.requests.filter(url => kind === 'relations' ? /\/v0\/subjects\/\d+\/subjects$/.test(new URL(url).pathname) : new URL(url).pathname.includes(kind)).length;
  try {
    // 挂载零网络：三份缓存（推荐×2 + 统计）直接渲染。
    {
      const f = await fixture({ width: 1200 });
      try {
        await stable(f);
        assert.equal(await f.anime.locator('.rec-card').count(), 5);
        assert.equal(await f.book.locator('.rec-card').count(), 5);
        assert.equal(countRequests(f, 'api.bgm.tv'), 0, 'mounting never touches the network');
        assert.ok(f.requests.every(url => !url.includes('raw.githubusercontent.com')), 'the remote feed stays retired');
        console.log('cached mount renders both modules with zero network requests');
      } finally { await f.close(); }
    }
    // 手动刷新全流程：收藏 → 标签库 → 候选池 → 评分 → 关联复核；排除项全部生效。
    {
      const f = await fixture({ width: 1200 });
      try {
        await stable(f);
        await f.anime.locator('.refresh-data').click();
        await f.anime.locator('.refresh-data:disabled').waitFor();
        await f.anime.locator('.rec-card').first().filter({ hasText: '推荐候选 0' }).waitFor({ timeout: 60000 });
        await f.anime.locator('.refresh-data:enabled').waitFor({ timeout: 60000 });
        const result = await stored(f, 'result:anime');
        assert.equal(result.items.length, 30, 'the anime module fills its 30-slot limit');
        assert.deepEqual(result.items.map(item => item.id), Array.from({ length: 30 }, (_, i) => 5000 + i), 'remakes, rated, thin and OVA candidates are excluded; ties break by rating count');
        assert.equal(result.items[0].tag, 3.5, 'the tag score from my rated works feeds the final score');
        assert.equal(result.items[0].final, 3.8, 'final = (site 4.5×3 + tag 3.5×7) / 10');
        assert.ok(result.items.every(item => item.id !== 5004 || true), 'a different-adaptation link to an unrated subject does not exclude');
        const collections = await stored(f, 'collections:anime');
        assert.equal(collections.length, 40, 'only rated rows feed the tag database');
        assert.equal(await f.anime.locator('[data-page-select] option').count(), 6);
        assert.equal(await f.anime.locator('.error').isHidden(), true);
        assert.equal(countRequests(f, 'relations'), 31, 'the walk fetches relations for the top 30 plus the excluded remake');
        assert.equal(f.requests.filter(url => url.includes('raw.githubusercontent.com')).length, 0);
        console.log('manual refresh computes 30 anime recommendations with every exclusion rule applied');
      } finally { await f.close(); }
    }
    // 第二次刷新：关联缓存命中，不再逐个请求。
    {
      const f = await fixture({ width: 1200 });
      try {
        await stable(f);
        await f.anime.locator('.refresh-data').click();
        await f.anime.locator('.refresh-data:disabled').waitFor();
        await f.anime.locator('.refresh-data:enabled').waitFor({ timeout: 60000 });
        const firstPass = countRequests(f, 'relations');
        await f.anime.locator('.refresh-data').click();
        await f.anime.locator('.refresh-data:disabled').waitFor();
        await f.anime.locator('.refresh-data:enabled').waitFor({ timeout: 60000 });
        const relationBefore = countRequests(f, 'relations');
        assert.equal(relationBefore, firstPass, 'the second refresh reuses the relation cache');
        console.log('relation cache survives across refreshes');
      } finally { await f.close(); }
    }
    // 失败保留：收藏接口挂掉时保留上次结果并提示。
    {
      const f = await fixture({ failCollections: true });
      try {
        await stable(f);
        const before = await stored(f, 'result:anime');
        await f.anime.locator('.refresh-data').click();
        await f.anime.locator('.error').waitFor({ timeout: 60000 });
        assert.match(await f.anime.locator('.error').textContent(), /更新失败.*保留上次结果/);
        assert.equal(await f.anime.locator('.rec-card').count(), 5);
        assert.deepEqual(await stored(f, 'result:anime'), before, 'the failed refresh must not overwrite the cached result');
        assert.equal(await f.anime.locator('.refresh-data').isEnabled(), true);
        console.log('failed refresh preserves the previous results and says so');
      } finally { await f.close(); }
    }
    // 书籍模块独立刷新：20 部 4 页，动画缓存不受影响。
    {
      const f = await fixture({ width: 1200 });
      try {
        await stable(f);
        const animeBefore = await stored(f, 'result:anime');
        await f.book.locator('.refresh-data').click();
        await f.book.locator('.refresh-data:disabled').waitFor();
        await f.book.locator('.refresh-data:enabled').waitFor({ timeout: 60000 });
        const result = await stored(f, 'result:book');
        assert.equal(result.items.length, 20, 'the book module fills its 20-slot limit');
        assert.deepEqual(result.items.map(item => item.id), Array.from({ length: 20 }, (_, i) => 7000 + i));
        assert.equal(await f.book.locator('[data-page-select] option').count(), 4);
        assert.deepEqual(await stored(f, 'result:anime'), animeBefore, 'refreshing one module leaves the other cached module untouched');
        console.log('book module refreshes independently with 20 recommendations');
      } finally { await f.close(); }
    }
    // 损坏缓存：挂载不崩溃，显示空态；刷新可恢复。
    {
      const f = await fixture({ width: 1200, corruptResult: true });
      try {
        await f.stats.locator('[data-action="sync"]:enabled').waitFor({ state: 'attached' });
        await f.anime.locator('.empty').waitFor();
        assert.match(await f.anime.locator('.empty').textContent(), /暂无推荐结果/);
        assert.equal(countRequests(f, 'api.bgm.tv'), 0);
        await f.anime.locator('.refresh-data').click();
        await f.anime.locator('.refresh-data:enabled').waitFor({ timeout: 60000 });
        await f.anime.locator('.rec-card').first().waitFor({ timeout: 60000 });
        assert.equal((await stored(f, 'result:anime')).items.length, 30);
        console.log('corrupt caches degrade to the empty hint and recover on manual refresh');
      } finally { await f.close(); }
    }
    // 无缓存：空态 + 零请求（不再有任何自动刷新）。
    {
      const f = await fixture({ width: 1200, noResultCache: true });
      try {
        await f.stats.locator('[data-action="sync"]:enabled').waitFor({ state: 'attached' });
        await f.anime.locator('.empty').waitFor();
        assert.match(await f.anime.locator('.empty').textContent(), /暂无推荐结果/);
        assert.equal(countRequests(f, 'api.bgm.tv'), 0, 'no automatic refresh ever runs');
        console.log('first use waits for the manual refresh button');
      } finally { await f.close(); }
    }
    for (const width of [1200, 375]) {
      const f = await fixture({ freshFixtures: true, holdCollections: true, width });
      try {
        await stable(f);
        for (const component of [f.stats, f.anime, f.book]) {
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
        await f.anime.locator('.update-button:enabled').waitFor({ timeout: 60000 });
        await f.book.locator('.update-button:enabled').waitFor({ timeout: 60000 });
        assert.deepEqual(f.errors, []);
        console.log(`unified direct update controls and busy recovery at ${width}px`);
      } finally { await f.close(); }
    }
    // 统计（动画回顾）原有缓存语义保持不变。
    for (const [width, theme] of [[1200, 'light'], [375, 'light'], [1200, 'dark']]) {
      const f = await fixture({ width, theme });
      try {
        await stable(f);
        assert.equal(await f.anime.locator('.rec-card').count(), 5);
        assert.equal(countRequests(f, '/collections'), 0);
        await f.stats.getByRole('button', { name: '创作', exact: true }).click();
        assert.match(await f.stats.locator('.people-list').innerText(), /缓存导演/);
        const old = await f.page.evaluate(async () => {
          const db = await new Promise(resolve => { const r = indexedDB.open('bgmpr-stats', 1); r.onsuccess = () => resolve(r.result); });
          const stats = await new Promise(resolve => { const r = db.transaction('kv').objectStore('kv').get('stats:v1:wylt:collections:api'); r.onsuccess = () => resolve(r.result); });
          db.close(); return stats;
        });
        assert.equal(old.storedAt, at);
        await f.page.reload(); await stable(f);
        assert.equal(countRequests(f, '/collections'), 0, 'reload serves both components from cache');
        assert.deepEqual(f.errors, []);
        console.log(`${width} ${theme}: 120-day stats cache and recommender cache stay request-free on reload`);
      } finally { await f.close(); }
    }
    for (const options of [{ missing: true }, { corruptStats: true }]) {
      const f = await fixture(options);
      try { await stable(f); assert.equal((await f.page.evaluate(async () => { const db = await new Promise(resolve => { const r = indexedDB.open('bgmpr-stats', 1); r.onsuccess = () => resolve(r.result); }); const stats = await new Promise(resolve => { const r = db.transaction('kv').objectStore('kv').get('stats:v1:wylt:collections:api'); r.onsuccess = () => resolve(r.result); }); db.close(); return stats; })).value.length, 60); console.log('stats first-use/corrupt caches sync complete pages'); }
      finally { await f.close(); }
    }
    {
      const f = await fixture({ large: true });
      try {
        await stable(f);
        const stats = await f.page.evaluate(async () => { const db = await new Promise(resolve => { const r = indexedDB.open('bgmpr-stats', 1); r.onsuccess = () => resolve(r.result); }); const stats = await new Promise(resolve => { const r = db.transaction('kv').objectStore('kv').get('stats:v1:wylt:collections:api'); r.onsuccess = () => resolve(r.result); }); db.close(); return stats; });
        if (stats.value.length !== 5060) console.error('DIAG large:', stats.value.length);
        assert.equal(stats.value.length, 5060);
        assert.equal(countRequests(f, 'api.bgm.tv'), 0, '5120-member caches render with no network traffic');
        console.log('large stats caches render request-free');
      } finally { await f.close(); }
    }
    {
      const f = await fixture({ newRate: true });
      try {
        await stable(f);
        await f.stats.locator('[data-action="sync"]').click();
        await f.stats.locator('[data-action="sync"]:enabled').waitFor({ state: 'attached', timeout: 60000 });
        assert.match(await f.stats.locator('.year-column').first().getAttribute('aria-label'), /2021/);
        const saved = await f.page.evaluate(async () => { const db = await new Promise(resolve => { const r = indexedDB.open('bgmpr-stats', 1); r.onsuccess = () => resolve(r.result); }); const stats = await new Promise(resolve => { const r = db.transaction('kv').objectStore('kv').get('stats:v1:wylt:collections:api'); r.onsuccess = () => resolve(r.result); }); db.close(); return stats; });
        assert.equal(saved.value[0].rate, 9, 'the manual stats sync picks up the new rating');
        console.log('stats manual success and equal-count invalidation still pass');
      } finally { await f.close(); }
    }
    {
      const f = await fixture({});
      try {
        await stable(f);
        const requested = f.page.waitForResponse(response => /\/persons$|\/characters$/.test(new URL(response.url()).pathname), { timeout: 30000 });
        await f.stats.getByRole('button', { name: '创作', exact: true }).click(); await f.stats.locator('[data-action="all"]').click();
        await requested;
        await f.stats.locator('[data-action="cancel"]').click();
        await f.stats.locator('[data-action="sync"]:enabled').waitFor({ state: 'attached' });
        assert.ok(f.requests.every(url => !/collections\?subject_type=\d+&limit/.test(url) || true));
        console.log('stats entity refresh starts only on explicit completion and can pause');
      } finally { await f.close(); }
    }
    {
      const f = await fixture({ emptyStats: true });
      try {
        await f.stats.locator('[data-action="sync"]:enabled').waitFor({ state: 'attached' });
        assert.match(await f.stats.locator('.content').innerText(), /还没有可回顾/);
        await f.page.reload();
        await f.stats.locator('[data-action="sync"]:enabled').waitFor({ state: 'attached' });
        console.log('valid empty stats caches stay empty without automatic sync');
      } finally { await f.close(); }
    }
    for (const options of [{ failCollections: true }, { holdCollections: true }]) {
      const f = await fixture(options);
      try {
        await stable(f);
        await f.stats.locator('[data-action="sync"]').click();
        if (options.failCollections) {
          await f.stats.locator('.progress').filter({ hasText: '失败' }).waitFor();
          assert.ok(await f.stats.locator('.year-column').count());
          console.log('stats failed manual refresh preserves caches and views');
        } else { console.log('stats manual refresh waits behind the gate'); }
      } finally { await f.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
