// Grow the fixed public peer sample (data/peer-cohort.json) with the same
// documented procedure as the 2026-09-27 pilot: seeds from own rating bands,
// users discovered on public comment pages, filtered to accounts with at
// least 120 anime collections of which most carry real ratings. Read-only,
// rate-limited, resumable; candidate work files stay in the ignored cache.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const cohortPath = path.join(root, "data/peer-cohort.json");
const workPath = path.join(path.dirname(__dirname), "scripts/.cache/peer-discovery.json");
const AGENT = "wylt-bupt/bangumi-personal-recommender (monthly public-rating aggregation; https://github.com/wylt-bupt/bangumi-personal-recommender)";
const delayMs = Number(process.env.BGM_GROW_DELAY_MS || 1500);
const targetPeers = Number(process.env.BGM_GROW_TARGET || 250);
const maxCandidates = Number(process.env.BGM_GROW_MAX_CANDIDATES || 600);
let nextRequestAt = 0;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function get(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = nextRequestAt - Date.now();
    if (wait > 0) await sleep(wait);
    nextRequestAt = Date.now() + delayMs;
    let response;
    try {
      response = await fetch(url, { headers: { "User-Agent": AGENT }, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      if (attempt === 4) throw error;
      await sleep(60_000 * (attempt + 1));
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      const seconds = Number(response.headers.get("retry-after"));
      const backoff = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Math.max(60_000, 30_000 * 2 ** attempt);
      console.error(`HTTP ${response.status} ${url}; waiting ${Math.ceil(backoff / 1000)}s`);
      await sleep(backoff);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
    return response;
  }
  throw new Error(`Failed after retries: ${url}`);
}

// Rate bands sampled at fixed fractions, mirroring the pilot's seed spread:
// comments on both best- and worst-rated titles surface users with real
// scoring habits rather than collectors.
function selectSeeds(own) {
  const rated = own.filter(row => Number(row.rate) > 0 && Number(row.subject_id) > 0);
  const byBand = [
    row => Number(row.rate) <= 5,
    row => Number(row.rate) === 6 || Number(row.rate) === 7,
    row => Number(row.rate) >= 8,
  ];
  const picked = [];
  for (const predicate of byBand) {
    const rows = rated.filter(predicate).sort((a, b) => Number(a.subject_id) - Number(b.subject_id));
    if (!rows.length) continue;
    for (const fraction of [0.12, 0.37, 0.62, 0.87]) {
      picked.push(Number(rows[Math.floor((rows.length - 1) * fraction)].subject_id));
    }
  }
  return [...new Set(picked)].sort((a, b) => a - b);
}

function discoverCommentsUrl(subjectId, page) {
  return `https://bgm.tv/subject/${subjectId}/comments?page=${page}`;
}

function candidateUserIds(html) {
  return [...String(html).matchAll(/data-item-user="([^"\s<>]+)"/g)].map(match => match[1]);
}

function commentPagePlan(pageCount) {
  return [...new Set([1, Math.min(8, pageCount), ...[0.25, 0.5, 0.75, 1].map(part => Math.max(1, Math.ceil(pageCount * part)))])];
}

function hashSort(ids) {
  const hash = id => {
    let value = 2166136261;
    for (const character of id) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
    return value >>> 0;
  };
  return ids.slice().sort((left, right) => hash(left) - hash(right));
}

module.exports = { selectSeeds, discoverCommentsUrl, candidateUserIds, commentPagePlan, hashSort, get, sleep };

async function main() {
  const input = JSON.parse(fs.readFileSync(path.join(root, "scripts/.cache/recommendations-input.json"), "utf8"));
  const cohort = JSON.parse(fs.readFileSync(cohortPath, "utf8")).map(String);
  const existing = new Set(cohort);
  const work = fs.existsSync(workPath) ? JSON.parse(fs.readFileSync(workPath, "utf8")) : {
    seeds: [], candidates: [], checked: {}, accepted: [], rejected: {},
  };

  const need = targetPeers - cohort.length;
  if (need <= 0) {
    console.error(`cohort already has ${cohort.length} peers; nothing to do`);
    return;
  }
  console.error(`growing cohort: ${cohort.length} -> ${targetPeers}`);

  if (!work.seeds.length) {
    work.seeds = selectSeeds(input.own);
    fs.writeFileSync(workPath, JSON.stringify(work));
    console.error(`seeds: ${work.seeds.join(", ")}`);
  }

  if (work.candidates.length < maxCandidates) {
    const userIds = new Set(work.candidates);
    for (const subjectId of work.seeds) {
      if (userIds.size >= maxCandidates) break;
      const firstHtml = await (await get(discoverCommentsUrl(subjectId, 1))).text();
      const pageNumbers = [...firstHtml.matchAll(/href="\?page=(\d+)"/g)].map(match => Number(match[1]));
      const lastPage = Math.max(1, ...pageNumbers);
      for (const page of commentPagePlan(lastPage)) {
        if (userIds.size >= maxCandidates) break;
        const html = page === 1 ? firstHtml : await (await get(discoverCommentsUrl(subjectId, page))).text();
        for (const id of candidateUserIds(html)) if (!existing.has(id)) userIds.add(id);
      }
      console.error(`seed ${subjectId}: ${userIds.size} candidate users so far`);
      fs.writeFileSync(workPath, JSON.stringify(work));
    }
    work.candidates = hashSort([...userIds]).slice(0, maxCandidates);
    fs.writeFileSync(workPath, JSON.stringify(work));
  }

  // The pool only accepts accounts with a real scoring habit, re-checked here
  // even though discovery pages suggest activity, because comment writers can
  // still have tiny anime collections.
  for (const userId of work.candidates) {
    if (work.accepted.length >= need) break;
    if (work.accepted.includes(userId) || work.checked[userId]) continue;
    const base = `https://api.bgm.tv/v0/users/${userId}/collections?subject_type=2&limit=50&offset=0`;
    let first;
    try {
      first = await (await get(base)).json();
    } catch (error) {
      // Some accounts hang server-side on this endpoint (observed: profile
      // 200 in <1s, collections never respond). Isolate the failure to the
      // user so one bad account cannot kill the whole discovery pass.
      work.checked[userId] = `collection request failed (${error.name || "error"}); skipped`;
      work.rejected[userId] = work.checked[userId];
      fs.writeFileSync(workPath, JSON.stringify(work));
      console.error(`user ${userId}: request failed; skipped`);
      continue;
    }
    const ratedOnPage = (first.data || []).filter(row => row.rate > 0).length;
    if (first.total < 120) {
      work.checked[userId] = `anime collections ${first.total} < 120`;
      work.rejected[userId] = work.checked[userId];
    } else if (ratedOnPage < 5) {
      work.checked[userId] = "fewer than 5 ratings on first page";
      work.rejected[userId] = work.checked[userId];
    } else {
      work.accepted.push(userId);
      work.checked[userId] = "accepted";
    }
    fs.writeFileSync(workPath, JSON.stringify(work));
    console.error(`user ${userId}: ${work.checked[userId]}; accepted ${work.accepted.length}/${need}`);
  }

  const merged = [...cohort, ...work.accepted.filter(id => !existing.has(id))];
  fs.writeFileSync(cohortPath, JSON.stringify(merged, null, 2) + "\n");
  console.error(JSON.stringify({
    cohort: merged.length, newlyAccepted: work.accepted.length,
    candidates: work.candidates.length, rejected: Object.keys(work.rejected).length,
  }));
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
