const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

for (const [name, versionKey] of [['bangumi-personal-recommender', 'version'], ['bangumi-personal-stats', 'statsVersion']]) {
  test(`${name} release header matches the package version and the paste copy is identical`, () => {
    const script = fs.readFileSync(`dist/${name}.user.js`, 'utf8');
    const copy = fs.readFileSync(`dist/${name}.bgm.txt`, 'utf8');
    const version = pkg[versionKey].replace(/\./g, '\\.');
    assert.match(script, new RegExp(`^// @version\\s+${version}$`, 'm'));
    assert.equal(script, copy);
  });
}

test('stats release contains only the retrospective bundle', () => {
  const script = fs.readFileSync('dist/bangumi-personal-stats.user.js', 'utf8');
  assert.match(script, /BangumiPersonalStatsCore/);
  assert.ok(!script.includes('BangumiRecommendationFeed'), 'stats bundle must not ship the recommender feed');
  assert.ok(!script.includes('BangumiInitialRecommendationFeed'), 'stats bundle must not embed the feed snapshot');
});

test('recommender release contains only the recommendation bundle', () => {
  const script = fs.readFileSync('dist/bangumi-personal-recommender.user.js', 'utf8');
  assert.match(script, /BangumiRecommendationFeed/);
  assert.ok(!script.includes('BangumiPersonalStatsCore'), 'recommender bundle must not ship the stats core');
  assert.ok(!script.includes('BangumiStatsViz'), 'recommender bundle must not ship the stats viz');
});

test('split builds stay independent', () => {
  const build = fs.readFileSync('scripts/build.mjs', 'utf8');
  const stats = fs.readFileSync('scripts/build-stats.mjs', 'utf8');
  assert.match(build, /src\/recommender-v2\.js/);
  assert.doesNotMatch(build, /src\/stats/);
  assert.doesNotMatch(build, /build-stats/);
  assert.match(stats, /src\/stats\.js/);
  assert.doesNotMatch(stats, /recommender|recommendation-feed/);
});
