import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (!pkg.calendarVersion) throw new Error('Missing calendarVersion');
const header = `// ==UserScript==
// @name         我的放送表
// @namespace    https://bgm.tv/user/wylt
// @version      ${pkg.calendarVersion}
// @description  仅显示我的收藏；按日纵向排列，清晰封面、中文标题，支持站内私密收藏同步。
// @author       wylt
// @match        https://bgm.tv/
// @match        https://bgm.tv/calendar*
// @match        https://bangumi.tv/
// @match        https://bangumi.tv/calendar*
// @match        https://chii.in/
// @match        https://chii.in/calendar*
// @grant        none
// ==/UserScript==\n`;
const sources = await Promise.all(['calendar-core.cjs', 'calendar.js'].map(name => readFile(resolve(root, 'src', name), 'utf8')));
await mkdir(resolve(root, 'dist'), { recursive: true });
const script = header + sources.join('\n\n');
await writeFile(resolve(root, 'dist/bangumi-personal-calendar.user.js'), script, 'utf8');
await writeFile(resolve(root, 'dist/bangumi-personal-calendar.bgm.txt'), script, 'utf8');
console.log(`Built independent personal calendar ${pkg.calendarVersion}`);
