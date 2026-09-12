// Run against the local preview server; uses an isolated Chrome profile, never the signed-in browser.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async()=>{
  const browser = await chromium.launch({channel:'chrome',headless:true});
  const page = await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const origin='http://127.0.0.1:8765';
  const report=[];
  try {
    for(const [width,height,theme] of [[1440,1000,'light'],[375,812,'light'],[667,375,'light'],[1440,1000,'dark']]) {
      await page.setViewportSize({width,height});
      await page.goto(`${origin}/demo/profile.html?theme=${theme}`);
      await page.locator('.year-chart').waitFor();
      await page.locator('.recommendation-card').first().waitFor();
      assert.equal(await page.locator('.recommendation-card').count(),5);
      assert.equal(await page.locator('.launcher,.scrim,[role="dialog"]').count(),0);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.deepEqual(await page.locator('#bgmpr-profile-sections').evaluate(e=>Array.from(e.children).map(x=>x.id)),['bgmstats-host','bgmpr-host']);
      await page.getByRole('button',{name:'标签',exact:true}).click();await page.locator('.tag-cloud.is-ready').waitFor();
      await page.getByRole('button',{name:'创作',exact:true}).click();assert.ok(await page.locator('[data-search="staff"]').isVisible());
      await page.getByRole('button',{name:'声优',exact:true}).click();assert.ok(await page.locator('[data-search="cast"]').isVisible());
      await page.getByRole('button',{name:'年代',exact:true}).click();
      await page.locator('[data-page-direction="1"]').click();assert.equal(await page.locator('[data-page-select]').inputValue(),'2');
      await page.locator('[data-page-select]').selectOption('4');assert.equal(await page.locator('.recommendation-card').count(),3);
      await page.locator('[data-page-select]').selectOption('1');
      const first=await page.locator('.cover').first().getAttribute('href');
      await page.locator('.evidence-panel summary').first().click();
      await page.locator('[data-dismiss-id]').first().click();assert.notEqual(await page.locator('.cover').first().getAttribute('href'),first);
      await page.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await page.locator('.cover').first().getAttribute('href'),first);
      await page.screenshot({path:`artifacts/profile-${width}-${height}-${theme}.png`,fullPage:true});
      report.push(`${width}×${height} ${theme}: layout, tabs, pagination, details, dismiss/undo passed`);
    }
    for(const state of ['empty','error']) {
      // Isolate storage so a previous successful fixture cannot mask an error.
      const context=await browser.newContext();const probe=await context.newPage();
      await probe.goto(`${origin}/demo/profile.html?${state}=1`);
      await probe.locator('#bgmstats-host').waitFor();
      if(state==='error')await probe.locator('.error').waitFor();
      else await probe.locator('.welcome').waitFor();
      await context.close();report.push(`${state} state passed`);
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.cover img').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
    assert.deepEqual(errors,[]);
    console.log(report.join('\n'));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
