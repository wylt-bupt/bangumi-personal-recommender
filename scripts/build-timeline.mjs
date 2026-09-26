import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const version = packageJson.timelineVersion;
if (!version) throw new Error('package.json is missing "timelineVersion"');
const header = `// ==UserScript==
// @name         个人时光机
// @namespace    https://bgm.tv/user/wylt
// @version      ${version}
// @description  活跃度热力图；仅统计每日标记看过的集数，数据保存在浏览器本地。
// @author       Mikuorz（原版界面），wylt（本地数据适配）
// @match        https://bgm.tv/*
// @match        https://bangumi.tv/*
// @match        https://chii.in/*
// @grant        none
// ==/UserScript==\n`;
await mkdir(resolve(root, 'dist'), { recursive: true });
const sources = await Promise.all(['timeline-core.cjs', 'timeline.js'].map(f => readFile(resolve(root, 'src', f), 'utf8')));
await writeFile(resolve(root, 'dist/bangumi-personal-timeline.user.js'), header + sources.join('\n\n'), 'utf8');
console.log(`Built independent personal timeline ${version}`);
