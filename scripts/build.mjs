import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist/bangumi-personal-recommender.user.js");

const header = `// ==UserScript==
// @name         Bangumi 个性推荐
// @namespace    https://bgm.tv/user/wylt
// @version      0.1.3
// @description  根据个人收藏、评分和标签，在未标记条目中推荐最适合的 5 个。
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
const component = await readFile(resolve(root, "src/component.js"), "utf8");

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${header}\n${core}\n\n${component}\n`, "utf8");
console.log(`Built ${output}`);
