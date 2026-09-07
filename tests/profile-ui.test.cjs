const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/profile-ui.js','utf8');
function ui(hostname, pathname, explicit = null, dark = false) {
  const context = { location:{hostname,pathname}, document:{querySelector:()=>null,documentElement:{getAttribute:()=>explicit,className:''},body:{className:''}},matchMedia:()=>({matches:dark}) };
  vm.createContext(context);vm.runInContext(source,context);return context.BangumiProfileUI;
}
test('profile widgets only mount on the exact wylt profile across site aliases',()=>{
  for(const host of ['bgm.tv','bangumi.tv','chii.in']) {
    assert.equal(ui(host,'/user/wylt').isProfile(),true);
    assert.equal(ui(host,'/user/wylt/').isProfile(),true);
    for(const path of ['/','/user/another','/user/wylt/blog','/anime/list/wylt'])assert.equal(ui(host,path).isProfile(),false);
  }
  assert.equal(ui('example.com','/user/wylt').isProfile(),false);
});
test('explicit site theme overrides the operating system',()=>{
  assert.equal(ui('bgm.tv','/user/wylt','light',true).theme(),'light');
  assert.equal(ui('bgm.tv','/user/wylt','dark',false).theme(),'dark');
  assert.equal(ui('bgm.tv','/user/wylt',null,true).theme(),'dark');
});
test('profile UI has no floating drawers, redundant headline statistics or decoration copy',()=>{
  for(const file of ['src/component.js','src/stats.js']) {
    const text=fs.readFileSync(file,'utf8');
    for(const unwanted of ['class="launcher"','class="scrim"','role="dialog"','aria-modal="true"','WATCHED ONLY','FOR YOU','总话数','今年已看','收藏样本'])assert.ok(!text.includes(unwanted),`${file}: ${unwanted}`);
  }
});
test('both widgets share profile mounting and appearance; algorithm stays independent',()=>{
  for(const file of ['src/component.js','src/stats.js'])assert.match(fs.readFileSync(file,'utf8'),/BangumiProfileUI\?\.mount/);
  assert.ok(!fs.readFileSync('src/core.cjs','utf8').includes('BangumiProfileUI'));
});
