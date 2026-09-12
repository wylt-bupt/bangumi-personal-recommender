import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const header = `// ==UserScript==
// @name         个人时光机
// @namespace    https://bgm.tv/user/wylt
// @version      1.0.6
// @description  原版风格的年度标记热力图；保留每条活动，并按实际新增集数计算批量进度。
// @author       Mikuorz（原版界面），wylt（本地数据适配）
// @match        https://bgm.tv/*
// @match        https://bangumi.tv/*
// @match        https://chii.in/*
// @grant        none
// ==/UserScript==\n`;
await mkdir(resolve(root, 'dist'), { recursive: true });
const sources = await Promise.all(['timeline-core.cjs', 'timeline.js'].map(f => readFile(resolve(root, 'src', f), 'utf8')));
await writeFile(resolve(root, 'dist/bangumi-personal-timeline.user.js'), header + sources.join('\n\n'), 'utf8');
console.log('Built independent personal timeline 1.0.6');
