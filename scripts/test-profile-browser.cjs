// Run against the local preview server; uses an isolated Chrome profile, never the signed-in browser.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const preview = require('./static-server.cjs');
(async()=>{
  const server = await preview.start(0);
  const browser = await chromium.launch({channel:'chrome',headless:true});
  const page = await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const origin='http://127.0.0.1:' + server.address().port;
  const report=[];
  try {
    for(const [width,height,theme] of [[1440,1000,'light'],[375,812,'light'],[667,375,'light'],[1440,1000,'dark']]) {
      await page.setViewportSize({width,height});
      await page.goto(`${origin}/demo/profile.html?theme=${theme}`);
      await page.locator('.year-chart').waitFor();
      await page.locator('.rec-card').first().waitFor();
      assert.equal(await page.locator('[data-module="anime"] .rec-card').count(),5);
      assert.equal(await page.locator('[data-module="book"] .rec-card').count(),5);
      // 卡片只有封面、名字、推荐评分与一行小字，没有其他冗余内容。
      const anatomy = await page.locator('[data-module="anime"] .rec-card').first().evaluate(node => ({
        children: node.children.length,
        cover: node.querySelectorAll('.cover').length,
        name: node.querySelectorAll('.rec-name').length,
        final: node.querySelectorAll('.rec-final').length,
        parts: node.querySelectorAll('.rec-parts').length,
      }));
      assert.deepEqual(anatomy, {children:4, cover:1, name:1, final:1, parts:1});
      assert.match(await page.locator('[data-module="anime"] .rec-name a').first().getAttribute('href'), /\/subject\/\d+$/);
      assert.match(await page.locator('[data-module="anime"] .cover').first().getAttribute('href'), /\/subject\/\d+$/);
      assert.match(await page.locator('[data-module="anime"] .rec-final').first().textContent(), /^\d\.\d{2}$/);
      assert.match(await page.locator('[data-module="anime"] .rec-parts').first().textContent(), /标签评分 (\d\.\d{2}|—) · 全站评分 \d\.\d{2}/);
      // 长标题两行截断：评分行不会被标题行数顶得高低不齐。
      const clamp = await page.locator('[data-module="anime"] .rec-name').first().evaluate(node => getComputedStyle(node).webkitLineClamp);
      assert.equal(clamp, '2');
      assert.equal(await page.locator('.launcher,.scrim,[role="dialog"],[data-dismiss-id],.evidence-panel,.summary').count(),0);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.deepEqual(await page.locator('#bgmpr-profile-sections').evaluate(e=>Array.from(e.children).map(x=>x.id)),['bgmstats-host','bgmpr-host']);
      // 分页：上一页/下一页与页码下拉，动画 30 部 6 页、书籍 20 部 4 页。
      await page.locator('[data-module="anime"] [data-page-direction="1"]').click();
      assert.equal(await page.locator('[data-module="anime"] [data-page-select]').inputValue(),'2');
      await page.locator('[data-module="anime"] [data-page-select]').selectOption('6');
      assert.equal(await page.locator('[data-module="anime"] .rec-card').count(),5);
      await page.locator('[data-module="anime"] [data-page-select]').selectOption('1');
      assert.equal(await page.locator('[data-module="book"] [data-page-select] option').count(),4);
      await page.screenshot({path:`artifacts/profile-${width}-${height}-${theme}.png`,fullPage:true});
      report.push(`${width}×${height} ${theme}: minimal cards, both modules, pagination passed`);
    }
    for(const state of ['empty','error']) {
      // Isolate storage so a previous successful fixture cannot mask an error.
      const context=await browser.newContext();const probe=await context.newPage();
      await probe.goto(`${origin}/demo/profile.html?${state}=1`);
      await probe.locator('#bgmstats-host').waitFor();
      if(state==='empty'){
        await probe.locator('[data-module="anime"] .empty').waitFor();
        assert.match(await probe.locator('[data-module="anime"] .empty').textContent(),/暂无推荐结果/);
      } else {
        await probe.locator('[data-module="anime"] .error').waitFor();
        assert.match(await probe.locator('[data-module="anime"] .error').textContent(),/更新失败/);
      }
      await context.close();report.push(`${state} state passed`);
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto(`${origin}/demo/profile.html`);
    await page.locator('.rec-card').first().waitFor();
    assert.equal(await page.locator('.rec-card img').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
    assert.deepEqual(errors,[]);
    console.log('PASS: ' + report.join('; ') + '; reduced motion respected; no page errors');
  } finally { await browser.close(); server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
