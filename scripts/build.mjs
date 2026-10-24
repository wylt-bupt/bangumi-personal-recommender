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
// @description  个人主页的动画与书籍推荐：按标签均分与全站评分折算排序，仅手动更新。
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
const core = await readFile(resolve(root, "src/recommender-core.cjs"), "utf8");
const component = await readFile(resolve(root, "src/recommender.js"), "utf8");

// APP_VERSION lives in package.json only; inject it so the bundle and the
// userscript header can never drift apart.
function injectVersion(source, file) {
  const pattern = /const APP_VERSION = "[^"]*";/;
  if (!pattern.test(source)) throw new Error(`${file} is missing the APP_VERSION constant`);
  return source.replace(pattern, `const APP_VERSION = "${version}";`);
}

await mkdir(dirname(output), { recursive: true });
const bundle = `${header}\n${profileUI}\n\n${core}\n\n${injectVersion(component, "src/recommender.js")}\n`;
await writeFile(output, bundle, "utf8");
await writeFile(publishOutput, bundle, "utf8");
console.log(`Built ${output} (${version})`);
