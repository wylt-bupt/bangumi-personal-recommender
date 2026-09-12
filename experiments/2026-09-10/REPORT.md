# 评分语义与标准差实验 · 2026-09-10

固定 2026-09-07T08:43:40.551Z 的 501 个日本动画候选；使用 1320 条已评分动画。没有修改生产代码、浏览器缓存或线上组件。

## 实验组

- A：当前 v0.9.4。个人评分相对站点预期的残差训练标签，并保留绝对残差最大的 80 个近邻锚点。
- B：7 分严格中性，8 分及以上为正向，6 分及以下为负向；标签画像和近邻都使用该绝对偏好；近邻使用所有非中性样本。
- C：B 的信号再由作品自身 1–10 分分布标准差做弱调整；只调整强度且不改变正负，最大幅度 ±15%。
- D：C 的标签画像不变，但把近邻重新限制为 80 个最强非中性锚点，用来判断排序变化是否来自扩大近邻范围。

## 五折按系列留出

AUC 只比较 8+ 与 6−，排除 7 分。P@20 与 NDCG@20 为五折平均。三类平均分是留出作品的未映射主排序分。

| 组 | AUC↑ | P@20↑ | NDCG@20↑ | 8+ 平均 | 7 平均 | 6− 平均 |
|---|---:|---:|---:|---:|---:|---:|
| A | 0.7631 | 0.6200 | 0.3344 | 0.0592 | 0.0066 | -0.0505 |
| B | 0.8612 | 0.8200 | 0.4586 | 0.0485 | -0.0517 | -0.1784 |
| C | 0.8623 | 0.8000 | 0.4584 | 0.0637 | -0.0404 | -0.1717 |
| D | 0.8486 | 0.7800 | 0.4593 | 0.0803 | -0.0239 | -0.1654 |

## 三个问题样本

- BanG Dream! Ave Mujica：你的评分 7；站点均分 4.07，标准差 2.08；A/B/C/D 信号 0.932 / 无 / 无 / 无。
- 拉撒路：你的评分 7；站点均分 4.68，标准差 1.53；A/B/C/D 信号 0.724 / 无 / 无 / 无。
- 恋语轻唱：你的评分 7；站点均分 4.14，标准差 1.66；A/B/C/D 信号 0.932 / 无 / 无 / 无。

## 统一 MMR 后关注条目名次

| 条目 | A | B | C | D |
|---|---:|---:|---:|---:|
| 悠久之翼2 | 1 | 21 | 19 | 15 |
| Love Live! 虹咲学园校园偶像同好会 | 3 | 48 | 49 | 25 |
| 星际牛仔 | 2 | 32 | 36 | 112 |
| 圣母在上 第3季 | 7 | 115 | 106 | 126 |
| FLCL | 6 | 10 | 11 | 8 |
| 270499 | — | — | — | — |
| 307237 | — | — | — | — |

B/C/D 与 A 的前二十重合：6/20、7/20、6/20。

## 统一 MMR 后前二十

