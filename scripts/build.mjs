import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist/bangumi-personal-recommender.user.js");
const publishOutput = resolve(root, "dist/bangumi-personal-recommender.bgm.txt");

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const version = packageJson.version;

const header = `// ==UserScript==
// @name         Bangumi 个性推荐
// @namespace    https://bgm.tv/user/wylt
// @version      ${version}
// @description  个人主页的动画个性推荐：按个人评分学习的排序模型与推荐依据。
// @author       wylt
// @match        https://bgm.tv/*
// @match        http://bgm.tv/*
// @match        https://bangumi.tv/*
// @match        http://bangumi.tv/*
// @match        https://chii.in/*
// @match        http://chii.in/*
// ==/UserScript==
`;

const profileUI = await readFile(resolve(root, "src/profile-ui.js"), "utf8");
const recommendationFeed = await readFile(resolve(root, "src/recommendation-feed.cjs"), "utf8");
const component = await readFile(resolve(root, "src/recommender-v2.js"), "utf8");
const initialFeed = JSON.parse(await readFile(resolve(root, "public/recommendations.json"), "utf8"));
// The bundle matches every Bangumi page; keep only a small offline fallback.
// The full monthly feed is fetched lazily on the actual wylt profile.
const embeddedFeed = JSON.stringify({ ...initialFeed, candidates: initialFeed.candidates.slice(0, 50) }, null, 2)
  .replaceAll("<", "\\u003c");

// APP_VERSION lives in package.json only; inject it so the bundle, the UI
// label and the userscript header can never drift apart.
function injectVersion(source, file) {
  const pattern = /const APP_VERSION = "[^"]*";/;
  if (!pattern.test(source)) throw new Error(`${file} is missing the APP_VERSION constant`);
  return source.replace(pattern, `const APP_VERSION = "${version}";`);
}

await mkdir(dirname(output), { recursive: true });
const bundle = `${header}\n${profileUI}\n\n${recommendationFeed}\n\nglobalThis.BangumiInitialRecommendationFeed = ${embeddedFeed};\n\n${injectVersion(component, "src/recommender-v2.js")}\n`;
await writeFile(output, bundle, "utf8");
await writeFile(publishOutput, bundle, "utf8");
console.log(`Built ${output} (${version})`);
