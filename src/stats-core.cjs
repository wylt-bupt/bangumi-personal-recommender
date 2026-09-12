(function attachBangumiPersonalStatsCore(globalObject) {
  "use strict";

  const STATUS_LABELS = Object.freeze({
    1: "想看",
    2: "看过",
    3: "在看",
    4: "搁置",
    5: "抛弃",
  });

  const ROLE_GROUPS = Object.freeze({
    directors: {
      label: "导演",
      test: (relation) => /(?:导演|監督|总导演|總監督|chief director|director)/i.test(relation),
    },
    series: {
      label: "系列构成",
      test: (relation) => /(?:系列构成|系列構成|シリーズ構成|构成\s*·?\s*脚本|構成\s*·?\s*脚本)/i.test(relation),
    },
    studios: {
      label: "动画制作",
      test: (relation) => /(?:动画制作|動畫製作|アニメーション制作|动画製作|制作公司)/i.test(relation),
    },
    originals: {
      label: "原作 / 原案",
      test: (relation) => /(?:原作|原案|漫画原作|漫畫原作|小说原作|小說原作)/i.test(relation),
    },
    scripts: {
      label: "脚本",
      test: (relation) => /(?:脚本|腳本|剧本|劇本)/i.test(relation),
    },
    music: {
      label: "音乐",
      test: (relation) => /(?:^|[、,/\s])(?:音乐|音楽|配乐|配樂)(?:$|[、,/\s])/i.test(relation),
    },
    characterDesign: {
      label: "角色设计",
      test: (relation) => /(?:人物设定|人物設定|角色设计|角色設計|character design)/i.test(relation),
    },
  });

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function text(value) {
    return String(value || "").trim();
  }

  function subjectOf(row) {
    const subject = row?.subject || row || {};
    return {
      id: number(subject.id || row?.subject_id),
      name: text(subject.name),
      nameCn: text(subject.name_cn || subject.nameCn),
      date: text(subject.date),
      eps: number(subject.eps || subject.total_episodes),
      type: number(subject.type || row?.subject_type),
      image: text(subject.images?.grid || subject.images?.small || subject.image),
    };
  }

  function compactCollection(row) {
    return {
      subject: subjectOf(row),
      subjectId: number(row?.subject_id || row?.subjectId || row?.subject?.id || row?.id),
      status: number(row?.type || row?.status || row?.collectionType),
      rate: number(row?.rate),
      epStatus: number(row?.ep_status || row?.epStatus),
      tags: Array.isArray(row?.tags) ? row.tags.map(text).filter(Boolean) : [],
      updatedAt: text(row?.updated_at || row?.updatedAt),
      private: Boolean(row?.private),
    };
  }

  function compactPersons(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      id: number(row?.id),
      name: text(row?.name),
      relation: text(row?.relation),
      type: number(row?.type),
      eps: text(row?.eps),
    })).filter((row) => row.id && row.name && row.relation);
  }

  function compactCharacters(rows) {
    return (Array.isArray(rows) ? rows : []).map((character) => ({
      id: number(character?.id),
      name: text(character?.name),
      relation: text(character?.relation),
      actors: (Array.isArray(character?.actors) ? character.actors : []).map((actor) => ({
        id: number(actor?.id),
        name: text(actor?.name),
      })).filter((actor) => actor.id && actor.name),
    })).filter((character) => character.id && character.actors.length);
  }

  function average(scores) {
    return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  }

  function createBucket(row) {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      works: new Set(),
      eps: 0,
      ratedScores: [],
      characterCount: 0,
      mainCharacterCount: 0,
    };
  }

  function addWork(bucket, collection, extras = {}) {
    const subjectId = collection.subject.id;
    if (!bucket.works.has(subjectId)) {
      bucket.works.add(subjectId);
      bucket.eps += collection.subject.eps;
      if (collection.rate > 0) bucket.ratedScores.push(collection.rate);
    }
    bucket.characterCount += number(extras.characterCount);
    bucket.mainCharacterCount += number(extras.mainCharacterCount);
  }

  function finalizeBuckets(map) {
    return [...map.values()].map((bucket) => ({
      id: bucket.id,
      name: bucket.name,
      type: bucket.type,
      works: bucket.works.size,
      eps: bucket.eps,
      averageRate: average(bucket.ratedScores),
      ratedWorks: bucket.ratedScores.length,
      characterCount: bucket.characterCount,
      mainCharacterCount: bucket.mainCharacterCount,
    })).sort((a, b) => b.works - a.works || b.averageRate - a.averageRate || b.eps - a.eps || a.name.localeCompare(b.name, "zh-CN"));
  }

  function rankEntries(entries, mode = "works", topShare = 0.1, minimumWorksExclusive = null) {
    const rows = Array.isArray(entries) ? [...entries] : [];
    const byWorks = (a, b) => b.works - a.works || b.averageRate - a.averageRate || b.ratedWorks - a.ratedWorks || b.eps - a.eps || a.name.localeCompare(b.name, "zh-CN");
    if (mode !== "average" || !rows.length) return { rows: rows.sort(byWorks), cutoffWorks: 0, eligibleCount: rows.length };

    const validShare = Math.min(1, Math.max(0.01, number(topShare) || 0.1));
    const workRanked = [...rows].sort(byWorks);
    const cutoffIndex = Math.max(0, Math.ceil(workRanked.length * validShare) - 1);
    const cutoffWorks = Number.isFinite(minimumWorksExclusive) ? minimumWorksExclusive + 1 : (workRanked[cutoffIndex]?.works || 0);
    const eligible = rows.filter((row) => row.works >= cutoffWorks && row.ratedWorks > 0);
    eligible.sort((a, b) => b.averageRate - a.averageRate || b.ratedWorks - a.ratedWorks || b.works - a.works || b.eps - a.eps || a.name.localeCompare(b.name, "zh-CN"));
    return { rows: eligible, cutoffWorks, eligibleCount: eligible.length };
  }

  function aggregate(collectionRows, personEntries = {}, characterEntries = {}) {
    const collections = collectionRows.map(compactCollection).filter((row) => row.subject.id);
    const currentYear = new Date().getFullYear();
    const rated = collections.filter((row) => row.rate > 0);
    const knownEps = collections.filter((row) => row.subject.eps > 0);
    const status = {};
    const ratingDistribution = {};
    const years = {};
    const tags = {};
    for (const row of collections) status[row.status] = (status[row.status] || 0) + 1;
    for (const row of rated) ratingDistribution[row.rate] = (ratingDistribution[row.rate] || 0) + 1;
    for (const row of collections) {
      const year = row.subject.date.match(/^(?:19|20)\d{2}/)?.[0];
      if (year) years[year] = (years[year] || 0) + 1;
      for (const tag of row.tags) {
        const normalized = text(tag);
        if (!normalized) continue;
        const bucket = tags[normalized] || { count: 0, ratedCount: 0, scoreSum: 0 };
        bucket.count += 1;
        if (row.rate > 0) {
          bucket.ratedCount += 1;
          bucket.scoreSum += row.rate;
        }
        tags[normalized] = bucket;
      }
    }

    const groups = {
      ...Object.fromEntries(Object.keys(ROLE_GROUPS).map((key) => [key, new Map()])),
      cast: new Map(),
    };
    let peopleSubjects = 0;
    let castSubjects = 0;

    for (const collection of collections) {
      const subjectId = collection.subject.id;
      const people = personEntries[subjectId];
      if (Array.isArray(people)) {
        peopleSubjects += 1;
        const seen = new Set();
        for (const person of people) {
          const relation = text(person.relation);
          for (const [key, group] of Object.entries(ROLE_GROUPS)) {
            if (!group.test(relation)) continue;
            const uniqueKey = `${key}:${person.id}`;
            if (seen.has(uniqueKey)) continue;
            seen.add(uniqueKey);
            const bucket = groups[key].get(person.id) || createBucket(person);
            addWork(bucket, collection);
            groups[key].set(person.id, bucket);
          }
        }
      }

      const characters = characterEntries[subjectId];
      if (Array.isArray(characters)) {
        castSubjects += 1;
        const actorCharacters = new Map();
        for (const character of characters) {
          const isMain = /(?:主角|主役|主人公|main)/i.test(text(character.relation));
          for (const actor of character.actors || []) {
            const record = actorCharacters.get(actor.id) || { actor, characters: new Set(), main: new Set() };
            record.characters.add(character.id);
            if (isMain) record.main.add(character.id);
            actorCharacters.set(actor.id, record);
          }
        }
        for (const record of actorCharacters.values()) {
          const bucket = groups.cast.get(record.actor.id) || createBucket(record.actor);
          addWork(bucket, collection, {
            characterCount: record.characters.size,
            mainCharacterCount: record.main.size,
          });
          groups.cast.set(record.actor.id, bucket);
        }
      }
    }

    return {
      overview: {
        works: collections.length,
        ratedWorks: rated.length,
        averageRate: average(rated.map((row) => row.rate)),
        knownEpisodes: knownEps.reduce((sum, row) => sum + row.subject.eps, 0),
        knownEpisodeWorks: knownEps.length,
        averageEpisodes: knownEps.length ? knownEps.reduce((sum, row) => sum + row.subject.eps, 0) / knownEps.length : 0,
        watchedEpisodes: collections.reduce((sum, row) => sum + row.epStatus, 0),
        status: Object.entries(status).map(([id, count]) => ({ id: number(id), label: STATUS_LABELS[id] || "未分类", count })).sort((a, b) => a.id - b.id),
      },
      coverage: {
        peopleSubjects,
        castSubjects,
        totalSubjects: collections.length,
      },
      groups: Object.fromEntries(Object.entries(groups).map(([key, map]) => [key, finalizeBuckets(map)])),
      distributions: {
        ratings: Array.from({ length: 10 }, (_, index) => ({ score: index + 1, count: ratingDistribution[index + 1] || 0 })),
        years: Object.entries(years).map(([year, count]) => ({ year: number(year), count })).sort((a, b) => b.year - a.year),
        tags: Object.entries(tags).map(([name, bucket]) => ({
          name,
          count: bucket.count,
          ratedCount: bucket.ratedCount,
          averageRate: bucket.ratedCount ? bucket.scoreSum / bucket.ratedCount : 0,
        })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN")),
      },
    };
  }

  const Core = Object.freeze({
    STATUS_LABELS,
    ROLE_GROUPS,
    compactCollection,
    compactPersons,
    compactCharacters,
    rankEntries,
    aggregate,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  globalObject.BangumiPersonalStatsCore = Core;
})(globalThis);
