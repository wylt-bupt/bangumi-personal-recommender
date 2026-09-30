// Isolated Chrome fixtures; never connects to the user's signed-in browser.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('../src/calendar-core.cjs');
const release = fs.readFileSync('dist/bangumi-personal-calendar.user.js', 'utf8');
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const today = new Date().getDay() || 7;
const calendar = days.map((name, n) => ({ weekday: { id: n + 1 }, items: [
  { id: (n + 1) * 10 + 1, name: 'Original', name_cn: n + 1 === today ? '中文标题 <img src=x onerror=alert(1)> 与很长的番剧名称'.repeat(2) : `收藏番剧 ${n + 1}`, images: { common: 'http://lain.bgm.tv/fixture.jpg' } },
  { id: (n + 1) * 10 + 2, name: 'No Chinese title', images: {} },
  { id: (n + 1) * 10 + 3, name_cn: '私密收藏番剧', images: {} },
  { id: (n + 1) * 10 + 4, name_cn: '未收藏条目', images: {} }
] }));
const rows = calendar.flatMap((day, n) => day.items.slice(0, 2).map((item, i) => ({ subject_id: item.id, type: i ? 2 : n % 5 + 1, rate: 8, private: false, comment: 'never cache this' })));
const privateId = today * 10 + 3;
function pageHTML(full = false, signedIn = true, theme = 'light') {
  const content = full ? `<div class="columns"><div id="colunmSingle"><div class="BgmCalendar">${calendar.map((day, n) => `<dl><dt>${days[n]}</dt><dd class="${days[n]}"><ul class="coverList">${day.items.map(item => `<li style="background:url('//lain.bgm.tv/fixture.jpg')"><p><a href="/subject/${item.id}">站内标题 ${item.id}</a></p><p><a href="/subject/${item.id}">Original</a></p></li>`).join('')}</ul></dd></dl>`).join('')}</div></div></div>` : '<div id="home_calendar"><div class="original">原始每日放送</div></div>';
  return `<!doctype html><html data-theme="${theme}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:24px 16px;background:${theme === 'dark' ? '#181818' : '#fafafa'};font-family:Arial}main{max-width:${full ? 1100 : 817}px;margin:auto}#navMenuNeue{display:none}</style><body><nav id="navMenuNeue">${signedIn ? '<a href="/anime/list/test-user/do">在看</a>' : ''}</nav><main>${content}</main></body></html>`;
}
function collectionHTML(type, page, options) {
  const siteRows = [...rows, { subject_id: privateId, type: 3 }].filter(row => row.type === type);
  const batch = page === 1 ? siteRows.slice(0, 2) : siteRows.slice(2);
  const next = page === 1 && siteRows.length > 2;
  return `<!doctype html><meta charset="utf-8"><nav id="navMenuNeue">${options.loggedOut ? '' : '<a href="/anime/list/test-user/do">在看</a>'}</nav><h1><a href="/user/test-user">用户</a></h1>${C.routes.slice(1).map((route, n) => `<a href="/anime/list/test-user/${route}">状态 (${[...rows, { subject_id: privateId, type: 3 }].filter(r => r.type === n + 1).length})</a>`).join('')}<ul id="browserItemList">${(options.truncated && page === 2 ? [] : batch).map(r => `<li id="item_${r.subject_id}"><div>private comment, never cache</div></li>`).join('')}</ul><div class="page_inner">${next ? `<a href="/anime/list/test-user/${C.routes[type]}?page=2">››</a>` : ''}</div>`;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const report = [];
  fs.mkdirSync('artifacts', { recursive: true });
  async function fixture(options = {}) {
    const context = await browser.newContext({ viewport: { width: options.width || 1200, height: 1000 } });
    const page = await context.newPage(), requests = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url()); requests.push(url.href);
      if (url.hostname === 'lain.bgm.tv') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="100"><rect width="72" height="100" fill="#c1b4ae"/></svg>' });
      if (url.hostname === 'api.bgm.tv') {
        if (options.fail) return route.fulfill({ status: 503, body: '{}' });
        if (url.pathname === '/calendar') return route.fulfill({ json: calendar });
        const offset = Number(url.searchParams.get('offset'));
        const data = options.empty ? [] : rows;
        return route.fulfill({ json: { total: data.length, offset, data: options.partial && offset ? [] : data.slice(offset, offset + 7) } });
      }
      if (url.hostname === 'bgm.tv') {
        const match = url.pathname.match(/^\/anime\/list\/test-user\/([^/]+)$/);
        if (match) return route.fulfill({ contentType: 'text/html', body: collectionHTML(C.routes.indexOf(match[1]), Number(url.searchParams.get('page') || 1), options) });
        if (options.fail && url.pathname === '/calendar' && !options.full) return route.fulfill({ status: 503, body: '' });
        return route.fulfill({ contentType: 'text/html', body: pageHTML(options.full || url.pathname === '/calendar', options.signedIn !== false, options.theme) });
      }
      return route.abort();
    });
    await page.goto(`https://bgm.tv/${options.full ? 'calendar' : ''}${options.off ? '?personal=off' : ''}`);
    await page.addScriptTag({ content: release });
    return { context, page, requests, errors, options };
  }
  try {
    for (const [width, full, theme] of [[1200, false, 'light'], [667, false, 'light'], [375, false, 'light'], [1200, true, 'light'], [375, true, 'dark'], [1200, false, 'dark']]) {
      const f = await fixture({ width, full, theme }); const p = f.page;
      await p.locator('.board').waitFor({ state: 'visible' });
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const expectedColumns = full && width === 1200 ? 4 : width === 1200 ? 3 : width === 667 ? 2 : 1;
      assert.equal(await p.locator('.day').count(), expectedColumns);
      const adjacentDays = await p.locator('.day').evaluateAll(elements => elements.map(day => Number(day.dataset.weekday)));
      const navLabels = await p.locator('.days button').allTextContents();
      assert.deepEqual(navLabels, C.weekdays.slice(1));
      const todayIndex = Number(await p.locator('.days button.today').getAttribute('data-day'));
      const todayWeekday = C.weekdays.indexOf(navLabels[todayIndex]);
      const firstWeekday = ((todayWeekday - 1 - Math.floor((expectedColumns - 1) / 2) + 7) % 7) + 1;
      assert.deepEqual(adjacentDays, Array.from({ length: expectedColumns }, (_, i) => ((firstWeekday - 1 + i) % 7) + 1));
      assert.equal(await p.locator('.days button[aria-pressed="true"]').count(), 1);
      assert.equal(await p.locator('.days button.today').evaluate(button => getComputedStyle(button).fontWeight), '700');
      assert.equal(await p.locator('.days button:not(.today)').evaluateAll(buttons => buttons.some(button => getComputedStyle(button).fontWeight === '700')), false);
      assert.equal(await p.locator('.day.today').count(), 1);
      assert.equal(await p.locator('.title img').count(), 0);
      assert.equal(await p.locator('.subject[href$="4"]').count(), 0);
      assert.equal(await p.locator(full ? '#colunmSingle' : '.original').isVisible(), false);
      if (full) assert.ok((await p.locator('.title').first().innerText()).startsWith('站内标题'));
      assert.ok((await p.locator('.subject').count()) > 0);
      assert.equal(f.requests.filter(u => u.includes('/collections?')).length, 2);
      await p.getByRole('button', { name: '仅在看', exact: true }).click();
      for (const text of await p.locator('.state').allTextContents()) assert.equal(text, '在看');
      await p.getByRole('button', { name: '全部收藏', exact: true }).click();
      const total = f.requests.length;
      const initialDates = await p.locator('.day').evaluateAll(elements => elements.map(day => day.dataset.date));
      const initialSelected = await p.locator('.days button[aria-pressed="true"]').getAttribute('data-date');
      await p.getByRole('button', { name: '后一天' }).click();
      assert.deepEqual(await p.locator('.day').evaluateAll(elements => elements.map(day => day.dataset.date)), initialDates.map(date => C.shiftDate(date, 1)));
      assert.equal(await p.locator('.days button[aria-pressed="true"]').getAttribute('data-date'), C.shiftDate(initialSelected, 1));
      await p.getByRole('button', { name: '前一天' }).click();
      assert.deepEqual(await p.locator('.day').evaluateAll(elements => elements.map(day => day.dataset.date)), initialDates);
      await p.locator('[data-day="0"]').click(); // Monday
      await p.getByRole('button', { name: '前一天' }).click(); // Sunday before the week
      assert.equal(await p.locator('.days button[aria-pressed="true"]').getAttribute('data-day'), '6');
      assert.deepEqual(await p.locator('.day').evaluateAll(elements => elements.map(day => Number(day.dataset.weekday))), expectedColumns === 1 ? [7] : expectedColumns === 2 ? [7, 1] : [6, 7, 1, 2].slice(0, expectedColumns));
      await p.getByRole('button', { name: '后一天' }).click();
      await p.locator('.days button.today').click();
      assert.equal(f.requests.length, total); // navigation never refetches data
      await p.getByRole('button', { name: '显示原始放送表' }).click(); assert.equal(await p.locator(full ? '#colunmSingle' : '.original').isVisible(), true);
      await p.getByRole('button', { name: '返回我的放送表' }).click();
      await p.locator('[data-day="0"]').click();
      assert.equal(await p.locator('[data-day="0"]').evaluate(e => e.getRootNode().activeElement === e), true);
      await p.screenshot({ path: `artifacts/calendar-${full ? 'full' : 'home'}-${width}-${theme}.png`, fullPage: true });
      await p.reload(); await p.addScriptTag({ content: release }); await p.locator('.board').waitFor({ state: 'visible' });
      assert.equal(f.requests.filter(u => u.includes('/collections?')).length, 2);
      assert.deepEqual(f.errors, []); await f.context.close(); report.push(`${full ? 'calendar' : 'home'} ${width}px ${theme}: layout, safe titles, filtering, navigation, restore, cache passed`);
    }
    {
      const f = await fixture(); const p = f.page;
      await p.locator('.board').waitFor({ state: 'visible' });
      await p.getByRole('button', { name: '包含私密收藏', exact: true }).click();
      await p.getByRole('button', { name: '切换公开收藏', exact: true }).waitFor();
      assert.equal(await p.locator(`.subject[href="/subject/${privateId}"]`).count(), 1);
      const storage = await p.evaluate(() => Object.entries(localStorage).map(([key, value]) => ({ key, value })));
      assert.ok(!JSON.stringify(storage).includes('never cache')); assert.ok(!JSON.stringify(storage).includes('"rate"'));
      const ids = JSON.parse(storage.find(x => x.key.endsWith('collections:site')).value).value;
      assert.equal(ids.length, rows.length + 1); assert.ok(ids.some(x => x.id === privateId));
      f.options.fail = true; await p.getByRole('button', { name: '刷新', exact: true }).click();
      // Site mode remains available even if the public API fails.
      await p.getByRole('button', { name: '刷新', exact: true }).waitFor({ state: 'visible' });
      assert.deepEqual(f.errors, []); await f.context.close(); report.push('site sync: all five states, private membership, multi-page totals, minimal storage passed');
    }
    for (const kind of ['empty', 'fail', 'partial']) {
      const f = await fixture({ [kind]: true }); const p = f.page;
      if (kind === 'empty') { await p.locator('.board').waitFor({ state: 'visible' }); assert.ok(await p.getByText('这天没有收藏的番剧', { exact: true }).count()); }
      else { await p.locator('.message.error').waitFor(); assert.ok(await p.locator('.original').isVisible()); assert.equal(await p.locator('.board').isVisible(), false); }
      assert.deepEqual(f.errors, []); await f.context.close(); report.push(`${kind}: honest empty/error fallback passed`);
    }
    {
      const f = await fixture(); const p = f.page;
      await p.locator('.board').waitFor({ state: 'visible' }); f.options.truncated = true;
      await p.getByRole('button', { name: '包含私密收藏', exact: true }).click(); await p.locator('.message.error').waitFor();
      assert.equal(await p.locator(`.subject[href="/subject/${privateId}"]`).count(), 0);
      assert.equal(await p.evaluate(() => localStorage.getItem('bgm-personal-calendar:v1:test-user:collections:site')), null);
      f.options.truncated = false; f.options.loggedOut = true;
      await p.getByRole('button', { name: '包含私密收藏', exact: true }).click(); await p.getByText(/登录已失效/).waitFor();
      assert.ok(await p.locator('.board').isVisible()); await f.context.close(); report.push('partial site sync and expired login preserve the previous collection without saving incomplete data');
    }
    {
      const f = await fixture(); const p = f.page; await p.locator('.board').waitFor({ state: 'visible' });
      await p.getByRole('button', { name: '包含私密收藏', exact: true }).click();
      await p.getByRole('button', { name: '取消同步', exact: true }).click(); await p.getByText(/同步已取消/).waitFor();
      assert.ok(await p.locator('.board').isVisible());
      assert.equal(await p.evaluate(() => localStorage.getItem('bgm-personal-calendar:v1:test-user:collections:site')), null);
      assert.equal(await p.getByRole('button', { name: '刷新', exact: true }).isEnabled(), true);
      await f.context.close(); report.push('cancelled full sync preserves the old view and leaves no partial cache');
    }
    {
      const f = await fixture(); const p = f.page; await p.locator('.board').waitFor({ state: 'visible' });
      f.options.fail = true; await p.getByRole('button', { name: '刷新', exact: true }).click(); await p.locator('.message.error').waitFor();
      assert.ok(await p.locator('.board').isVisible()); assert.ok((await p.locator('.message').innerText()).includes('保留上次'));
      await f.context.close(); report.push('failed refresh preserves existing data and reports stale membership');
    }
    for (const options of [{ signedIn: false }, { full: true, off: true }]) {
      const f = await fixture(options); assert.equal(await f.page.locator('#bgm-personal-calendar').count(), 0); assert.equal(f.requests.filter(u => u.includes('api.bgm.tv')).length, 0); await f.context.close();
    }
    report.push('signed-out users and original-calendar link retain the original page without API calls');
    console.log(report.join('\n'));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
