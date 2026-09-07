import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist/bangumi-personal-recommender.user.js");
const publishOutput = resolve(root, "dist/bangumi-personal-recommender.bgm.txt");

const header = `// ==UserScript==
// @name         Bangumi 个性推荐
// @namespace    https://bgm.tv/user/wylt
// @version      0.9.4
// @description  个人主页的动画回顾与个性推荐：年代柱图、季度分布、偏好词云与人物排行。
// @author       wylt
// @match        https://bgm.tv/*
// @match        http://bgm.tv/*
// @match        https://bangumi.tv/*
// @match        http://bangumi.tv/*
// @match        https://chii.in/*
// @match        http://chii.in/*
// ==/UserScript==
`;

const core = await readFile(resolve(root, "src/core.cjs"), "utf8");
const profileUI = await readFile(resolve(root, "src/profile-ui.js"), "utf8");
const component = await readFile(resolve(root, "src/component.js"), "utf8");
const statsCore = await readFile(resolve(root, "src/stats-core.cjs"), "utf8");
const stats = await readFile(resolve(root, "src/stats.js"), "utf8");
const statsViz = await readFile(resolve(root, "src/stats-viz.cjs"), "utf8");

await mkdir(dirname(output), { recursive: true });
const bundle = `${header}\n${profileUI}\n\n${core}\n\n${statsCore}\n\n${statsViz}\n\n${stats}\n\n${component}\n`;
await writeFile(output, bundle, "utf8");
await writeFile(publishOutput, bundle, "utf8");
console.log(`Built ${output}`);
