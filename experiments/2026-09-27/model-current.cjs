// Read-only, reproducible profile snapshot. Raw collections stay ignored by Git.
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../../legacy/src/core.cjs');

const ROOT = __dirname;
const SUBJECT_TYPES = [2, 1, 4, 3, 6];
const LABELS = { 2: '动画', 1: '书籍', 4: '游戏', 3: '音乐', 6: '三次元' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getPage(subjectType, offset) {
  const url = new URL('https://api.bgm.tv/v0/users/wylt/collections');
  url.searchParams.set('subject_type', subjectType);
  url.searchParams.set('limit', 100);
  url.searchParams.set('offset', offset);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'wylt-bupt/bangumi-personal-recommender (read-only personal modeling)' },
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) return response.json();
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
      throw new Error(`Bangumi API ${response.status}: ${url}`);
    }
    await pause((attempt + 1) * 1500);
  }
}

async function getCollections(subjectType) {
  const first = await getPage(subjectType, 0);
  const pages = [first];
  for (let offset = 100; offset < first.total; offset += 100) {
    await pause(150);
    pages.push(await getPage(subjectType, offset));
  }
  const rows = pages.flatMap(page => page.data || []);
  if (rows.length !== first.total) throw new Error(`${LABELS[subjectType]}分页不完整: ${rows.length}/${first.total}`);
  return rows.map(Core.normalizeCollection);
}

function countBy(rows, key) {
  return Object.fromEntries([...rows.reduce((map, row) => {
    const value = String(key(row));
    map.set(value, (map.get(value) || 0) + 1);
    return map;
  }, new Map()).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh')));
}

const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const rounded = value => Math.round(value * 1000) / 1000;

function summarize(collections) {
  const rated = collections.filter(row => row.rate > 0);
  const paired = rated.filter(row => row.subject.rating.score > 0);
  const profile = rated.length >= 5 ? Core.trainProfile(collections) : null;
  const tagRows = rated.flatMap(row => row.subject.tags.map(tag => ({ tag, rate: row.rate, family: Core.seriesFamilyKey(row.subject) })));
  const tagGroups = new Map();
  for (const row of tagRows) {
    const family = tagGroups.get(row.tag) || new Map();
    const prior = family.get(row.family);
    if (!prior || row.rate > prior) family.set(row.family, row.rate);
    tagGroups.set(row.tag, family);
  }
  const supportedTags = [...tagGroups.entries()]
    .filter(([, families]) => families.size >= 12)
    .map(([tag, families]) => {
      const rates = [...families.values()];
      return { tag, families: families.size, mean: rounded(average(rates)), likedShare: rounded(rates.filter(rate => rate >= 8).length / rates.length) };
    });
  return {
    total: collections.length,
    status: countBy(collections, row => row.status),
    rated: rated.length,
    ratingDistribution: countBy(rated, row => row.rate),
    meanRating: rounded(average(rated.map(row => row.rate))),
    liked: rated.filter(row => row.rate >= 8).length,
    neutral: rated.filter(row => row.rate === 7).length,
    disliked: rated.filter(row => row.rate <= 6).length,
    distinctRatedSeries: new Set(rated.map(row => Core.seriesFamilyKey(row.subject))).size,
    metadataCoverage: {
      tags: collections.filter(row => row.subject.tags.length).length,
      userTags: collections.filter(row => row.tags.length).length,
      date: collections.filter(row => /^\d{4}/.test(row.subject.date)).length,
      siteScore: collections.filter(row => row.subject.rating.score > 0).length,
      voteTotal: collections.filter(row => row.subject.rating.total > 0).length,
      infobox: collections.filter(row => row.subject.infobox.length).length,
      people: collections.filter(row => row.subject.persons.length).length,
    },
    siteMeanForRated: rounded(average(paired.map(row => row.subject.rating.score))),
    personalMinusSite: rounded(average(paired.map(row => row.rate - row.subject.rating.score))),
    neutralAgainstLowSite: paired.filter(row => row.rate === 7 && row.subject.rating.score < 5).length,
    topRetrievalTags: profile ? Core.topRetrievalTags(profile, 12) : [],
    positiveFeatures: profile ? profile.topFeatures.filter(row => row.weight > 0).slice(0, 18).map(row => ({ label: row.label, role: row.token.split(':')[0], weight: rounded(row.weight), support: row.support })) : [],
    negativeFeatures: profile ? profile.topFeatures.filter(row => row.weight < 0).slice(-18).reverse().map(row => ({ label: row.label, role: row.token.split(':')[0], weight: rounded(row.weight), support: row.support })) : [],
    highSupportLikedTags: supportedTags.filter(row => row.families >= 20).sort((a, b) => b.mean - a.mean).slice(0, 15),
    highSupportDislikedTags: supportedTags.filter(row => row.families >= 20).sort((a, b) => a.mean - b.mean).slice(0, 15),
  };
}

async function main() {
  const existing = process.argv.includes('--offline')
    ? JSON.parse(fs.readFileSync(path.join(ROOT, 'snapshot.json'), 'utf8')) : null;
  const collections = existing?.collections || {};
  if (!existing) {
    for (const type of SUBJECT_TYPES) {
      collections[type] = await getCollections(type);
      console.error(`${LABELS[type]}: ${collections[type].length} 条`);
    }
  }
  const snapshot = existing || { fetchedAt: new Date().toISOString(), source: 'Bangumi public API; read-only', collections };
  const summary = {
    fetchedAt: snapshot.fetchedAt,
    categories: Object.fromEntries(SUBJECT_TYPES.map(type => [LABELS[type], summarize(collections[type])])),
  };
  fs.writeFileSync(path.join(ROOT, 'snapshot.json'), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(ROOT, 'summary-details.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
