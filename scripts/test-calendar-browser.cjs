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
const rows = calendar.flatMap((day, n) => day.items.slice(0, 2).map((item, i) => ({ subject_id: item.id, type: i ? 2 : [1, 3, 4, 5][n % 4], rate: 8, private: false, comment: 'never cache this' })));
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
    const context = await browser.newContext({ viewport: { width: options.width || 1200, height: 1000 }, timezoneId: 'Asia/Shanghai' });
    const page = await context.newPage(), requests = [], errors = [];
    let releaseCalendar, calendarRequests = 0;
    const calendarGate = new Promise(resolve => { releaseCalendar = resolve; });
    if (options.time) await page.clock.install({ time: new Date(options.time) });
    page.on('pageerror', e => errors.push(e.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url()); requests.push(url.href);
      if (url.hostname === 'lain.bgm.tv') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="100"><rect width="72" height="100" fill="#c1b4ae"/></svg>' });
      if (url.hostname === 'api.bgm.tv') {
        if (url.pathname === '/calendar') {
          const index = ++calendarRequests;
          // Capture the old response before a later forced refresh can finish.
          const value = options.scheduleTitles ? calendar.map(day => ({ ...day, items: day.items.map(item => ({ ...item, name_cn: `${index === 1 ? '后台旧响应' : '手动新响应'} ${item.id}` })) })) : calendar;
          if (options.holdCalendar && index === 1) await calendarGate;
          if (options.fail) return route.fulfill({ status: 503, body: '{}' });
          return route.fulfill({ json: value });
        }
        if (options.fail) return route.fulfill({ status: 503, body: '{}' });
        const offset = Number(url.searchParams.get('offset'));
        const data = options.empty ? [] : rows.map(row => ({ ...row, type: options.completed && row.subject_id === today * 10 + 1 ? 2 : row.type }));
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
    if (options.siteMode) await page.addInitScript(() => localStorage.setItem('bgm-personal-calendar:v1:test-user:mode', '"site"'));
    if (options.cached) await page.addInitScript(({ rows, calendar, privateId, options }) => {
      const prefix = 'bgm-personal-calendar:v1:test-user:', mode = options.siteMode ? 'site' : 'public';
      const at = Date.now() - (options.cacheAge ?? 10 * 86400000);
      if (!localStorage.getItem(prefix + `collections:${mode}`)) localStorage.setItem(prefix + `collections:${mode}`, options.corrupt ? '{broken' : JSON.stringify({ at, value: options.empty ? [] : [...rows.map(row => ({ id: row.subject_id, type: row.type })), ...(options.siteMode ? [{ id: privateId, type: 3 }] : []), ...Array.from({ length: options.large ? 5000 : 0 }, (_, n) => ({ id: 10000 + n, type: 2 }))] }));
      if (!localStorage.getItem(prefix + 'calendar')) localStorage.setItem(prefix + 'calendar', JSON.stringify({ at, value: calendar }));
    }, { rows, calendar, privateId, options });
    await page.goto(`https://bgm.tv/${options.full ? 'calendar' : ''}${options.off ? '?personal=off' : ''}`);
    await page.addScriptTag({ content: release });
    return { context, page, requests, errors, options, releaseCalendar };
  }
  try {
    for (const options of [
      { cached: true, cacheAge: 0, large: true },
      { cached: true, holdCalendar: true },
      { cached: true, siteMode: true, holdCalendar: true },
      { cached: true, empty: true, holdCalendar: true },
      { cached: true, full: true }
    ]) {
      const f = await fixture(options), p = f.page;
      // The schedule request is still blocked: the first view must already exist.
      assert.equal(await p.locator('.board').isVisible(), true);
      assert.equal(await p.locator('.refresh').innerText(), '刷新核对个人收藏');
      assert.equal(await p.locator('.refresh').isEnabled(), true);
      assert.equal(f.requests.filter(u => /\/collections\?|\/anime\/list\//.test(u)).length, 0);
      if (options.full) assert.ok((await p.locator('.title').first().innerText()).startsWith('站内标题'));
      if (options.siteMode) assert.equal(await p.locator(`.subject[href="/subject/${privateId}"]`).count(), 1);
      if (options.empty) assert.equal(await p.locator('.subject').count(), 0);
      const stored = await p.evaluate(() => Object.entries(localStorage).find(([key]) => key.includes('collections:')));
      if (options.holdCalendar) {
        const response = p.waitForResponse('https://api.bgm.tv/calendar');
        f.releaseCalendar(); await response;
        await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
      await p.reload(); await p.addScriptTag({ content: release });
      assert.equal(await p.locator('.board').isVisible(), true);
      assert.equal(f.requests.filter(u => /\/collections\?|\/anime\/list\//.test(u)).length, 0);
      assert.deepEqual(await p.evaluate(() => Object.entries(localStorage).find(([key]) => key.includes('collections:'))), stored);
      assert.deepEqual(f.errors, []); await f.context.close(); report.push(`cached ${options.full ? 'full page' : options.siteMode ? 'site' : options.empty ? 'empty' : options.large ? '5014 entries' : '10-day-old'}: immediate display, no collection requests or timestamp changes`);
    }
    {
      const f = await fixture({ cached: true, fail: true }), p = f.page;
      assert.equal(await p.locator('.board').isVisible(), true);
      await p.locator('.message.error').waitFor();
      assert.equal(await p.locator('.board').isVisible(), true);
      assert.ok((await p.locator('.message').innerText()).includes('保留上次放送'));
      assert.equal(f.requests.filter(u => /\/collections\?|\/anime\/list\//.test(u)).length, 0);
      assert.deepEqual(f.errors, []); await f.context.close(); report.push('failed schedule revalidation preserves the immediately displayed collection without a full collection sync');
    }
    {
      const f = await fixture({ cached: true, corrupt: true }), p = f.page;
      await p.locator('.board').waitFor({ state: 'visible' });
      assert.equal(f.requests.filter(u => u.includes('/collections?')).length, 2);
      assert.deepEqual(f.errors, []); await f.context.close(); report.push('damaged collection storage is repaired by a complete first sync');
    }
    {
      const f = await fixture({ cached: true, holdCalendar: true, scheduleTitles: true }), p = f.page;
      assert.equal(await p.locator('.board').isVisible(), true);
      await p.getByRole('button', { name: '刷新核对个人收藏' }).click();
      await p.locator('.title').first().filter({ hasText: '手动新响应' }).waitFor();
      await p.waitForFunction(() => !document.querySelector('#bgm-personal-calendar').shadowRoot.querySelector('.refresh').disabled);
      const storedCalendar = await p.evaluate(() => localStorage.getItem('bgm-personal-calendar:v1:test-user:calendar'));
      const response = p.waitForResponse('https://api.bgm.tv/calendar');
      f.releaseCalendar(); await response;
      await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok((await p.locator('.title').first().innerText()).startsWith('手动新响应'));
      assert.equal(await p.evaluate(() => localStorage.getItem('bgm-personal-calendar:v1:test-user:calendar')), storedCalendar);
      assert.equal(f.requests.filter(u => u.includes('/collections?')).length, 2);
      assert.deepEqual(f.errors, []); await f.context.close(); report.push('late background schedule response cannot overwrite a successful manual refresh or its cache');
    }
    for (const [width, full, theme] of [[1200, false, 'light'], [667, false, 'light'], [375, false, 'light'], [1200, true, 'light'], [375, true, 'dark'], [1200, false, 'dark']]) {
      const f = await fixture({ width, full, theme }); const p = f.page;
      await p.locator('.board').waitFor({ state: 'visible' });
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const expectedColumns = full && width === 1200 ? 4 : width === 1200 ? 3 : width === 667 ? 2 : 1;
      assert.equal(await p.locator('.day').count(), expectedColumns);
      const adjacentDays = await p.locator('.day').evaluateAll(elements => elements.map(day => Number(day.dataset.weekday)));
      const navLabels = await p.locator('.days button').allTextContents();
      assert.deepEqual(navLabels, C.weekdays.slice(1));
      const todayIndex = Number(await p.locator('.days button[aria-current="date"]').getAttribute('data-day'));
      const todayWeekday = C.weekdays.indexOf(navLabels[todayIndex]);
      const firstWeekday = ((todayWeekday - 1 - Math.floor((expectedColumns - 1) / 2) + 7) % 7) + 1;
      assert.deepEqual(adjacentDays, Array.from({ length: expectedColumns }, (_, i) => ((firstWeekday - 1 + i) % 7) + 1));
      assert.equal(await p.locator('.days button[aria-pressed="true"]').count(), 1);
      assert.equal(await p.locator('.days button[aria-pressed="true"]').getAttribute('aria-current'), 'date');
      assert.equal(await p.locator('.days button[aria-pressed="true"]').evaluate(button => getComputedStyle(button).fontWeight), '700');
      assert.equal(await p.locator('.days button[aria-pressed="true"]').evaluate(button => getComputedStyle(button, '::before').height), '3px');
      assert.equal(await p.locator('.days button:not([aria-pressed="true"])').evaluateAll(buttons => buttons.some(button => getComputedStyle(button).fontWeight === '700' || getComputedStyle(button, '::before').content !== 'none')), false);
      assert.equal(await p.locator('.day.today').count(), 1);
      assert.equal(await p.locator('.title img').count(), 0);
      assert.equal(await p.locator('.subject[href$="4"]').count(), 0);
      assert.equal(await p.locator('.toolbar > button').count(), 1); // only one data action; today is date navigation
      assert.equal(await p.locator('.panel').evaluate(e => getComputedStyle(e).borderRadius), '15px');
      assert.equal(await p.locator('.today-jump').innerText(), `今天 · ${C.weekdays[today]}`);
      assert.equal(await p.locator('.subject[href$="2"]').count(), 0); // completed entries never render
      assert.equal(await p.locator('.toolbar .refresh').innerText(), '刷新核对个人收藏');
      for (const selector of ['.filters', '.complete', '.restore', '.cancel', '.foot', '.note', '.top-link', '.state', '.loading']) assert.equal(await p.locator(selector).count(), 0, selector);
      assert.equal(await p.locator(full ? '#colunmSingle' : '.original').isVisible(), false);
      if (full) assert.ok((await p.locator('.title').first().innerText()).startsWith('站内标题'));
      assert.ok((await p.locator('.subject').count()) > 0);
      assert.equal(f.requests.filter(u => u.includes('/collections?')).length, 2);
      const total = f.requests.length;
      const initialDates = await p.locator('.day').evaluateAll(elements => elements.map(day => day.dataset.date));
      const initialSelected = await p.locator('.days button[aria-pressed="true"]').getAttribute('data-date');
      await p.getByRole('button', { name: '后一天' }).click();
      assert.deepEqual(await p.locator('.day').evaluateAll(elements => elements.map(day => day.dataset.date)), initialDates.map(date => C.shiftDate(date, 1)));
      assert.equal(await p.locator('.days button[aria-pressed="true"]').getAttribute('data-date'), C.shiftDate(initialSelected, 1));
      assert.equal(await p.locator('.days button[aria-pressed="true"]').evaluate(button => getComputedStyle(button, '::before').height), '3px');
      assert.notEqual(await p.locator('.days button[aria-pressed="true"]').evaluate(button => getComputedStyle(button).color), await p.locator('.days button:not([aria-pressed="true"])').first().evaluate(button => getComputedStyle(button).color));
      assert.equal(await p.locator('.today-jump').innerText(), `今天 · ${C.weekdays[today]}`);
      await p.getByRole('button', { name: '前一天' }).click();
      assert.deepEqual(await p.locator('.day').evaluateAll(elements => elements.map(day => day.dataset.date)), initialDates);
      await p.locator('[data-day="0"]').click(); // Monday
      assert.equal(await p.locator('.days button[aria-pressed="true"]').getAttribute('data-day'), '0');
      assert.equal(await p.locator('.days button[aria-pressed="true"]').evaluate(button => getComputedStyle(button, '::before').height), '3px');
      await p.getByRole('button', { name: '前一天' }).click(); // Sunday before the week
      assert.equal(await p.locator('.days button[aria-pressed="true"]').getAttribute('data-day'), '6');
      assert.equal(await p.locator('.days button[aria-pressed="true"]').evaluate(button => getComputedStyle(button, '::before').height), '3px');
      assert.deepEqual(await p.locator('.day').evaluateAll(elements => elements.map(day => Number(day.dataset.weekday))), expectedColumns === 1 ? [7] : expectedColumns === 2 ? [7, 1] : [6, 7, 1, 2].slice(0, expectedColumns));
      await p.getByRole('button', { name: '回到今天', exact: false }).click(); // works even outside the actual week
      assert.equal(await p.locator('.days button[aria-pressed="true"]').getAttribute('data-date'), initialSelected);
      assert.deepEqual(await p.locator('.day').evaluateAll(elements => elements.map(day => day.dataset.date)), initialDates);
      assert.equal(await p.locator('.today-jump').evaluate(e => e.getRootNode().activeElement === e), true);
      assert.equal(f.requests.length, total); // navigation never refetches data
      await p.getByRole('button', { name: '刷新核对个人收藏' }).click();
      await p.waitForFunction(() => { const button = document.querySelector('#bgm-personal-calendar')?.shadowRoot.querySelector('.refresh'); return button && !button.disabled && button.textContent === '刷新核对个人收藏'; });
      assert.ok(f.requests.length > total); // the one manual action forces a fresh check
      await p.screenshot({ path: `artifacts/calendar-${full ? 'full' : 'home'}-${width}-${theme}.png`, fullPage: true });
      await p.locator('[data-day="0"]').click();
      assert.equal(await p.locator('[data-day="0"]').evaluate(e => e.getRootNode().activeElement === e), true);
      await p.reload(); await p.addScriptTag({ content: release }); await p.locator('.board').waitFor({ state: 'visible' });
      assert.equal(f.requests.filter(u => u.includes('/collections?')).length, 4);
      assert.deepEqual(f.errors, []); await f.context.close(); report.push(`${full ? 'calendar' : 'home'} ${width}px ${theme}: layout, minimal controls, safe titles, navigation, cache passed`);
    }
    for (const manual of [false, true]) {
      const f = await fixture({ time: '2026-10-04T23:59:00+08:00' }); const p = f.page;
      await p.locator('.board').waitFor({ state: 'visible' });
      if (manual) await p.locator('[data-day="2"]').click();
      const selected = await p.locator('.days button[aria-pressed="true"]').getAttribute('data-date');
      const total = f.requests.length;
      await p.clock.runFor(61000);
      assert.equal(await p.locator('.today-jump').innerText(), '今天 · 周一');
      assert.equal(await p.locator('.days button[aria-pressed="true"]').getAttribute('data-date'), manual ? selected : '2026-10-05');
      await p.getByRole('button', { name: '回到今天', exact: false }).click();
      assert.equal(await p.locator('.days button[aria-pressed="true"]').getAttribute('data-date'), '2026-10-05');
      assert.equal(await p.locator('.day.today').getAttribute('data-date'), '2026-10-05');
      assert.equal(f.requests.length, total);
      assert.deepEqual(f.errors, []); await f.context.close(); report.push(`midnight ${manual ? 'manual' : 'automatic'}: real today advances, browsing is preserved, today jump resets selection without requests`);
    }
    {
      const f = await fixture(); const p = f.page;
      await p.locator('.board').waitFor({ state: 'visible' });
      const subject = p.locator(`.subject[href="/subject/${today * 10 + 1}"]`);
      assert.equal(await subject.count(), 1);
      f.options.completed = true;
      await p.getByRole('button', { name: '刷新核对个人收藏' }).click();
      await subject.waitFor({ state: 'detached' });
      assert.equal(await p.locator('.subject[href$="2"]').count(), 0);
      assert.equal(await p.locator('.message.error').count(), 0);
      assert.deepEqual(f.errors, []); await f.context.close(); report.push('completed status changes disappear after a successful refresh');
    }
    {
      const f = await fixture({ siteMode: true }); const p = f.page;
      await p.locator('.board').waitFor({ state: 'visible' });
      assert.equal(await p.locator(`.subject[href="/subject/${privateId}"]`).count(), 1);
      const storage = await p.evaluate(() => Object.entries(localStorage).map(([key, value]) => ({ key, value })));
      assert.ok(!JSON.stringify(storage).includes('never cache')); assert.ok(!JSON.stringify(storage).includes('"rate"'));
      const ids = JSON.parse(storage.find(x => x.key.endsWith('collections:site')).value).value;
      assert.equal(ids.length, rows.length + 1); assert.ok(ids.some(x => x.id === privateId));
      f.options.fail = true; await p.getByRole('button', { name: '刷新核对个人收藏' }).click(); await p.locator('.message.error').waitFor();
      assert.ok(await p.locator('.board').isVisible());
      assert.deepEqual(f.errors, []); await f.context.close(); report.push('remembered site mode: all five states, private membership, multi-page totals, minimal storage passed');
    }
    for (const kind of ['empty', 'fail', 'partial']) {
      const f = await fixture({ [kind]: true }); const p = f.page;
      if (kind === 'empty') { await p.locator('.board').waitFor({ state: 'visible' }); assert.ok(await p.getByText('暂无条目', { exact: true }).count()); }
      else { await p.locator('.message.error').waitFor(); assert.ok(await p.locator('.original').isVisible()); assert.equal(await p.locator('.board').isVisible(), false); }
      assert.deepEqual(f.errors, []); await f.context.close(); report.push(`${kind}: honest empty/error fallback passed`);
    }
    {
      const f = await fixture({ siteMode: true, truncated: true }); const p = f.page;
      await p.locator('.message.error').waitFor();
      assert.equal(await p.locator(`.subject[href="/subject/${privateId}"]`).count(), 0);
      assert.equal(await p.evaluate(() => localStorage.getItem('bgm-personal-calendar:v1:test-user:collections:site')), null);
      assert.ok(await p.locator('.original').isVisible()); await f.context.close(); report.push('partial site sync preserves the original view and writes no partial cache');
    }
    {
      const f = await fixture({ siteMode: true }); const p = f.page; await p.locator('.board').waitFor({ state: 'visible' });
      f.options.loggedOut = true;
      await p.getByRole('button', { name: '刷新核对个人收藏' }).click(); await p.getByText(/登录已失效/).waitFor();
      assert.ok(await p.locator('.board').isVisible()); await f.context.close(); report.push('expired site login preserves the previous collection');
    }
    {
      const f = await fixture(); const p = f.page; await p.locator('.board').waitFor({ state: 'visible' });
      f.options.fail = true; await p.getByRole('button', { name: '刷新核对个人收藏' }).click(); await p.locator('.message.error').waitFor();
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
