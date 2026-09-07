const test = require("node:test");
const assert = require("node:assert/strict");
const Stats = require("../src/stats-core.cjs");

test('studio average ranking includes every rated studio over ten works, not only the top decile', () => {
  const rows=Array.from({length:30},(_,i)=>({id:i,name:'制作'+i,works:i===0?100:i===1?10:i===2?11:12,averageRate:10-i/10,ratedWorks:i===3?0:5,eps:100}));
  const ranked=Stats.rankEntries(rows,'average',.1,10);
  assert.ok(ranked.rows.some(row=>row.id===2));
  assert.ok(!ranked.rows.some(row=>row.id===1 || row.id===3));
  assert.equal(ranked.rows.length,28);
  assert.equal(ranked.cutoffWorks,11);
  assert.equal(Stats.rankEntries(rows,'works',.1,10).rows.length,30);
  assert.equal(Stats.rankEntries(rows,'average',.1).rows.some(row=>row.id===2),false);
});

function collection(id, rate, eps, epStatus, status = 2) {
  return {
    subject_id: id,
    type: status,
    rate,
    ep_status: epStatus,
    subject: { id, type: 2, name: `作品 ${id}`, eps },
  };
}

test("aggregates episode totals, staff roles, studios and cast without duplicate works", () => {
  const rows = [collection(1, 9, 12, 12), collection(2, 7, 24, 8), collection(3, 0, 0, 0, 1)];
  const people = {
    1: [
      { id: 1, name: "导演甲", relation: "导演", type: 1 },
      { id: 2, name: "构成甲", relation: "系列构成", type: 1 },
      { id: 3, name: "公司甲", relation: "动画制作", type: 2 },
    ],
    2: [
      { id: 1, name: "导演甲", relation: "总导演", type: 1 },
      { id: 3, name: "公司甲", relation: "动画制作", type: 2 },
      { id: 3, name: "公司甲", relation: "动画制作", type: 2 },
    ],
  };
  const cast = {
    1: [
      { id: 11, name: "主角", relation: "主角", actors: [{ id: 10, name: "声优甲" }] },
      { id: 12, name: "配角", relation: "配角", actors: [{ id: 10, name: "声优甲" }] },
    ],
    2: [{ id: 21, name: "主角二", relation: "主角", actors: [{ id: 10, name: "声优甲" }] }],
  };
  const result = Stats.aggregate(rows, people, cast);

  assert.equal(result.overview.works, 3);
  assert.equal(result.overview.knownEpisodes, 36);
  assert.equal(result.overview.watchedEpisodes, 20);
  assert.equal(result.overview.averageRate, 8);
  assert.deepEqual(result.overview.status, [{ id: 1, label: "想看", count: 1 }, { id: 2, label: "看过", count: 2 }]);
  assert.deepEqual(result.groups.directors[0], {
    id: 1, name: "导演甲", type: 1, works: 2, eps: 36, averageRate: 8, ratedWorks: 2, characterCount: 0, mainCharacterCount: 0,
  });
  assert.equal(result.groups.studios[0].works, 2);
  assert.equal(result.groups.cast[0].works, 2);
  assert.equal(result.groups.cast[0].characterCount, 3);
  assert.equal(result.groups.cast[0].mainCharacterCount, 2);
  assert.deepEqual(result.coverage, { peopleSubjects: 2, castSubjects: 2, totalSubjects: 3 });
});

test("keeps additional creative roles and overview distributions", () => {
  const rows = [
    { ...collection(8, 10, 13, 13), tags: ["科幻", "原创"], subject: { id: 8, type: 2, name: "作品八", eps: 13, date: "2020-01-01" } },
    { ...collection(9, 8, 26, 26), tags: ["科幻", "动画"], subject: { id: 9, type: 2, name: "作品九", eps: 26, date: "2020-07-01" } },
  ];
  const people = {
    8: [
      { id: 81, name: "原作甲", relation: "原作", type: 1 },
      { id: 82, name: "脚本甲", relation: "脚本", type: 1 },
      { id: 83, name: "音乐甲", relation: "音乐", type: 1 },
      { id: 84, name: "设定甲", relation: "人物设定", type: 1 },
    ],
  };
  const result = Stats.aggregate(rows, people, {});
  assert.equal(result.groups.originals[0].name, "原作甲");
  assert.equal(result.groups.scripts[0].name, "脚本甲");
  assert.equal(result.groups.music[0].name, "音乐甲");
  assert.equal(result.groups.characterDesign[0].name, "设定甲");
  assert.deepEqual(result.distributions.ratings.filter((row) => row.count), [{ score: 8, count: 1 }, { score: 10, count: 1 }]);
  assert.deepEqual(result.distributions.years, [{ year: 2020, count: 2 }]);
  assert.equal(result.distributions.tags[0].name, "科幻");
  assert.equal(result.distributions.longest[0].id, 9);
});

test("keeps the complete episode ranking instead of truncating overview data", () => {
  const rows = Array.from({ length: 20 }, (_, index) => collection(index + 1, 8, 20 - index, 0));
  const result = Stats.aggregate(rows, {}, {});
  assert.equal(result.distributions.longest.length, 20);
  assert.equal(result.distributions.longest[0].eps, 20);
  assert.equal(result.distributions.longest.at(-1).eps, 1);
});

test("average ranking only includes the top decile by work count and keeps cutoff ties", () => {
  const rows = [
    { name: "高产甲", works: 12, ratedWorks: 12, averageRate: 7.5, eps: 120 },
    { name: "高产乙", works: 10, ratedWorks: 10, averageRate: 8.2, eps: 100 },
    { name: "同门槛", works: 10, ratedWorks: 9, averageRate: 8.8, eps: 90 },
    ...Array.from({ length: 17 }, (_, index) => ({ name: `低样本${index}`, works: 9 - Math.floor(index / 2), ratedWorks: 1, averageRate: 10, eps: 12 })),
  ];
  const result = Stats.rankEntries(rows, "average", 0.1);
  assert.equal(result.cutoffWorks, 10);
  assert.equal(result.eligibleCount, 3);
  assert.deepEqual(result.rows.map((row) => row.name), ["同门槛", "高产乙", "高产甲"]);
});

test("work-count ranking keeps every entry", () => {
  const rows = [
    { name: "乙", works: 2, ratedWorks: 2, averageRate: 9, eps: 24 },
    { name: "甲", works: 4, ratedWorks: 4, averageRate: 7, eps: 48 },
  ];
  const result = Stats.rankEntries(rows, "works");
  assert.equal(result.eligibleCount, 2);
  assert.deepEqual(result.rows.map((row) => row.name), ["甲", "乙"]);
});
