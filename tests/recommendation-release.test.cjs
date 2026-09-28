const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Feed = require('../src/recommendation-feed.cjs');

test('published feed is aggregate-only, bounded, sorted and displayable', () => {
  const raw = JSON.parse(fs.readFileSync('public/recommendations.json', 'utf8'));
  assert.ok(!('peers' in raw));
  assert.ok(!('ratings' in raw));
  assert.ok(raw.peerCount >= 60);
  assert.ok(raw.neighborCount >= 20 && raw.neighborCount <= 40);
  assert.ok(raw.ratedCount >= 1000);
  const feed = Feed.parseFeed(raw);
  assert.equal(feed.candidates.length, raw.candidates.length);
  assert.ok(feed.candidates.length >= 100 && feed.candidates.length <= 500);
  assert.ok(feed.candidates.slice(0, 50).filter((item) => item.subject.rating.score > 0).length >= 45);
  for (let index = 0; index < feed.candidates.length; index++) {
    const item = feed.candidates[index];
    assert.ok(item.subject.name || item.subject.nameCn);
    assert.ok(item.reasons.length > 0);
    assert.ok(item.predicted >= 1 && item.predicted <= 10);
    if (index) assert.ok(feed.candidates[index - 1].predicted >= item.predicted);
  }
});

test('shipped recommender is disconnected from the legacy hard filters and score weights', () => {
  const build = fs.readFileSync('scripts/build.mjs', 'utf8');
  assert.match(build, /src\/recommender-v2\.js/);
  assert.doesNotMatch(build, /readFile\(resolve\(root, "src\/component\.js"\)/);
  assert.doesNotMatch(build, /readFile\(resolve\(root, "src\/core\.cjs"\)/);
  const source = fs.readFileSync('src/recommender-v2.js', 'utf8');
  for (const legacy of ['candidateExclusion', 'classifyJapaneseOrigin', 'RECOMMENDATION_MODE', 'CANDIDATE_RANK_PAGES']) {
    assert.ok(!source.includes(legacy));
  }
});
