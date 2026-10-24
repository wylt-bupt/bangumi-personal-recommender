const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('user design principles are complete in the project collaboration file', () => {
  const source = fs.readFileSync('AGENTS.md', 'utf8');
  for (const principle of ['显式需求优先于模型惯性', '警惕同质化输出', '先调研已有最佳实践，再动手创作', '双重视角验收', '非功能指标是一等约束', '承认知识边界，以闭环逼近目标']) {
    assert.ok(source.includes(principle), principle);
  }
  assert.match(source, /Documentation-only/);
  assert.match(source, /docs\/development\.md/);
});

test('managed documentation has no broken relative Markdown links', () => {
  for (const file of ['AGENTS.md', 'README.md', 'docs/development.md', 'docs/legacy-readme-through-0.10.8.md', 'legacy/README.md', 'experiments/README.md']) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target) || target.startsWith('/')) continue;
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), target)), `${file}: ${target}`);
    }
  }
});

test('production scripts do not depend on the archived recommendation core', () => {
  assert.ok(!fs.existsSync('src/core.cjs'));
  assert.ok(!fs.existsSync('src/component.js'));
  assert.ok(fs.existsSync('legacy/src/core.cjs'));
  assert.ok(fs.existsSync('legacy/src/component.js'));
  for (const file of ['scripts/build.mjs', 'scripts/build-stats.mjs', 'scripts/build-timeline.mjs', 'scripts/build-calendar.mjs']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /legacy\//, file);
  }
  // 旧的月度协同过滤管线已整体退役：生产目录里不应再有它的任何入口。
  for (const gone of ['src/recommender-v2.js', 'src/recommendation-feed.cjs', 'src/series-family.cjs', 'src/candidate-eligibility.cjs', 'scripts/refresh-recommendations.cjs', 'scripts/build-recommendations.py', 'scripts/grow-peer-cohort.cjs', 'data/peer-cohort.json', 'public/recommendations.json', '.github/workflows/monthly-recommendations.yml']) {
    assert.ok(!fs.existsSync(gone), `${gone} should stay deleted`);
  }
});

test('preview navigation links exist and release helpers derive actual versions', () => {
  const text = fs.readFileSync('demo/index.html', 'utf8');
  for (const match of text.matchAll(/href="([^"]+)"/g)) {
    assert.ok(fs.existsSync(path.resolve('demo', match[1])), match[1]);
  }
  for (const file of ['demo/publish-source.html', 'demo/stats-source.html', 'demo/timeline-source.html']) {
    const helper = fs.readFileSync(file, 'utf8');
    assert.match(helper, /@version/);
    assert.doesNotMatch(helper, /<h1>[^<]*\d+\.\d+\.\d+/);
    assert.match(helper, /response\.ok/);
  }
  assert.match(fs.readFileSync('demo/source.html', 'utf8'), /url=publish-source\.html/);
});