| 名次 | A 当前 | B 绝对评分语义 | C 再加标准差弱调整 | D 恢复 80 锚点 |
|---:|---|---|---|---|
| 1 | [悠久之翼2](https://bgm.tv/subject/1029) 7.516 | [日常 ETV版](https://bgm.tv/subject/28205) 7.592 | [日常 ETV版](https://bgm.tv/subject/28205) 7.642 | [日常 ETV版](https://bgm.tv/subject/28205) 7.690 |
| 2 | [星际牛仔](https://bgm.tv/subject/253) 7.412 | [悠久之翼](https://bgm.tv/subject/799) 7.471 | [悠久之翼](https://bgm.tv/subject/799) 7.523 | [银魂 〜无论什么事开始虽然重要但伸个懒腰的话也不错〜](https://bgm.tv/subject/3153) 7.675 |
| 3 | [Love Live! 虹咲学园校园偶像同好会](https://bgm.tv/subject/296659) 7.451 | [银魂 〜无论什么事开始虽然重要但伸个懒腰的话也不错〜](https://bgm.tv/subject/3153) 7.503 | [银魂 〜无论什么事开始虽然重要但伸个懒腰的话也不错〜](https://bgm.tv/subject/3153) 7.550 | [悠久之翼](https://bgm.tv/subject/799) 7.632 |
| 4 | [续·终物语](https://bgm.tv/subject/233926) 7.413 | [偶像大师 剧场版 向着光辉的彼岸！](https://bgm.tv/subject/64172) 7.352 | [小魔女DoReMi 大合奏](https://bgm.tv/subject/14878) 7.402 | [玉响～毕业写真～](https://bgm.tv/subject/109869) 7.585 |
| 5 | [偶像大师 剧场版 向着光辉的彼岸！](https://bgm.tv/subject/64172) 7.382 | [小魔女DoReMi 大合奏](https://bgm.tv/subject/14878) 7.360 | [偶像大师 剧场版 向着光辉的彼岸！](https://bgm.tv/subject/64172) 7.388 | [少女革命 思春期默示录](https://bgm.tv/subject/1891) 7.502 |
| 6 | [FLCL](https://bgm.tv/subject/822) 7.372 | [交响情人梦Finale](https://bgm.tv/subject/3478) 7.425 | [交响情人梦Finale](https://bgm.tv/subject/3478) 7.471 | [剧场总集篇孤独摇滚！ Re:Re:](https://bgm.tv/subject/459642) 7.536 |
| 7 | [圣母在上 第3季](https://bgm.tv/subject/4216) 7.393 | [少女革命 思春期默示录](https://bgm.tv/subject/1891) 7.323 | [蜂蜜与四叶草II](https://bgm.tv/subject/848) 7.499 | [阿尔卑斯山的少女海蒂](https://bgm.tv/subject/5487) 7.387 |
| 8 | [魔卡少女樱 被封印的卡片](https://bgm.tv/subject/1942) 7.343 | [阿尔卑斯山的少女海蒂](https://bgm.tv/subject/5487) 7.282 | [续·终物语](https://bgm.tv/subject/233926) 7.342 | [FLCL](https://bgm.tv/subject/822) 7.451 |
| 9 | [偶像大师 灰姑娘女孩 U149](https://bgm.tv/subject/376703) 7.378 | [蜂蜜与四叶草II](https://bgm.tv/subject/848) 7.459 | [阿尔卑斯山的少女海蒂](https://bgm.tv/subject/5487) 7.310 | [续·终物语](https://bgm.tv/subject/233926) 7.423 |
| 10 | [天才麻将少女](https://bgm.tv/subject/1444) 7.259 | [FLCL](https://bgm.tv/subject/822) 7.311 | [少女革命 思春期默示录](https://bgm.tv/subject/1891) 7.356 | [摇曳露营△ 第二季](https://bgm.tv/subject/262897) 7.517 |
| 11 | [星之梦～星之人～](https://bgm.tv/subject/178884) 7.384 | [玉响～毕业写真～](https://bgm.tv/subject/109869) 7.324 | [FLCL](https://bgm.tv/subject/822) 7.357 | [乒乓](https://bgm.tv/subject/93739) 7.372 |
| 12 | [DARKER THAN BLACK -黑之契约者-](https://bgm.tv/subject/292) 7.316 | [城市猎人](https://bgm.tv/subject/10391) 7.319 | [剧场总集篇孤独摇滚！ Re:Re:](https://bgm.tv/subject/459642) 7.468 | [小魔女DoReMi 大合奏](https://bgm.tv/subject/14878) 7.402 |
| 13 | [小魔女DoReMi 大合奏](https://bgm.tv/subject/14878) 7.321 | [剧场总集篇孤独摇滚！ Re:Re:](https://bgm.tv/subject/459642) 7.422 | [城市猎人](https://bgm.tv/subject/10391) 7.356 | [向阳素描×365](https://bgm.tv/subject/330) 7.513 |
| 14 | [圣母在上 春](https://bgm.tv/subject/4215) 7.380 | [妖精森林的小不点](https://bgm.tv/subject/221726) 7.346 | [妖精森林的小不点](https://bgm.tv/subject/221726) 7.383 | [星之梦～星之人～](https://bgm.tv/subject/178884) 7.491 |
| 15 | [坂道上的阿波罗](https://bgm.tv/subject/29426) 7.295 | [续·终物语](https://bgm.tv/subject/233926) 7.285 | [摇曳露营△](https://bgm.tv/subject/207195) 7.496 | [悠久之翼2](https://bgm.tv/subject/1029) 7.600 |
| 16 | [奇诺之旅](https://bgm.tv/subject/1948) 7.245 | [摇曳露营△](https://bgm.tv/subject/207195) 7.454 | [星之梦～星之人～](https://bgm.tv/subject/178884) 7.434 | [交响情人梦Finale](https://bgm.tv/subject/3478) 7.464 |
| 17 | [双恋 Alternative](https://bgm.tv/subject/2643) 7.238 | [星之梦～星之人～](https://bgm.tv/subject/178884) 7.384 | [玉响～毕业写真～](https://bgm.tv/subject/109869) 7.361 | [来玩游戏吧](https://bgm.tv/subject/236020) 7.452 |
| 18 | [少女革命](https://bgm.tv/subject/1453) 7.291 | [机动警察剧场版2 和平保卫战](https://bgm.tv/subject/321) 7.234 | [虫师](https://bgm.tv/subject/340) 7.324 | [摇曳露营△](https://bgm.tv/subject/207195) 7.574 |
| 19 | [美妙旋律 Rainbow Live](https://bgm.tv/subject/62285) 7.311 | [虫师](https://bgm.tv/subject/340) 7.301 | [悠久之翼2](https://bgm.tv/subject/1029) 7.507 | [你看起来很好吃](https://bgm.tv/subject/13014) 7.362 |
| 20 | [悠久之翼](https://bgm.tv/subject/799) 7.451 | [乒乓](https://bgm.tv/subject/93739) 7.249 | [机动警察剧场版2 和平保卫战](https://bgm.tv/subject/321) 7.242 | [少年同盟 2](https://bgm.tv/subject/29421) 7.392 |

## MMR 前前二十

| 名次 | A 当前 | B 绝对评分语义 | C 再加标准差弱调整 | D 恢复 80 锚点 |
|---:|---|---|---|---|
| 1 | [悠久之翼2](https://bgm.tv/subject/1029) 7.516 | [日常 ETV版](https://bgm.tv/subject/28205) 7.592 | [日常 ETV版](https://bgm.tv/subject/28205) 7.642 | [日常 ETV版](https://bgm.tv/subject/28205) 7.690 |
| 2 | [悠久之翼](https://bgm.tv/subject/799) 7.451 | [银魂 〜无论什么事开始虽然重要但伸个懒腰的话也不错〜](https://bgm.tv/subject/3153) 7.503 | [银魂 〜无论什么事开始虽然重要但伸个懒腰的话也不错〜](https://bgm.tv/subject/3153) 7.550 | [银魂 〜无论什么事开始虽然重要但伸个懒腰的话也不错〜](https://bgm.tv/subject/3153) 7.675 |
| 3 | [Love Live! 虹咲学园校园偶像同好会](https://bgm.tv/subject/296659) 7.451 | [悠久之翼](https://bgm.tv/subject/799) 7.471 | [悠久之翼](https://bgm.tv/subject/799) 7.523 | [悠久之翼](https://bgm.tv/subject/799) 7.632 |
| 4 | [续·终物语](https://bgm.tv/subject/233926) 7.413 | [蜂蜜与四叶草II](https://bgm.tv/subject/848) 7.459 | [悠久之翼2](https://bgm.tv/subject/1029) 7.507 | [悠久之翼2](https://bgm.tv/subject/1029) 7.600 |
| 5 | [星际牛仔](https://bgm.tv/subject/253) 7.412 | [悠久之翼2](https://bgm.tv/subject/1029) 7.457 | [蜂蜜与四叶草II](https://bgm.tv/subject/848) 7.499 | [玉响～毕业写真～](https://bgm.tv/subject/109869) 7.585 |
| 6 | [圣母在上 第3季](https://bgm.tv/subject/4216) 7.393 | [摇曳露营△](https://bgm.tv/subject/207195) 7.454 | [摇曳露营△](https://bgm.tv/subject/207195) 7.496 | [摇曳露营△](https://bgm.tv/subject/207195) 7.574 |
| 7 | [星之梦～星之人～](https://bgm.tv/subject/178884) 7.384 | [交响情人梦Finale](https://bgm.tv/subject/3478) 7.425 | [交响情人梦Finale](https://bgm.tv/subject/3478) 7.471 | [剧场总集篇孤独摇滚！ Re:Re:](https://bgm.tv/subject/459642) 7.536 |
| 8 | [偶像大师 剧场版 向着光辉的彼岸！](https://bgm.tv/subject/64172) 7.382 | [剧场总集篇孤独摇滚！ Re:Re:](https://bgm.tv/subject/459642) 7.422 | [剧场总集篇孤独摇滚！ Re:Re:](https://bgm.tv/subject/459642) 7.468 | [摇曳露营△ 第二季](https://bgm.tv/subject/262897) 7.517 |
| 9 | [圣母在上 春](https://bgm.tv/subject/4215) 7.380 | [娜娜](https://bgm.tv/subject/486) 7.387 | [星之梦～星之人～](https://bgm.tv/subject/178884) 7.434 | [向阳素描×365](https://bgm.tv/subject/330) 7.513 |
| 10 | [偶像大师 灰姑娘女孩 U149](https://bgm.tv/subject/376703) 7.378 | [星之梦～星之人～](https://bgm.tv/subject/178884) 7.384 | [娜娜](https://bgm.tv/subject/486) 7.416 | [少女革命 思春期默示录](https://bgm.tv/subject/1891) 7.502 |
| 11 | [偶像大师](https://bgm.tv/subject/11577) 7.377 | [向阳素描×365](https://bgm.tv/subject/330) 7.372 | [向阳素描×365](https://bgm.tv/subject/330) 7.412 | [向阳素描×蜂窝](https://bgm.tv/subject/37819) 7.502 |
| 12 | [FLCL](https://bgm.tv/subject/822) 7.372 | [小魔女DoReMi 大合奏](https://bgm.tv/subject/14878) 7.360 | [小魔女DoReMi 大合奏](https://bgm.tv/subject/14878) 7.402 | [星之梦～星之人～](https://bgm.tv/subject/178884) 7.491 |
| 13 | [魔卡少女樱 被封印的卡片](https://bgm.tv/subject/1942) 7.343 | [偶像大师](https://bgm.tv/subject/11577) 7.357 | [向阳素描×蜂窝](https://bgm.tv/subject/37819) 7.395 | [向阳素描](https://bgm.tv/subject/896) 7.489 |
| 14 | [圣母在上 第4季](https://bgm.tv/subject/1321) 7.330 | [向阳素描×蜂窝](https://bgm.tv/subject/37819) 7.353 | [偶像大师](https://bgm.tv/subject/11577) 7.392 | [向阳素描×☆☆☆](https://bgm.tv/subject/3622) 7.483 |
| 15 | [小魔女DoReMi 大合奏](https://bgm.tv/subject/14878) 7.321 | [偶像大师 剧场版 向着光辉的彼岸！](https://bgm.tv/subject/64172) 7.352 | [偶像大师 剧场版 向着光辉的彼岸！](https://bgm.tv/subject/64172) 7.388 | [玉响～more aggressive～](https://bgm.tv/subject/45213) 7.479 |
| 16 | [DARKER THAN BLACK -黑之契约者-](https://bgm.tv/subject/292) 7.316 | [妖精森林的小不点](https://bgm.tv/subject/221726) 7.346 | [妖精森林的小不点](https://bgm.tv/subject/221726) 7.383 | [草莓棉花糖](https://bgm.tv/subject/284) 7.467 |
| 17 | [美妙旋律 Rainbow Live](https://bgm.tv/subject/62285) 7.311 | [向阳素描×☆☆☆](https://bgm.tv/subject/3622) 7.335 | [向阳素描×☆☆☆](https://bgm.tv/subject/3622) 7.380 | [交响情人梦Finale](https://bgm.tv/subject/3478) 7.464 |
| 18 | [美妙天堂](https://bgm.tv/subject/99748) 7.308 | [蜂蜜与四叶草](https://bgm.tv/subject/847) 7.330 | [蜂蜜与四叶草](https://bgm.tv/subject/847) 7.362 | [南家三姐妹 我回来了](https://bgm.tv/subject/47685) 7.461 |
| 19 | [物语系列 外传季&怪物季](https://bgm.tv/subject/475354) 7.304 | [玉响～毕业写真～](https://bgm.tv/subject/109869) 7.324 | [玉响～毕业写真～](https://bgm.tv/subject/109869) 7.361 | [来玩游戏吧](https://bgm.tv/subject/236020) 7.452 |
| 20 | [玉响～more aggressive～](https://bgm.tv/subject/45213) 7.304 | [少女革命 思春期默示录](https://bgm.tv/subject/1891) 7.323 | [FLCL](https://bgm.tv/subject/822) 7.357 | [FLCL](https://bgm.tv/subject/822) 7.451 |

完整逐项数据见 results.json。

## 候选源过滤实验

取得 501/501 个候选详情；过滤后剩余 297 个，排除 204 个。详情读取失败的候选不因缺失数据而误删。

排除原因：剧场版／OVA／OAD／特别篇 201 个；总集／重编／重制 1 个；已知不足 10 集 2 个。

规则仅作用于候选召回之后、评分之前；画像、评分权重和全池 MMR 均未改变。

### 过滤后的统一 MMR 前二十

| 名次 | B 绝对评分语义 | C 再加标准差弱调整 |
|---:|---|---|
| 1 | [悠久之翼](https://bgm.tv/subject/799) 7.471 | [悠久之翼](https://bgm.tv/subject/799) 7.523 |
| 2 | [摇曳露营△](https://bgm.tv/subject/207195) 7.454 | [摇曳露营△](https://bgm.tv/subject/207195) 7.496 |
| 3 | [小魔女DoReMi 大合奏](https://bgm.tv/subject/14878) 7.360 | [小魔女DoReMi 大合奏](https://bgm.tv/subject/14878) 7.402 |
| 4 | [偶像大师](https://bgm.tv/subject/11577) 7.357 | [偶像大师](https://bgm.tv/subject/11577) 7.392 |
| 5 | [交响情人梦Finale](https://bgm.tv/subject/3478) 7.425 | [交响情人梦Finale](https://bgm.tv/subject/3478) 7.471 |
| 6 | [蜂蜜与四叶草II](https://bgm.tv/subject/848) 7.459 | [蜂蜜与四叶草II](https://bgm.tv/subject/848) 7.499 |
| 7 | [阿尔卑斯山的少女海蒂](https://bgm.tv/subject/5487) 7.282 | [阿尔卑斯山的少女海蒂](https://bgm.tv/subject/5487) 7.310 |
| 8 | [城市猎人](https://bgm.tv/subject/10391) 7.319 | [城市猎人](https://bgm.tv/subject/10391) 7.356 |
| 9 | [虫师](https://bgm.tv/subject/340) 7.301 | [虫师](https://bgm.tv/subject/340) 7.324 |
| 10 | [百变之星](https://bgm.tv/subject/4163) 7.226 | [百变之星](https://bgm.tv/subject/4163) 7.238 |
| 11 | [少女革命](https://bgm.tv/subject/1453) 7.275 | [少女革命](https://bgm.tv/subject/1453) 7.312 |
| 12 | [再见绝望先生](https://bgm.tv/subject/299) 7.289 | [悠久之翼2](https://bgm.tv/subject/1029) 7.507 |
| 13 | [乒乓](https://bgm.tv/subject/93739) 7.249 | [再见绝望先生](https://bgm.tv/subject/299) 7.322 |
| 14 | [悠久之翼2](https://bgm.tv/subject/1029) 7.457 | [乒乓](https://bgm.tv/subject/93739) 7.276 |
| 15 | [妖精森林的小不点](https://bgm.tv/subject/221726) 7.346 | [歌剧少女!!](https://bgm.tv/subject/317680) 7.333 |
| 16 | [歌剧少女!!](https://bgm.tv/subject/317680) 7.292 | [妖精森林的小不点](https://bgm.tv/subject/221726) 7.383 |
| 17 | [娜娜](https://bgm.tv/subject/486) 7.387 | [玉响～more aggressive～](https://bgm.tv/subject/45213) 7.347 |
| 18 | [玉响～more aggressive～](https://bgm.tv/subject/45213) 7.304 | [娜娜](https://bgm.tv/subject/486) 7.416 |
| 19 | [星际牛仔](https://bgm.tv/subject/253) 7.201 | [全金属狂潮 校园篇](https://bgm.tv/subject/338) 7.175 |
| 20 | [全金属狂潮 校园篇](https://bgm.tv/subject/338) 7.143 | [星际牛仔](https://bgm.tv/subject/253) 7.223 |

### 过滤后的 MMR 前原始前二十

| 名次 | B 绝对评分语义 | C 再加标准差弱调整 |
|---:|---|---|
| 1 | [悠久之翼](https://bgm.tv/subject/799) 7.471 | [悠久之翼](https://bgm.tv/subject/799) 7.523 |
| 2 | [蜂蜜与四叶草II](https://bgm.tv/subject/848) 7.459 | [悠久之翼2](https://bgm.tv/subject/1029) 7.507 |
| 3 | [悠久之翼2](https://bgm.tv/subject/1029) 7.457 | [蜂蜜与四叶草II](https://bgm.tv/subject/848) 7.499 |
| 4 | [摇曳露营△](https://bgm.tv/subject/207195) 7.454 | [摇曳露营△](https://bgm.tv/subject/207195) 7.496 |
| 5 | [交响情人梦Finale](https://bgm.tv/subject/3478) 7.425 | [交响情人梦Finale](https://bgm.tv/subject/3478) 7.471 |
| 6 | [娜娜](https://bgm.tv/subject/486) 7.387 | [娜娜](https://bgm.tv/subject/486) 7.416 |
| 7 | [向阳素描×365](https://bgm.tv/subject/330) 7.372 | [向阳素描×365](https://bgm.tv/subject/330) 7.412 |
| 8 | [小魔女DoReMi 大合奏](https://bgm.tv/subject/14878) 7.360 | [小魔女DoReMi 大合奏](https://bgm.tv/subject/14878) 7.402 |
| 9 | [偶像大师](https://bgm.tv/subject/11577) 7.357 | [向阳素描×蜂窝](https://bgm.tv/subject/37819) 7.395 |
| 10 | [向阳素描×蜂窝](https://bgm.tv/subject/37819) 7.353 | [偶像大师](https://bgm.tv/subject/11577) 7.392 |
| 11 | [妖精森林的小不点](https://bgm.tv/subject/221726) 7.346 | [妖精森林的小不点](https://bgm.tv/subject/221726) 7.383 |
| 12 | [向阳素描×☆☆☆](https://bgm.tv/subject/3622) 7.335 | [向阳素描×☆☆☆](https://bgm.tv/subject/3622) 7.380 |
| 13 | [蜂蜜与四叶草](https://bgm.tv/subject/847) 7.330 | [蜂蜜与四叶草](https://bgm.tv/subject/847) 7.362 |
| 14 | [草莓棉花糖](https://bgm.tv/subject/284) 7.321 | [城市猎人](https://bgm.tv/subject/10391) 7.356 |
| 15 | [城市猎人](https://bgm.tv/subject/10391) 7.319 | [草莓棉花糖](https://bgm.tv/subject/284) 7.355 |
| 16 | [龙珠](https://bgm.tv/subject/9565) 7.313 | [玉响～more aggressive～](https://bgm.tv/subject/45213) 7.347 |
| 17 | [玉响～more aggressive～](https://bgm.tv/subject/45213) 7.304 | [龙珠](https://bgm.tv/subject/9565) 7.344 |
| 18 | [虫师](https://bgm.tv/subject/340) 7.301 | [歌剧少女!!](https://bgm.tv/subject/317680) 7.333 |
| 19 | [Heart Catch 光之美少女！](https://bgm.tv/subject/4124) 7.300 | [Heart Catch 光之美少女！](https://bgm.tv/subject/4124) 7.325 |
| 20 | [向阳素描](https://bgm.tv/subject/896) 7.293 | [虫师](https://bgm.tv/subject/340) 7.324 |

### 原 B 排序中最靠前的被排除候选

- 原始第 1：日常 ETV版（recut-or-remake）
- 原始第 2：银魂 〜无论什么事开始虽然重要但伸个懒腰的话也不错〜（movie-or-special）
- 原始第 8：剧场总集篇孤独摇滚！ Re:Re:（movie-or-special）
- 原始第 10：星之梦～星之人～（movie-or-special）
- 原始第 15：偶像大师 剧场版 向着光辉的彼岸！（movie-or-special）
- 原始第 19：玉响～毕业写真～（movie-or-special）
- 原始第 20：少女革命 思春期默示录（movie-or-special）
- 原始第 23：日常 OAD（movie-or-special）
- 原始第 25：FLCL（movie-or-special）
- 原始第 33：续·终物语（movie-or-special）
- 原始第 35：草莓棉花糖 OVA 第1期（movie-or-special）
- 原始第 37：向阳素描×SP（movie-or-special）
- 原始第 38：向阳素描×365 特别篇（movie-or-special）
- 原始第 41：向阳素描 沙英・寻 毕业篇（movie-or-special）
- 原始第 42：RE:cycle of the PENGUINDRUM [后篇] 我爱你（movie-or-special）
- 原始第 48：中二病也要谈恋爱！剧场版 小鸟游六花・改（movie-or-special）
- 原始第 49：你看起来很好吃（movie-or-special）
- 原始第 51：草莓棉花糖 OVA 第2期（movie-or-special）
- 原始第 54：百变之星 不死鸟传说 ～蕾拉・汉密尔顿物语～（movie-or-special）
- 原始第 55：向阳素描×☆☆☆ 特别篇（movie-or-special）