import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist/bangumi-personal-stats.user.js");
const publishOutput = resolve(root, "dist/bangumi-personal-stats.bgm.txt");

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const version = packageJson.statsVersion;
if (!version) throw new Error("Missing statsVersion");

const header = `// ==UserScript==
// @name         Bangumi 动画回顾
// @namespace    https://bgm.tv/user/wylt
// @version      ${version}
// @description  个人主页的动画回顾：年代分布与标签、创作、声优排行。
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
const statsCore = await readFile(resolve(root, "src/stats-core.cjs"), "utf8");
const statsViz = await readFile(resolve(root, "src/stats-viz.cjs"), "utf8");
const stats = await readFile(resolve(root, "src/stats.js"), "utf8");

// APP_VERSION lives in package.json only; inject it so the bundle, the UI
// label and the userscript header can never drift apart.
function injectVersion(source, file) {
  const pattern = /const APP_VERSION = "[^"]*";/;
  if (!pattern.test(source)) throw new Error(`${file} is missing the APP_VERSION constant`);
  return source.replace(pattern, `const APP_VERSION = "${version}";`);
}

await mkdir(dirname(output), { recursive: true });
const bundle = `${header}\n${profileUI}\n\n${statsCore}\n\n${statsViz}\n\n${injectVersion(stats, "src/stats.js")}\n`;
await writeFile(output, bundle, "utf8");
await writeFile(publishOutput, bundle, "utf8");
console.log(`Built ${output} (${version})`);
