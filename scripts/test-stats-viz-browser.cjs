const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const preview = require('./static-server.cjs');
(async () => {
  const server = await preview.start(0);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({channel:'chrome',headless:true});
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin);
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('bgmpr-stats', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('kv');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const tx = db.transaction('kv','readwrite'), store = tx.objectStore('kv');
      for(let i=1;i<=80;i++){
        const id=i<40?1:i%15;
        store.put({storedAt:Date.now(),value:[{id:100+id,name:['山田尚子','今敏','新房昭之','汤浅政明','高畑勋'][id%5],relation:'导演',type:1,eps:''}]},'stats:v1:wylt:people:'+i);
        store.put({storedAt:Date.now(),value:[{id:i,name:'角色',relation:'主角',actors:[{id:200+id,name:['花泽香菜','悠木碧','早见沙织','坂本真绫','钉宫理惠'][id%5]}]}]},'stats:v1:wylt:cast:'+i);
      }
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
    });
    for(const [width,height,theme] of [[1440,1000,'light'],[375,812,'light'],[667,375,'light'],[1440,1000,'dark']]) {
      await page.setViewportSize({width,height});
      await page.goto(origin + '/demo/profile.html?theme='+theme);
      await page.locator('.year-chart').waitFor();
      const labels=await page.locator('.year-column').evaluateAll(nodes=>nodes.map(el=>el.getAttribute('aria-label')));
      assert.equal(labels.length,47);assert.ok(labels[0].startsWith('2026'));assert.ok(labels.at(-1).startsWith('1980'));
      assert.deepEqual(await page.locator('[data-action="tab"]').allTextContents(),['年代','标签','创作','声优']);
      assert.equal(await page.locator('[data-action="year-page"]').count(),0);
      await page.locator('.year-column').first().focus();await page.keyboard.press('ArrowRight');
      assert.ok(await page.locator('.year-column').nth(1).evaluate(el=>el===el.getRootNode().activeElement));
      await page.locator('#bgmstats-host').screenshot({path:'artifacts/years-'+width+'-'+theme+'.png'});
      await page.getByRole('button',{name:'标签',exact:true}).click();
      await page.locator('.rank-axis').waitFor();
      const expectedTags=await page.evaluate(()=>BangumiStatsViz.featuredTags(BangumiPersonalStatsCore.aggregate(fixtureCollections).distributions.tags).length);
      assert.deepEqual(await page.locator('.rank').evaluateAll(nodes=>nodes.map(node=>node.textContent)),['1','2','3','4','5','6','7','8','9','10','11','12']);
      const tagCounts=await page.locator('.person-meta').evaluateAll(nodes=>nodes.map(node=>Number(node.textContent.replace(/[^\d]/g,''))));
      assert.ok(tagCounts.every((value,index)=>index===0||tagCounts[index-1]>=value),'tag counts must descend');
      assert.ok(tagCounts.every(value=>value>10),'only tags over ten works are ranked');
      assert.match(await page.locator('.people-list a').first().getAttribute('href'),/^\/search\/tag\/anime\//);
      assert.equal(await page.locator('[data-page-kind="tags"]').count()>0,expectedTags>12);
      await page.locator('#bgmstats-host').screenshot({path:'artifacts/tags-'+width+'-'+theme+'.png'});
      await page.locator('[data-sort-kind="tags"][data-sort="average"]').click();
      assert.match(await page.locator('.rank-axis').innerText(),/10 分/);
      const tagScores=await page.locator('.person-meta').evaluateAll(nodes=>nodes.map(node=>Number(node.textContent)));
      assert.ok(tagScores.every((value,index)=>index===0||tagScores[index-1]>=value),'average scores must descend');
      const tagShare=await page.locator('.person-bar').first().evaluate(el=>parseFloat(el.style.getPropertyValue('--share')));
      assert.ok(Math.abs(tagShare-tagScores[0]*10)<.1);
      assert.match(await page.locator('.sort-row small').innerText(),/20 部以上/);
      const eligibleAverage=await page.evaluate(()=>BangumiStatsViz.featuredTags(BangumiPersonalStatsCore.aggregate(fixtureCollections).distributions.tags).filter(row=>row.count>=20&&row.ratedCount>0).length);
      assert.equal(await page.locator('.person-bar').count(),Math.min(12,eligibleAverage));
      await page.locator('[data-sort-kind="tags"][data-sort="works"]').click();
      const firstTagName=await page.locator('.people-list a').first().innerText();
      await page.locator('[data-search="tags"]').fill(firstTagName);
      await page.waitForFunction(name=>{const links=[...document.querySelector('#bgmstats-host').shadowRoot.querySelectorAll('.people-list a')];return links.length&&links.every(a=>a.textContent.includes(name));},firstTagName);
      await page.locator('[data-search="tags"]').fill('没有这个标签');await page.locator('.content .empty').waitFor();
      assert.match(await page.locator('.content .empty').innerText(),/标签/);
      await page.locator('[data-search="tags"]').fill('');
      await page.locator('.people-list').waitFor();
      await page.getByRole('button',{name:'创作',exact:true}).click();assert.equal(await page.locator('.person-bar').count(),12);
      const rankOrder=await page.locator('.rank').evaluateAll(nodes=>nodes.map(node=>node.textContent));
      const leftColumn=await page.locator('.people-list li').evaluateAll(nodes=>nodes.slice(0,6).map(node=>node.getBoundingClientRect().left));
      const rightColumn=await page.locator('.people-list li').evaluateAll(nodes=>nodes.slice(6).map(node=>node.getBoundingClientRect().left));
      assert.deepEqual(rankOrder,['1','2','3','4','5','6','7','8','9','10','11','12']);
      if(width>500){assert.equal(new Set(leftColumn).size,1);assert.equal(new Set(rightColumn).size,1);assert.ok(rightColumn[0]>leftColumn[0]);}
      await page.locator('[data-sort-kind="staff"][data-sort="average"]').click();assert.match(await page.locator('.rank-axis').innerText(),/10 分/);
      const share=await page.locator('.person-bar').first().evaluate(el=>parseFloat(el.style.getPropertyValue('--share')));
      const score=Number(await page.locator('.person-meta').first().innerText());assert.ok(Math.abs(share-score*10)<.1);
      await page.locator('[data-sort-kind="staff"][data-sort="works"]').click();
      await page.locator('#bgmstats-host').screenshot({path:'artifacts/people-'+width+'-'+theme+'.png'});
      await page.getByRole('button',{name:'声优',exact:true}).click();assert.equal(await page.locator('.person-bar').count(),12);
      await page.locator('[data-search="cast"]').fill('没有这个声优');await page.locator('.content .empty').waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      console.log(width+'×'+height+' '+theme+': descending years, tag ranking, column order passed');
    }
    // Resize while the tag ranking stays open, not just on a fresh render.
    await page.getByRole('button',{name:'标签',exact:true}).click();await page.locator('.people-list').waitFor();
    await page.setViewportSize({width:375,height:812});
    await page.locator('.people-list').waitFor();
    assert.equal(await page.locator('.person-bar').count(),12);
    await page.emulateMedia({reducedMotion:'reduce'});
    const denseContext=await browser.newContext({viewport:{width:375,height:812}});
    const densePage=await denseContext.newPage();
    await densePage.goto(origin + '/demo/profile.html?dense=1');
    await densePage.locator('.year-chart').waitFor();
    await densePage.getByRole('button',{name:'标签',exact:true}).click();
    await densePage.locator('.people-list').waitFor();
    assert.equal(await densePage.locator('.people-list li').count(),2);
    const denseCheck=await densePage.locator('.people-list').evaluate(el=>{
      const bounds=el.getBoundingClientRect(), boxes=Array.from(el.querySelectorAll('li')).map(row=>row.getBoundingClientRect());
      return {overflow:boxes.some(a=>a.left<bounds.left-1||a.right>bounds.right+1),rows:boxes.length};
    });
    assert.deepEqual(denseCheck,{overflow:false,rows:2});
    await denseContext.close();
    console.log('702-tag dataset: rare tags filtered, the two qualified tags stay inside the column');
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
