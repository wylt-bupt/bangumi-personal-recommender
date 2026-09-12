const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('http://127.0.0.1:8765');
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
    async function checkCloud() {
      await page.locator('.tag-cloud.is-ready').waitFor();
      const cloud = await page.locator('.tag-cloud').evaluate(el => {
        const root = el.getBoundingClientRect();
        return {width:root.width,height:root.height,words:Array.from(el.children).filter(word => !word.hidden).map(word => {
          const r=word.getBoundingClientRect();
          return {x:r.x-root.x,y:r.y-root.y,width:r.width,height:r.height,size:parseFloat(getComputedStyle(word).fontSize)};
        })};
      });
      cloud.words.forEach((a,i) => {
        assert.ok(a.x>=0 && a.x+a.width<=cloud.width+1 && a.y>=0 && a.y+a.height<=cloud.height+1);
        cloud.words.slice(i+1).forEach(b => assert.ok(a.x+a.width<=b.x || b.x+b.width<=a.x || a.y+a.height<=b.y || b.y+b.height<=a.y,'cloud overlap'));
      });
      assert.ok(cloud.height<=Math.max(cloud.width*(cloud.width>=460?1.8:2.6),260)+1,'cloud aspect ratio stretched too far');
      assert.ok(cloud.words[0].size>cloud.words.at(-1).size);
      return cloud;
    }
    for(const [width,height,theme] of [[1440,1000,'light'],[375,812,'light'],[667,375,'light'],[1440,1000,'dark']]) {
      await page.setViewportSize({width,height});
      await page.goto('http://127.0.0.1:8765/demo/profile.html?theme='+theme);
      await page.locator('.year-chart').waitFor();
      const labels=await page.locator('.year-column').evaluateAll(nodes=>nodes.map(el=>el.getAttribute('aria-label')));
      assert.equal(labels.length,47);assert.ok(labels[0].startsWith('2026'));assert.ok(labels.at(-1).startsWith('1980'));
      assert.deepEqual(await page.locator('[data-action="tab"]').allTextContents(),['年代','标签','创作','声优']);
      assert.equal(await page.locator('[data-action="year-page"]').count(),0);
      await page.locator('.year-column').first().focus();await page.keyboard.press('ArrowRight');
      assert.ok(await page.locator('.year-column').nth(1).evaluate(el=>el===el.getRootNode().activeElement));
      await page.locator('#bgmstats-host').screenshot({path:'artifacts/years-'+width+'-'+theme+'.png'});
      await page.getByRole('button',{name:'标签',exact:true}).click();
      const countCloud=await checkCloud();
      const expectedTags=await page.evaluate(()=>BangumiPersonalStatsCore.aggregate(fixtureCollections).distributions.tags.filter(row=>row.count>10).length);
      assert.equal(await page.locator('.cloud-word').count(),expectedTags);
      assert.equal(countCloud.words.length,expectedTags);
      assert.ok(await page.locator('.cloud-word').evaluateAll(nodes=>nodes.every(el=>Number(el.dataset.count)>10)));
      await page.locator('.cloud-word').first().click();assert.match(await page.locator('.viz-caption').innerText(),/日常 · \d+ 部/);
      await page.locator('#bgmstats-host').screenshot({path:'artifacts/cloud-'+width+'-'+theme+'.png'});
      await page.getByRole('button',{name:'个人均分',exact:true}).click();
      await page.locator('.tag-cloud.is-ready').waitFor();
      const averageCloud=await checkCloud();
      assert.equal(averageCloud.words.length,expectedTags);
      const averageSizeRatio=averageCloud.words[0].size/averageCloud.words.at(-1).size;
      assert.ok(averageSizeRatio>2.5,'average cloud hierarchy is too flat: '+averageSizeRatio);
      const averages=await page.locator('.cloud-word').evaluateAll(nodes=>nodes.map(el=>Number(el.dataset.value)));
      assert.ok(averages.every((value,index)=>index===0||averages[index-1]>=value));
      assert.match(await page.locator('.viz-caption').innerText(),/标签作品个人均分/);
      await page.locator('.cloud-word').first().click();assert.match(await page.locator('.viz-caption').innerText(),/个人均分 \d+\.\d{2}/);
      await page.locator('#bgmstats-host').screenshot({path:'artifacts/cloud-average-'+width+'-'+theme+'.png'});
      await page.getByRole('button',{name:'出现次数',exact:true}).click();
      assert.equal(await page.locator('[data-page-kind="tags"]').count(),0);
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
      console.log(width+'×'+height+' '+theme+': descending years, tag threshold/cloud, column order passed');
    }
    // Resize while the cloud stays open, not just on a fresh render.
    await page.getByRole('button',{name:'标签',exact:true}).click();await checkCloud();
    await page.setViewportSize({width:375,height:812});
    await page.waitForFunction(()=>{const el=document.querySelector('#bgmstats-host').shadowRoot.querySelector('.tag-cloud');return el.dataset.width===String(el.clientWidth);});
    await checkCloud();
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.cloud-word').first().evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
    const denseContext=await browser.newContext({viewport:{width:375,height:812}});
    const densePage=await denseContext.newPage();
    await densePage.goto('http://127.0.0.1:8765/demo/profile.html?dense=1');
    await densePage.locator('.year-chart').waitFor();
    await densePage.getByRole('button',{name:'标签',exact:true}).click();
    await densePage.locator('.tag-cloud.is-ready').waitFor();
    assert.equal(await densePage.locator('.cloud-word').count(),2);
    const denseCheck=await densePage.locator('.tag-cloud').evaluate(el=>{
      const bounds=el.getBoundingClientRect(), boxes=Array.from(el.children).map(word=>word.getBoundingClientRect());
      return {overflow:boxes.some(a=>a.left<bounds.left||a.right>bounds.right||a.top<bounds.top||a.bottom>bounds.bottom),overlap:boxes.some((a,i)=>boxes.slice(i+1).some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top))};
    });
    assert.deepEqual(denseCheck,{overflow:false,overlap:false});
    await denseContext.close();
    console.log('702-tag dataset: rare tags filtered, remaining tags have no clipping/overlap');
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
