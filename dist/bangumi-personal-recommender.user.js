// ==UserScript==
// @name         Bangumi 个性推荐
// @namespace    https://bgm.tv/user/wylt
// @version      0.11.0
// @description  个人主页的动画回顾与协同推荐：年代柱图、偏好词云与人物排行。
// @author       wylt
// @match        https://bgm.tv/*
// @match        http://bgm.tv/*
// @match        https://bangumi.tv/*
// @match        http://bangumi.tv/*
// @match        https://chii.in/*
// @match        http://chii.in/*
// ==/UserScript==

(function attachProfileUI(global) {
  "use strict";
  const isProfile = () => /^(bgm\.tv|bangumi\.tv|chii\.in)$/.test(location.hostname)
    ? /^\/user\/wylt\/?$/.test(location.pathname)
    : /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && Boolean(document.querySelector('[data-bgm-profile-demo]'));
  function mount(id, order) {
    if (!isProfile() || document.getElementById(id)) return null;
    const column = document.getElementById('user_home');
    if (!column) return null;
    let area = document.getElementById('bgmpr-profile-sections');
    if (!area) {
      area = document.createElement('div');
      area.id = 'bgmpr-profile-sections';
      area.style.cssText = 'display:flex;flex-direction:column;gap:32px;clear:both;width:100%;min-width:0;margin:28px 0 36px';
      const blog = column.querySelector('#blog');
      if (blog) blog.after(area); else column.append(area);
    }
    const host = document.createElement('div');
    host.id = id;
    host.style.cssText = `display:block;min-width:0;width:100%;order:${order}`;
    area.append(host);
    return host;
  }
  function theme() {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'dark' || explicit === 'light') return explicit;
    return /dark|night/i.test(`${document.documentElement.className} ${document.body?.className || ''}`)
      || matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function lazy(host, callback) {
    let started = false;
    const run = () => { if (!started) { started = true; callback(); } };
    if (!('IntersectionObserver' in global)) { run(); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); run(); }
    }, { rootMargin: '300px' });
    observer.observe(host);
  }
  const css = `
    :host{--ink:#444;--muted:#777;--line:#eee;--surface:#fff;--soft:#fafafa;--pink:#f09199;--pink-soft:#fff1f3;--link:#a74458;--site-link:#16718b;display:block;font:13px/1.6 Arial,"Microsoft YaHei",sans-serif;color:var(--ink);container-type:inline-size;color-scheme:light}
    :host([data-theme="dark"]){--ink:#ddd;--muted:#aaa;--line:#383838;--surface:#202020;--soft:#282828;--pink:#e99aa7;--pink-soft:#39282d;--link:#efa6b3;--site-link:#8ec9dc;color-scheme:dark}
    *,*::before,*::after{box-sizing:border-box} [hidden]{display:none!important}
    button,input,select{font:inherit}button,summary,select{cursor:pointer}button{border:0;background:transparent;color:var(--muted);padding:5px 10px;border-radius:6px;transition:background .18s,color .18s}button:hover:not(:disabled),summary:hover{color:var(--link);background:var(--pink-soft)}button:disabled{opacity:.4;cursor:default}
    a{color:var(--site-link);text-decoration:none}a:hover{color:var(--link);text-decoration:underline}
    :is(a,button,input,select,summary):focus-visible{outline:2px solid var(--link);outline-offset:3px}
    h2,h3,p{margin:0}h2{font-size:18px;font-weight:400;color:var(--muted)}h3{font-size:13px;font-weight:400}
    .module{min-width:0;background:var(--surface)}.module-head{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:0 0 9px;border-bottom:1px solid var(--line);margin-bottom:16px}.module-head h2{margin-right:auto}.module-head>button{font-size:12px}
    .tabs{display:flex;flex-wrap:wrap;gap:3px;padding:3px;background:var(--soft);border-radius:8px;width:fit-content;max-width:100%}.tabs button{padding:4px 12px;font-size:12px}.tabs button[aria-pressed="true"]{background:var(--pink);color:#40232a}
    .content{min-width:0}.empty,.error{padding:24px 8px;color:var(--muted);text-align:center}.empty button,.error button,.welcome button{color:var(--link);background:var(--pink-soft);margin-top:10px}
    .progress-region,.progress{margin:10px 0;color:var(--muted);font-size:12px}.progress-copy{display:flex;justify-content:space-between;gap:12px}.progress-track{height:2px;background:var(--line);margin-top:6px}.progress-track span{display:block;height:100%;background:var(--pink);transform-origin:left;transform:scaleX(0)}
    .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
    svg{width:16px;height:16px;vertical-align:middle}select,input{color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:5px 8px;max-width:100%}
    @container(max-width:500px){.module-head{gap:8px}.tabs button{padding:7px 10px}button,summary{min-height:36px}input,select{font-size:16px}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
  `;
  global.BangumiProfileUI = { mount, theme, lazy, css, isProfile };
})(globalThis);


(function attachRecommendationFeed(globalObject) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const OWNER = "wylt";

  function normalizeCandidate(row) {
    const subject = row?.subject || {};
    const id = Number(subject.id);
    const predicted = Number(row?.predicted);
    if (!Number.isSafeInteger(id) || id <= 0 || Number(subject.type) !== 2 ||
        !Number.isFinite(predicted) || predicted < 1 || predicted > 10) return null;
    return {
      subject: {
        id,
        type: 2,
        name: String(subject.name || ""),
        nameCn: String(subject.nameCn || subject.name_cn || ""),
        image: String(subject.image || ""),
        tags: Array.isArray(subject.tags) ? subject.tags.filter((tag) => typeof tag === "string" && tag.trim()).slice(0, 12) : [],
        rating: {
          score: Number.isFinite(Number(subject.rating?.score)) ? Number(subject.rating.score) : 0,
          total: Number.isFinite(Number(subject.rating?.total)) ? Math.max(0, Number(subject.rating.total)) : 0,
        },
      },
      predicted,
      reasons: Array.isArray(row.reasons) ? row.reasons.map(String).filter(Boolean).slice(0, 3) : [],
      collaborativeLift: Number(row.collaborativeLift) || 0,
    };
  }

  function parseFeed(raw) {
    if (raw?.schema !== SCHEMA_VERSION || raw?.owner !== OWNER ||
        !Number.isFinite(Date.parse(raw.generatedAt)) || !Array.isArray(raw.candidates)) {
      throw new Error("推荐数据版本不兼容，请稍后更新组件。");
    }
    const seen = new Set();
    const candidates = [];
    for (const row of raw.candidates.slice(0, 2000)) {
      const item = normalizeCandidate(row);
      if (!item || seen.has(item.subject.id)) continue;
      seen.add(item.subject.id);
      candidates.push(item);
    }
    if (candidates.length < 5) throw new Error("推荐数据暂时不足，请稍后再试。");
    candidates.sort((left, right) => right.predicted - left.predicted || left.subject.id - right.subject.id);
    return {
      generatedAt: raw.generatedAt,
      peerCount: Math.max(0, Number(raw.peerCount) || 0),
      neighborCount: Math.max(0, Number(raw.neighborCount) || 0),
      ratedCount: Math.max(0, Number(raw.ratedCount) || 0),
      model: raw.model === "joint" ? "joint" : "content",
      candidates,
    };
  }

  function unmarkedCandidates(feed, collectionRows) {
    const marked = new Set((Array.isArray(collectionRows) ? collectionRows : [])
      .map((row) => Number(row.subject_id || row.subjectId))
      .filter(Number.isSafeInteger));
    return feed.candidates.filter((row) => !marked.has(row.subject.id));
  }

  const api = { SCHEMA_VERSION, OWNER, parseFeed, unmarkedCandidates };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalObject.BangumiRecommendationFeed = api;
})(typeof globalThis !== "undefined" ? globalThis : this);


globalThis.BangumiInitialRecommendationFeed = {
  "schema": 1,
  "owner": "wylt",
  "generatedAt": "2026-09-28T01:17:35.106785+00:00",
  "peerCount": 100,
  "neighborCount": 40,
  "ratedCount": 1326,
  "model": "content",
  "candidates": [
    {
      "subject": {
        "id": 253,
        "type": 2,
        "name": "カウボーイビバップ",
        "nameCn": "星际牛仔",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/c2/4c/253_jJJj9.jpg",
        "tags": [
          "渡边信一郎",
          "菅野洋子",
          "星际牛仔",
          "科幻",
          "经典",
          "sunrise",
          "神作",
          "神配乐",
          "tv",
          "1998",
          "原创",
          "cowboybebop"
        ],
        "rating": {
          "score": 9.1,
          "total": 19639
        }
      },
      "predicted": 9.524,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“sunrise、科幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 2907,
        "type": 2,
        "name": "銀河英雄伝説",
        "nameCn": "银河英雄传说",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/c7/55/2907_8xX82.jpg",
        "tags": [
          "银河英雄传说",
          "田中芳树",
          "科幻",
          "经典",
          "ova",
          "小说改",
          "1989",
          "补旧番",
          "银英",
          "tv",
          "皆杀的田中",
          "世界观"
        ],
        "rating": {
          "score": 8.8,
          "total": 2955
        }
      },
      "predicted": 9,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“科幻、sf”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 11577,
        "type": 2,
        "name": "THE IDOLM@STER",
        "nameCn": "偶像大师",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/a8/6a/11577_5U5G1.jpg",
        "tags": [
          "偶像大师",
          "a-1pictures",
          "偶像",
          "tv",
          "2011年7月",
          "游戏改",
          "励志",
          "锦织敦史",
          "2011",
          "神前暁",
          "骗钱大师",
          "音乐"
        ],
        "rating": {
          "score": 8.3,
          "total": 8828
        }
      },
      "predicted": 8.885,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“百合、a-1pictures”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 25961,
        "type": 2,
        "name": "Tom and Jerry",
        "nameCn": "猫和老鼠（1965年电视版）",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/fd/60/25961_WDKz6.jpg",
        "tags": [
          "童年",
          "欧美",
          "搞笑",
          "童年的经典",
          "经典",
          "神作",
          "tom&jerry",
          "tv",
          "美国",
          "原创",
          "爆笑",
          "汤姆杰瑞好基友"
        ],
        "rating": {
          "score": 9.1,
          "total": 14203
        }
      },
      "predicted": 8.844,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“奇幻、原创”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 848,
        "type": 2,
        "name": "ハチミツとクローバー II",
        "nameCn": "蜂蜜与四叶草II",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/36/2e/848_RC9L8.jpg",
        "tags": [
          "青春",
          "j.c.staff",
          "蜂蜜与四叶草ii",
          "校园",
          "羽海野千花",
          "治愈",
          "tv",
          "2006",
          "noitamina",
          "人生",
          "治愈系",
          "大学"
        ],
        "rating": {
          "score": 8.5,
          "total": 4507
        }
      },
      "predicted": 8.831,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“校园、恋爱”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 1015,
        "type": 2,
        "name": "機動戦士ガンダム0080 ポケットの中の戦争",
        "nameCn": "机动战士高达0080 口袋里的战争",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/29/89/1015_Z2xoh.jpg",
        "tags": [
          "高达",
          "ova",
          "sunrise",
          "战争",
          "0080",
          "1989",
          "萝卜",
          "原创",
          "美树本晴彦",
          "科幻",
          "高山文彦",
          "是爷们就开扎古"
        ],
        "rating": {
          "score": 8.6,
          "total": 6053
        }
      },
      "predicted": 8.806,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“sunrise、科幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 1728,
        "type": 2,
        "name": "るろうに剣心 -明治剣客浪漫譚- 追憶編",
        "nameCn": "浪客剑心 追忆篇",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/71/37/1728_HLsCr.jpg",
        "tags": [
          "ova",
          "剑心",
          "浪客剑心",
          "追忆篇",
          "雪代巴",
          "1999",
          "悲剧",
          "十字伤",
          "studiodeen",
          "漫画改",
          "古桥一浩",
          "明治维新"
        ],
        "rating": {
          "score": 8.9,
          "total": 9697
        }
      },
      "predicted": 8.804,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“恋爱、催泪”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 28205,
        "type": 2,
        "name": "日常 Eテレ版",
        "nameCn": "日常 ETV版",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/19/6b/28205_AAqG1.jpg",
        "tags": [
          "日常",
          "京阿尼",
          "搞笑",
          "2012年1月",
          "tv",
          "爆笑",
          "电波",
          "吐槽向",
          "重制版",
          "石原立也",
          "2012",
          "漫画改"
        ],
        "rating": {
          "score": 8.2,
          "total": 2585
        }
      },
      "predicted": 8.766,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“百合、电波”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 9622,
        "type": 2,
        "name": "機動戦士Ζガンダム",
        "nameCn": "机动战士Z高达",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/97/c8/9622_2P229.jpg",
        "tags": [
          "高达",
          "富野由悠季",
          "sunrise",
          "tv",
          "gundam",
          "1985",
          "原创",
          "时代的眼泪",
          "科幻",
          "高达z",
          "机战",
          "萝卜"
        ],
        "rating": {
          "score": 8.5,
          "total": 5381
        }
      },
      "predicted": 8.757,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“sunrise、科幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 4583,
        "type": 2,
        "name": "機動戦士ガンダム 逆襲のシャア",
        "nameCn": "机动战士高达 逆袭的夏亚",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/33/80/4583_RvVeE.jpg",
        "tags": [
          "高达",
          "剧场版",
          "富野由悠季",
          "sunrise",
          "1988",
          "gundam",
          "原创",
          "萝卜",
          "科幻",
          "机战",
          "14年的基情",
          "nt大战"
        ],
        "rating": {
          "score": 8.5,
          "total": 5214
        }
      },
      "predicted": 8.745,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“sunrise、科幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 1453,
        "type": 2,
        "name": "少女革命ウテナ",
        "nameCn": "少女革命",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/53/6a/1453_iZIOZ.jpg",
        "tags": [
          "j.c.staff",
          "百合",
          "幾原邦彥",
          "tv",
          "少女革命",
          "几原邦彦",
          "原创",
          "1997",
          "内涵",
          "象徵手法",
          "神作",
          "少女革命ウテナ"
        ],
        "rating": {
          "score": 8.4,
          "total": 5756
        }
      },
      "predicted": 8.743,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“百合、校园”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 64172,
        "type": 2,
        "name": "THE IDOLM@STER MOVIE 輝きの向こう側へ！",
        "nameCn": "偶像大师 剧场版 向着光辉的彼岸！",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/f8/45/64172_8MujB.jpg",
        "tags": [
          "剧场版",
          "a-1pictures",
          "偶像大师",
          "偶像",
          "2014",
          "锦织敦史",
          "游戏改",
          "im@s",
          "音乐",
          "2014年1月",
          "輝きの向こう側へ！",
          "錦織敦史"
        ],
        "rating": {
          "score": 8,
          "total": 4259
        }
      },
      "predicted": 8.738,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“百合、a-1_pictures”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 847,
        "type": 2,
        "name": "ハチミツとクローバー",
        "nameCn": "蜂蜜与四叶草",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/f4/55/847_xHHqh.jpg",
        "tags": [
          "青春",
          "蜂蜜与四叶草",
          "j.c.staff",
          "校园",
          "治愈系",
          "羽海野千花",
          "tv",
          "治愈",
          "2005",
          "noitamina",
          "大学",
          "尋找自我"
        ],
        "rating": {
          "score": 8.4,
          "total": 5811
        }
      },
      "predicted": 8.735,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“校园、恋爱”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 37183,
        "type": 2,
        "name": "太陽の牙ダグラム",
        "nameCn": "太阳之牙达格拉姆",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/d7/1b/37183_TT9yf.jpg",
        "tags": [
          "sunrise",
          "tv",
          "原创",
          "1981",
          "萝卜",
          "高桥良辅",
          "科幻",
          "神田武幸",
          "真实系",
          "政治",
          "高橋良輔",
          "机战"
        ],
        "rating": {
          "score": 8.3,
          "total": 293
        }
      },
      "predicted": 8.734,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“sunrise、科幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 860,
        "type": 2,
        "name": "カウボーイビバップ 天国の扉",
        "nameCn": "星际牛仔 天国之扉",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/fc/49/860_gtiyS.jpg",
        "tags": [
          "剧场版",
          "渡边信一郎",
          "星际牛仔",
          "sunrise",
          "菅野よう子",
          "bones",
          "2001",
          "原创",
          "科幻",
          "菅野洋子",
          "cowboy",
          "cowboy_bebop"
        ],
        "rating": {
          "score": 8.2,
          "total": 7227
        }
      },
      "predicted": 8.715,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“sunrise、科幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 40003,
        "type": 2,
        "name": "うる星やつら2 ビューティフル・ドリーマー",
        "nameCn": "福星小子2 绮丽梦中人",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/51/54/40003_d2Egm.jpg",
        "tags": [
          "押井守",
          "剧场版",
          "1984",
          "studiopierrot",
          "高桥留美子",
          "漫画改",
          "福星小子",
          "漫改",
          "奇幻",
          "搞笑",
          "西村纯二",
          "电影"
        ],
        "rating": {
          "score": 8.2,
          "total": 1563
        }
      },
      "predicted": 8.709,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“校园、恋爱”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 1428,
        "type": 2,
        "name": "鋼の錬金術師 FULLMETAL ALCHEMIST",
        "nameCn": "钢之炼金术师 FULLMETAL ALCHEMIST",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/06/63/1428_xwkMI.jpg",
        "tags": [
          "钢之炼金术师",
          "bones",
          "骨头社",
          "热血",
          "漫画改",
          "等价交换",
          "钢炼",
          "tv",
          "2009年4月",
          "2009",
          "战斗",
          "fa"
        ],
        "rating": {
          "score": 8.8,
          "total": 25135
        }
      },
      "predicted": 8.699,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“奇幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 338,
        "type": 2,
        "name": "フルメタル・パニック? ふもっふ",
        "nameCn": "全金属狂潮 校园篇",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/81/9f/338_W81CE.jpg",
        "tags": [
          "京阿尼",
          "全金属狂潮",
          "搞笑",
          "爆笑",
          "tv",
          "校园",
          "贺东招二",
          "2003",
          "校园篇",
          "bon太君",
          "轻小说改",
          "全金属狂潮2"
        ],
        "rating": {
          "score": 8.1,
          "total": 6521
        }
      },
      "predicted": 8.698,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“校园、京阿尼”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 495562,
        "type": 2,
        "name": "デッドデッドデーモンズデデデデデストラクション",
        "nameCn": "DDDD 恶魔的破坏",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/f5/85/495562_onpMR.jpg",
        "tags": [
          "科幻",
          "漫画改",
          "production+h.",
          "末世",
          "2024",
          "2024年4月",
          "日常",
          "tv",
          "web",
          "漫改",
          "日本",
          "剧情"
        ],
        "rating": {
          "score": 7.6,
          "total": 3502
        }
      },
      "predicted": 8.679,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“百合、电波”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 14878,
        "type": 2,
        "name": "おジャ魔女どれみドッカ～ン!",
        "nameCn": "小魔女DoReMi 大合奏",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/0e/e8/14878_1hWbu.jpg",
        "tags": [
          "tv",
          "2002",
          "魔法少女",
          "原创",
          "五十岚卓哉",
          "东映",
          "童年",
          "東映アニメーション",
          "细田守",
          "tvb",
          "马越嘉彦",
          "doremi"
        ],
        "rating": {
          "score": 8.3,
          "total": 402
        }
      },
      "predicted": 8.666,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“校园、原创”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 93377,
        "type": 2,
        "name": "Rick and Morty Season 1",
        "nameCn": "瑞克和莫蒂 第一季",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/db/e4/93377_TEzAK.jpg",
        "tags": [
          "科幻",
          "美国",
          "脑洞",
          "欧美",
          "搞笑",
          "tv",
          "原创",
          "2013",
          "rick_and_morty",
          "神转折",
          "奇诡万变",
          "2013年12月"
        ],
        "rating": {
          "score": 8.4,
          "total": 6348
        }
      },
      "predicted": 8.662,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“科幻、奇幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 1270,
        "type": 2,
        "name": "ARIA The ORIGINATION",
        "nameCn": "水星领航员 第三季",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/c8/50/1270_Yo7p2.jpg",
        "tags": [
          "治愈",
          "aria",
          "水星领航员",
          "tv",
          "治愈系神作",
          "2008",
          "漫画改",
          "2008年1月",
          "halfilmmaker",
          "治愈系",
          "日常",
          "科幻"
        ],
        "rating": {
          "score": 8.7,
          "total": 2954
        }
      },
      "predicted": 8.657,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“百合、科幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 3553,
        "type": 2,
        "name": "∀ガンダム",
        "nameCn": "∀高达",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/e2/50/3553_FIw4I.jpg",
        "tags": [
          "高达",
          "富野由悠季",
          "sunrise",
          "∀高达",
          "tv",
          "菅野洋子",
          "1999",
          "原创",
          "gundam",
          "科幻",
          "萝卜",
          "胡子"
        ],
        "rating": {
          "score": 8.4,
          "total": 2831
        }
      },
      "predicted": 8.649,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“sunrise、科幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 340,
        "type": 2,
        "name": "蟲師",
        "nameCn": "虫师",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/40/00/340_J14Mj.jpg",
        "tags": [
          "治愈",
          "虫师",
          "奇幻",
          "神音乐",
          "空灵",
          "内涵系",
          "tv",
          "2005",
          "治愈系",
          "人生",
          "水墨",
          "漫画改"
        ],
        "rating": {
          "score": 8.7,
          "total": 11896
        }
      },
      "predicted": 8.603,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“奇幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 1029,
        "type": 2,
        "name": "ef - a tale of melodies.",
        "nameCn": "悠久之翼2",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/84/d2/1029_Zc2U6.jpg",
        "tags": [
          "新房昭之",
          "大沼心",
          "ef",
          "shaft",
          "gal改",
          "催泪",
          "tv",
          "minori",
          "天门",
          "2008年10月",
          "ef_a_tale_of_melodies.",
          "2008"
        ],
        "rating": {
          "score": 8.1,
          "total": 6054
        }
      },
      "predicted": 8.602,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“致郁、校园”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 23304,
        "type": 2,
        "name": "伝説巨神イデオン 発動篇",
        "nameCn": "传说巨神伊迪安 发动篇",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/3a/d6/23304_ijJx5.jpg",
        "tags": [
          "富野由悠季",
          "剧场版",
          "sunrise",
          "1982",
          "萝卜",
          "原创",
          "科幻",
          "全灭",
          "传说巨神伊迪安",
          "机战",
          "裸漂",
          "日本"
        ],
        "rating": {
          "score": 8.4,
          "total": 1011
        }
      },
      "predicted": 8.6,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“sunrise、科幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 254,
        "type": 2,
        "name": "サムライチャンプルー",
        "nameCn": "混沌武士",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/c5/2f/254_PLvyV.jpg",
        "tags": [
          "渡边信一郎",
          "混沌武士",
          "tv",
          "manglobe",
          "原创",
          "2004",
          "武士",
          "动作",
          "hiphop",
          "神作",
          "战斗",
          "向日葵味道"
        ],
        "rating": {
          "score": 8.5,
          "total": 11398
        }
      },
      "predicted": 8.594,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“原创、音乐”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 207195,
        "type": 2,
        "name": "ゆるキャン△",
        "nameCn": "摇曳露营△",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/18/bc/207195_2Cp3o.jpg",
        "tags": [
          "芳文社",
          "治愈",
          "百合",
          "日常",
          "2018年1月",
          "漫画改",
          "tv",
          "摇曳露营△",
          "c-station",
          "露营",
          "2018",
          "轻百合"
        ],
        "rating": {
          "score": 8.2,
          "total": 17683
        }
      },
      "predicted": 8.593,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“百合、校园”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 1608,
        "type": 2,
        "name": "スラムダンク",
        "nameCn": "灌篮高手",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/fa/af/1608_3I59P.jpg",
        "tags": [
          "灌篮高手",
          "热血",
          "教练我想打篮球",
          "经典",
          "slam_dunk",
          "童年",
          "体育",
          "樱木花道",
          "tv",
          "篮球",
          "1993",
          "漫画改"
        ],
        "rating": {
          "score": 8.6,
          "total": 9433
        }
      },
      "predicted": 8.579,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“校园、jump”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 93739,
        "type": 2,
        "name": "ピンポン THE ANIMATION",
        "nameCn": "乒乓",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/1e/63/93739_TZ9dS.jpg",
        "tags": [
          "汤浅政明",
          "乒乓",
          "运动",
          "漫画改",
          "tv",
          "2014年4月",
          "龙之子production",
          "松本大洋",
          "热血",
          "2014",
          "漫改",
          "noitamina"
        ],
        "rating": {
          "score": 8.7,
          "total": 17644
        }
      },
      "predicted": 8.579,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“校园、noitamina”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 518519,
        "type": 2,
        "name": "ONE PIECE FAN LETTER",
        "nameCn": "航海王：粉丝来信",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/be/42/518519_DMDo8.jpg",
        "tags": [
          "海贼王",
          "ova",
          "2024",
          "番外",
          "东映动画",
          "短片",
          "tv",
          "小说改",
          "日本",
          "2024年10月",
          "东映",
          "热血"
        ],
        "rating": {
          "score": 8.6,
          "total": 4304
        }
      },
      "predicted": 8.56,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“奇幻、催泪”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 1891,
        "type": 2,
        "name": "少女革命ウテナ アドゥレセンス黙示録",
        "nameCn": "少女革命 思春期默示录",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/13/16/1891_qDgl0.jpg",
        "tags": [
          "剧场版",
          "j.c.staff",
          "几原邦彦",
          "百合",
          "1999",
          "原创",
          "少女革命",
          "幾原邦彦",
          "榎戸洋司",
          "少女革命ウテナ",
          "神作",
          "光宗信吉"
        ],
        "rating": {
          "score": 8.2,
          "total": 3137
        }
      },
      "predicted": 8.552,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“百合、校园”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 1333,
        "type": 2,
        "name": "劇場版 空の境界 第五章 矛盾螺旋",
        "nameCn": "剧场版 空之境界 第五章 矛盾螺旋",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/ff/49/1333_0Dn08.jpg",
        "tags": [
          "空之境界",
          "type-moon",
          "剧场版",
          "ufotable",
          "两仪式",
          "奈须きのこ",
          "矛盾螺旋",
          "2008",
          "空の境界",
          "坂本真绫",
          "奇幻",
          "战斗"
        ],
        "rating": {
          "score": 8.4,
          "total": 12526
        }
      },
      "predicted": 8.55,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“奇幻、梶浦由记”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 296659,
        "type": 2,
        "name": "ラブライブ！虹ヶ咲学園スクールアイドル同好会",
        "nameCn": "Love Live! 虹咲学园校园偶像同好会",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/a7/35/296659_o709D.jpg",
        "tags": [
          "偶像",
          "百合",
          "sunrise",
          "原创",
          "lovelive",
          "2020年10月",
          "tv",
          "音乐",
          "校园",
          "2020",
          "扭曲",
          "河村智之"
        ],
        "rating": {
          "score": 7.5,
          "total": 6082
        }
      },
      "predicted": 8.545,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“扭曲、sunrise”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 623179,
        "type": 2,
        "name": "「ray 超かぐや姫！Version」MV",
        "nameCn": "",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/6f/da/623179_ww0Wi.jpg",
        "tags": [
          "短片",
          "mv",
          "百合",
          "原创",
          "2026",
          "studiocolorido",
          "山下清悟",
          "web",
          "日本",
          "studiochromato",
          "音乐",
          "2026年1月"
        ],
        "rating": {
          "score": 7.8,
          "total": 1143
        }
      },
      "predicted": 8.529,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“百合、科幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 262897,
        "type": 2,
        "name": "ゆるキャン△ SEASON 2",
        "nameCn": "摇曳露营△ 第二季",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/0f/50/262897_d3555.jpg",
        "tags": [
          "芳文社",
          "日常",
          "治愈",
          "2021年1月",
          "漫画改",
          "轻百合",
          "tv",
          "百合",
          "摇曳露营δ",
          "c-station",
          "2021",
          "露营"
        ],
        "rating": {
          "score": 8.3,
          "total": 12570
        }
      },
      "predicted": 8.523,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“百合、校园”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 146457,
        "type": 2,
        "name": "Rick and Morty Season 3",
        "nameCn": "瑞克和莫蒂 第三季",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/c0/a7/146457_G7nNG.jpg",
        "tags": [
          "科幻",
          "欧美",
          "脑洞",
          "搞笑",
          "美国",
          "tv",
          "原创",
          "2017",
          "2017年4月",
          "rick",
          "morty",
          "猎奇"
        ],
        "rating": {
          "score": 8.5,
          "total": 5416
        }
      },
      "predicted": 8.502,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“科幻、奇幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 3324,
        "type": 2,
        "name": "マインド・ゲーム",
        "nameCn": "心灵游戏",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/3c/e6/3324_y2yg1.jpg",
        "tags": [
          "汤浅政明",
          "剧场版",
          "studio4℃",
          "2004",
          "原创",
          "湯浅政明",
          "想像力",
          "人生",
          "渡辺信一郎",
          "菅野洋子",
          "渡边信一郎",
          "漫画改"
        ],
        "rating": {
          "score": 8.1,
          "total": 2346
        }
      },
      "predicted": 8.491,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“科幻、奇幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 141530,
        "type": 2,
        "name": "Rick and Morty Season 2",
        "nameCn": "瑞克和莫蒂 第二季",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/63/28/141530_HCCpE.jpg",
        "tags": [
          "科幻",
          "美国",
          "脑洞",
          "欧美",
          "tv",
          "2015",
          "搞笑",
          "原创",
          "猎奇",
          "rick_and_morty",
          "美国动画",
          "adult-swim"
        ],
        "rating": {
          "score": 8.4,
          "total": 5199
        }
      },
      "predicted": 8.468,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“科幻、奇幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 106207,
        "type": 2,
        "name": "蟲師 続章 第2クール",
        "nameCn": "虫师 续章 第2部分",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/9c/c7/106207_z8288.jpg",
        "tags": [
          "治愈",
          "蟲師",
          "tv",
          "2014年10月",
          "漫画改",
          "奇幻",
          "漆原友紀",
          "artland",
          "2014",
          "虫师",
          "増田俊郎",
          "漫改"
        ],
        "rating": {
          "score": 8.6,
          "total": 4413
        }
      },
      "predicted": 8.467,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“奇幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 3172,
        "type": 2,
        "name": "超時空要塞マクロス 愛・おぼえていますか",
        "nameCn": "超时空要塞 可曾记得爱",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/e2/5c/3172_F4mZ6.jpg",
        "tags": [
          "剧场版",
          "超時空要塞",
          "可曾记得爱",
          "河森正治",
          "1984",
          "林明美",
          "macross",
          "原创",
          "科幻",
          "萝卜",
          "美樹本晴彦",
          "经典"
        ],
        "rating": {
          "score": 8,
          "total": 2459
        }
      },
      "predicted": 8.457,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“科幻、恋爱”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 770,
        "type": 2,
        "name": "天元突破グレンラガン",
        "nameCn": "天元突破 红莲螺岩",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/4e/a0/770_EvrMq.jpg",
        "tags": [
          "热血",
          "gainax",
          "今石洋之",
          "燃",
          "天元突破グレンラガン",
          "钻头",
          "原创",
          "tv",
          "萝卜",
          "超级系",
          "2007",
          "神作"
        ],
        "rating": {
          "score": 8.5,
          "total": 16704
        }
      },
      "predicted": 8.455,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“科幻、奇幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 18692,
        "type": 2,
        "name": "ドラえもん",
        "nameCn": "哆啦A梦",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/b4/4f/18692_Gilpl.jpg",
        "tags": [
          "童年",
          "哆啦a梦",
          "经典",
          "藤子・f・不二雄",
          "tv",
          "2005",
          "童年回憶",
          "漫画改",
          "没看完",
          "沒看全",
          "搞笑",
          "我的童年不是喜羊羊實在太好了"
        ],
        "rating": {
          "score": 8.5,
          "total": 6175
        }
      },
      "predicted": 8.448,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“科幻、奇幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 5694,
        "type": 2,
        "name": "プリンセスチュチュ",
        "nameCn": "萩萩公主",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/b0/d6/5694_MdZo5.jpg",
        "tags": [
          "tv",
          "2002",
          "原创",
          "童话",
          "佐藤顺一",
          "halfilmmaker",
          "岡崎律子",
          "芭蕾舞",
          "萩萩公主",
          "少女系",
          "古典音乐",
          "奇幻"
        ],
        "rating": {
          "score": 8,
          "total": 715
        }
      },
      "predicted": 8.446,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“奇幻、原创”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 292,
        "type": 2,
        "name": "DARKER THAN BLACK -黒の契約者-",
        "nameCn": "DARKER THAN BLACK -黑之契约者-",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/17/00/292_86ZrF.jpg",
        "tags": [
          "bones",
          "黑之契约者",
          "骨头社",
          "超能力",
          "原创",
          "tv",
          "2007",
          "菅野洋子",
          "银",
          "黒の契約者",
          "战斗",
          "2007年4月"
        ],
        "rating": {
          "score": 7.9,
          "total": 10024
        }
      },
      "predicted": 8.443,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“科幻、奇幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 4124,
        "type": 2,
        "name": "ハートキャッチプリキュア!",
        "nameCn": "Heart Catch 光之美少女！",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/7d/c3/4124_pPP9r.jpg",
        "tags": [
          "光之美少女",
          "tv",
          "东映",
          "2010",
          "原创",
          "抓心",
          "東映アニメーション",
          "水樹奈々",
          "プリキュア",
          "precure",
          "百合",
          "子供向"
        ],
        "rating": {
          "score": 8.1,
          "total": 1411
        }
      },
      "predicted": 8.442,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“百合、原创”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 3128,
        "type": 2,
        "name": "デジモンアドベンチャー",
        "nameCn": "数码宝贝大冒险",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/df/f8/3128_4QNAH.jpg",
        "tags": [
          "童年",
          "数码暴龙",
          "永远的回忆",
          "tv",
          "1999",
          "热血",
          "butterfly神曲",
          "无限大的梦想",
          "数码宝贝",
          "原创",
          "东映",
          "butterfly"
        ],
        "rating": {
          "score": 8.3,
          "total": 8587
        }
      },
      "predicted": 8.44,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“科幻、奇幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 243429,
        "type": 2,
        "name": "機動戦士ガンダム 閃光のハサウェイ",
        "nameCn": "机动战士高达 闪光的哈萨维",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/c5/46/243429_l49P7.jpg",
        "tags": [
          "剧场版",
          "高达",
          "sunrise",
          "2021",
          "富野由悠季",
          "小说改",
          "闪光的哈萨维",
          "科幻",
          "机战",
          "萝卜",
          "uc",
          "村濑修功"
        ],
        "rating": {
          "score": 7.9,
          "total": 5834
        }
      },
      "predicted": 8.44,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“sunrise、科幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 3423,
        "type": 2,
        "name": "劇場版 空の境界 第七章 殺人考察(後)",
        "nameCn": "剧场版 空之境界 第七章 杀人考察（后）",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/3d/32/3423_ZNaov.jpg",
        "tags": [
          "空之境界",
          "剧场版",
          "type-moon",
          "ufotable",
          "梶浦由記",
          "奈须きのこ",
          "两仪式",
          "2009",
          "空の境界",
          "奇幻",
          "小说改",
          "坂本真绫"
        ],
        "rating": {
          "score": 8,
          "total": 9951
        }
      },
      "predicted": 8.439,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“恋爱、奇幻”相关作品通常比站内评价更偏爱。"
      ]
    },
    {
      "subject": {
        "id": 100501,
        "type": 2,
        "name": "スペース☆ダンディ シーズン2",
        "nameCn": "太空丹迪 第二季",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/8e/30/100501_M7o32.jpg",
        "tags": [
          "bones",
          "渡边信一郎",
          "原创",
          "tv",
          "科幻",
          "2014年7月",
          "2014",
          "菅野洋子",
          "搞笑",
          "space☆dandy",
          "夏目真悟",
          "渡辺信一郎"
        ],
        "rating": {
          "score": 8.2,
          "total": 3821
        }
      },
      "predicted": 8.435,
      "collaborativeLift": 0,
      "reasons": [
        "你的评分显示，对“科幻、原创”相关作品通常比站内评价更偏爱。"
      ]
    }
  ]
};

(function attachBangumiPersonalStatsCore(globalObject) {
  "use strict";

  const STATUS_LABELS = Object.freeze({
    1: "想看",
    2: "看过",
    3: "在看",
    4: "搁置",
    5: "抛弃",
  });

  const ROLE_GROUPS = Object.freeze({
    directors: {
      label: "导演",
      test: (relation) => /(?:导演|監督|总导演|總監督|chief director|director)/i.test(relation),
    },
    series: {
      label: "系列构成",
      test: (relation) => /(?:系列构成|系列構成|シリーズ構成|构成\s*·?\s*脚本|構成\s*·?\s*脚本)/i.test(relation),
    },
    studios: {
      label: "动画制作",
      test: (relation) => /(?:动画制作|動畫製作|アニメーション制作|动画製作|制作公司)/i.test(relation),
    },
    originals: {
      label: "原作 / 原案",
      test: (relation) => /(?:原作|原案|漫画原作|漫畫原作|小说原作|小說原作)/i.test(relation),
    },
    scripts: {
      label: "脚本",
      test: (relation) => /(?:脚本|腳本|剧本|劇本)/i.test(relation),
    },
    music: {
      label: "音乐",
      test: (relation) => /(?:^|[、,/\s])(?:音乐|音楽|配乐|配樂)(?:$|[、,/\s])/i.test(relation),
    },
    characterDesign: {
      label: "角色设计",
      test: (relation) => /(?:人物设定|人物設定|角色设计|角色設計|character design)/i.test(relation),
    },
  });

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function text(value) {
    return String(value || "").trim();
  }

  function subjectOf(row) {
    const subject = row?.subject || row || {};
    return {
      id: number(subject.id || row?.subject_id),
      name: text(subject.name),
      nameCn: text(subject.name_cn || subject.nameCn),
      date: text(subject.date),
      eps: number(subject.eps || subject.total_episodes),
      type: number(subject.type || row?.subject_type),
      image: text(subject.images?.grid || subject.images?.small || subject.image),
    };
  }

  function compactCollection(row) {
    return {
      subject: subjectOf(row),
      subjectId: number(row?.subject_id || row?.subjectId || row?.subject?.id || row?.id),
      status: number(row?.type || row?.status || row?.collectionType),
      rate: number(row?.rate),
      epStatus: number(row?.ep_status || row?.epStatus),
      tags: Array.isArray(row?.tags) ? row.tags.map(text).filter(Boolean) : [],
      updatedAt: text(row?.updated_at || row?.updatedAt),
      private: Boolean(row?.private),
    };
  }

  function compactPersons(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      id: number(row?.id),
      name: text(row?.name),
      relation: text(row?.relation),
      type: number(row?.type),
      eps: text(row?.eps),
    })).filter((row) => row.id && row.name && row.relation);
  }

  function compactCharacters(rows) {
    return (Array.isArray(rows) ? rows : []).map((character) => ({
      id: number(character?.id),
      name: text(character?.name),
      relation: text(character?.relation),
      actors: (Array.isArray(character?.actors) ? character.actors : []).map((actor) => ({
        id: number(actor?.id),
        name: text(actor?.name),
      })).filter((actor) => actor.id && actor.name),
    })).filter((character) => character.id && character.actors.length);
  }

  function average(scores) {
    return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  }

  function createBucket(row) {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      works: new Set(),
      eps: 0,
      ratedScores: [],
      characterCount: 0,
      mainCharacterCount: 0,
    };
  }

  function addWork(bucket, collection, extras = {}) {
    const subjectId = collection.subject.id;
    if (!bucket.works.has(subjectId)) {
      bucket.works.add(subjectId);
      bucket.eps += collection.subject.eps;
      if (collection.rate > 0) bucket.ratedScores.push(collection.rate);
    }
    bucket.characterCount += number(extras.characterCount);
    bucket.mainCharacterCount += number(extras.mainCharacterCount);
  }

  function finalizeBuckets(map) {
    return [...map.values()].map((bucket) => ({
      id: bucket.id,
      name: bucket.name,
      type: bucket.type,
      works: bucket.works.size,
      eps: bucket.eps,
      averageRate: average(bucket.ratedScores),
      ratedWorks: bucket.ratedScores.length,
      characterCount: bucket.characterCount,
      mainCharacterCount: bucket.mainCharacterCount,
    })).sort((a, b) => b.works - a.works || b.averageRate - a.averageRate || b.eps - a.eps || a.name.localeCompare(b.name, "zh-CN"));
  }

  function rankEntries(entries, mode = "works", topShare = 0.1, minimumWorksExclusive = null) {
    const rows = Array.isArray(entries) ? [...entries] : [];
    const byWorks = (a, b) => b.works - a.works || b.averageRate - a.averageRate || b.ratedWorks - a.ratedWorks || b.eps - a.eps || a.name.localeCompare(b.name, "zh-CN");
    if (mode !== "average" || !rows.length) return { rows: rows.sort(byWorks), cutoffWorks: 0, eligibleCount: rows.length };

    const validShare = Math.min(1, Math.max(0.01, number(topShare) || 0.1));
    const workRanked = [...rows].sort(byWorks);
    const cutoffIndex = Math.max(0, Math.ceil(workRanked.length * validShare) - 1);
    const cutoffWorks = Number.isFinite(minimumWorksExclusive) ? minimumWorksExclusive + 1 : (workRanked[cutoffIndex]?.works || 0);
    const eligible = rows.filter((row) => row.works >= cutoffWorks && row.ratedWorks > 0);
    eligible.sort((a, b) => b.averageRate - a.averageRate || b.ratedWorks - a.ratedWorks || b.works - a.works || b.eps - a.eps || a.name.localeCompare(b.name, "zh-CN"));
    return { rows: eligible, cutoffWorks, eligibleCount: eligible.length };
  }

  function aggregate(collectionRows, personEntries = {}, characterEntries = {}) {
    const collections = collectionRows.map(compactCollection).filter((row) => row.subject.id);
    const currentYear = new Date().getFullYear();
    const rated = collections.filter((row) => row.rate > 0);
    const knownEps = collections.filter((row) => row.subject.eps > 0);
    const status = {};
    const ratingDistribution = {};
    const years = {};
    const tags = {};
    for (const row of collections) status[row.status] = (status[row.status] || 0) + 1;
    for (const row of rated) ratingDistribution[row.rate] = (ratingDistribution[row.rate] || 0) + 1;
    for (const row of collections) {
      const year = row.subject.date.match(/^(?:19|20)\d{2}/)?.[0];
      if (year) years[year] = (years[year] || 0) + 1;
      for (const tag of row.tags) {
        const normalized = text(tag);
        if (!normalized) continue;
        const bucket = tags[normalized] || { count: 0, ratedCount: 0, scoreSum: 0 };
        bucket.count += 1;
        if (row.rate > 0) {
          bucket.ratedCount += 1;
          bucket.scoreSum += row.rate;
        }
        tags[normalized] = bucket;
      }
    }

    const groups = {
      ...Object.fromEntries(Object.keys(ROLE_GROUPS).map((key) => [key, new Map()])),
      cast: new Map(),
    };
    let peopleSubjects = 0;
    let castSubjects = 0;

    for (const collection of collections) {
      const subjectId = collection.subject.id;
      const people = personEntries[subjectId];
      if (Array.isArray(people)) {
        peopleSubjects += 1;
        const seen = new Set();
        for (const person of people) {
          const relation = text(person.relation);
          for (const [key, group] of Object.entries(ROLE_GROUPS)) {
            if (!group.test(relation)) continue;
            const uniqueKey = `${key}:${person.id}`;
            if (seen.has(uniqueKey)) continue;
            seen.add(uniqueKey);
            const bucket = groups[key].get(person.id) || createBucket(person);
            addWork(bucket, collection);
            groups[key].set(person.id, bucket);
          }
        }
      }

      const characters = characterEntries[subjectId];
      if (Array.isArray(characters)) {
        castSubjects += 1;
        const actorCharacters = new Map();
        for (const character of characters) {
          const isMain = /(?:主角|主役|主人公|main)/i.test(text(character.relation));
          for (const actor of character.actors || []) {
            const record = actorCharacters.get(actor.id) || { actor, characters: new Set(), main: new Set() };
            record.characters.add(character.id);
            if (isMain) record.main.add(character.id);
            actorCharacters.set(actor.id, record);
          }
        }
        for (const record of actorCharacters.values()) {
          const bucket = groups.cast.get(record.actor.id) || createBucket(record.actor);
          addWork(bucket, collection, {
            characterCount: record.characters.size,
            mainCharacterCount: record.main.size,
          });
          groups.cast.set(record.actor.id, bucket);
        }
      }
    }

    return {
      overview: {
        works: collections.length,
        ratedWorks: rated.length,
        averageRate: average(rated.map((row) => row.rate)),
        knownEpisodes: knownEps.reduce((sum, row) => sum + row.subject.eps, 0),
        knownEpisodeWorks: knownEps.length,
        averageEpisodes: knownEps.length ? knownEps.reduce((sum, row) => sum + row.subject.eps, 0) / knownEps.length : 0,
        watchedEpisodes: collections.reduce((sum, row) => sum + row.epStatus, 0),
        status: Object.entries(status).map(([id, count]) => ({ id: number(id), label: STATUS_LABELS[id] || "未分类", count })).sort((a, b) => a.id - b.id),
      },
      coverage: {
        peopleSubjects,
        castSubjects,
        totalSubjects: collections.length,
      },
      groups: Object.fromEntries(Object.entries(groups).map(([key, map]) => [key, finalizeBuckets(map)])),
      distributions: {
        ratings: Array.from({ length: 10 }, (_, index) => ({ score: index + 1, count: ratingDistribution[index + 1] || 0 })),
        years: Object.entries(years).map(([year, count]) => ({ year: number(year), count })).sort((a, b) => b.year - a.year),
        tags: Object.entries(tags).map(([name, bucket]) => ({
          name,
          count: bucket.count,
          ratedCount: bucket.ratedCount,
          averageRate: bucket.ratedCount ? bucket.scoreSum / bucket.ratedCount : 0,
        })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN")),
      },
    };
  }

  const Core = Object.freeze({
    STATUS_LABELS,
    ROLE_GROUPS,
    compactCollection,
    compactPersons,
    compactCharacters,
    rankEntries,
    aggregate,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  globalObject.BangumiPersonalStatsCore = Core;
})(globalThis);


(function attachStatsViz(global) {
  'use strict';
  // Pure geometry: no libraries, network access, or changes to collection data.
  function yearSeries(rows) {
    const counts = new Map(rows.filter(row => /^\d{4}$/.test(String(row.year))).map(row => [Number(row.year), Math.max(0, Number(row.count) || 0)]));
    if (!counts.size) return [];
    const first = Math.min(...counts.keys()), last = Math.max(...counts.keys());
    return Array.from({ length: last - first + 1 }, (_, index) => ({ year: last - index, count: counts.get(last - index) || 0 }));
  }
  function axis(maximum) {
    const raw = Math.max(1, maximum) / 4;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const step = Math.max(1, Math.ceil([1, 2, 2.5, 5, 10].map(n => n * magnitude).find(n => n >= raw)));
    return { max: step * 4, ticks: Array.from({ length: 5 }, (_, i) => step * i) };
  }
  function fontSize(count, min, max) {
    return max === min ? 30 : 12 + 38 * Math.pow(Math.max(0, Math.min(1, (count - min) / (max - min))), 0.82);
  }
  function scoreFontSize(score, scores) {
    const values = (Array.isArray(scores) ? scores : []).map(Number).filter(Number.isFinite);
    if (values.length < 2) return 26;
    // Average scores occupy a narrow numeric range, so raw min-max mapping
    // makes everything big and indistinguishable. Rank each score among the
    // observed levels, then apply a steep power curve (like the count cloud's
    // power-law shape): only the top few percent of tags become large while
    // the long tail stays small, which keeps differences readable and the
    // cloud compact. Tied scores share a level and thus the same size.
    const rounded = Math.round(Number(score) * 100) / 100;
    const levels = [...new Set(values.map(value => Math.round(value * 100) / 100))].sort((a, b) => a - b);
    if (levels.length < 2) return 26;
    const percentile = Math.max(0, Math.min(1, levels.indexOf(rounded) / (levels.length - 1)));
    return 12 + 38 * Math.pow(percentile, 4);
  }
  function isTemporalTag(value) {
    const tag = String(value || '').trim().replace(/\s+/g, '');
    return /^(?:19|20)\d{2}(?:年)?$/.test(tag)
      || /^(?:19|20)\d{2}(?:年|[-./])(?:0?[1-9]|1[0-2])(?:月)?(?:番|新番)?$/.test(tag)
      || /^(?:19|20)\d{2}年?(?:春|夏|秋|冬)(?:季|番|新番)?$/.test(tag)
      || /^(?:1|4|7|10)月(?:番|新番)$/.test(tag)
      || /^(?:19|20)\d0s$/i.test(tag);
  }
  function featuredTags(rows) {
    return rows.filter(row => Number(row.count) > 10 && !isTemporalTag(row.name)).sort((a,b) => b.count-a.count || a.name.localeCompare(b.name, 'zh-CN'));
  }
  function overlaps(a, b, gap = 2) {
    return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
  }
  // Traditional oval cloud: every qualified tag is placed and none is dropped.
  // The largest words claim the center and the rest follow a compressed spiral,
  // producing the dense horizontal silhouette used by classic projected word
  // clouds instead of filling the whole rectangular canvas.
  function packCloud(items, width) {
    if (!items.length) return { items: [], height: 0 };
    const order = [...items].sort((a, b) => (b.width * b.height) - (a.width * a.height) || a.index - b.index);
    // Very large sets and narrow screens still get more vertical room. Ordinary
    // desktop clouds target a broad ellipse close to the supplied reference.
    const generous = order.length > 250 ? 1.8 : order.length > 120 ? 1.05 : order.length > 80 ? 0.78 : 0.62;
    const aspectCap = width >= 460 ? generous : Math.max(1.12, generous);
    let best = null;
    for (const scale of [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46]) {
      const attempt = placeOrganic(order, width, scale);
      if (!best || attempt.height < best.height) best = attempt;
      if (attempt.height <= width * aspectCap + 1) break;
    }
    return { items: best.items, height: best.height, scale: best.scale, shape: 'oval', omitted: 0 };
  }
  function placeOrganic(order, width, scale) {
    const sized = order.map(item => ({
      ...item,
      width: Math.max(8, Math.ceil(item.width * scale)),
      height: Math.max(6, Math.ceil(item.height * scale)),
      fitScale: scale
    }));
    const totalArea = sized.reduce((sum, item) => sum + (item.width + 2) * (item.height + 2), 0);
    const centerX = width / 2;
    const centerY = Math.max(88, Math.ceil(totalArea / Math.max(1, width - 16) / 0.72) / 2);
    const cells = new Map(), cellSize = 40;
    const keys = (box, padding = 0) => {
      const result = [];
      for (let x = Math.floor((box.x - padding) / cellSize); x <= Math.floor((box.x + box.width + padding) / cellSize); x++)
        for (let y = Math.floor((box.y - padding) / cellSize); y <= Math.floor((box.y + box.height + padding) / cellSize); y++) result.push(x + ':' + y);
      return result;
    };
    const collides = box => keys(box).some(key => (cells.get(key) || []).some(other => overlaps(box, other)));
    const placed = [];
    let fallbackY = 8;
    for (const item of sized) {
      const seed = Math.abs(Number(item.seed) || item.index + 1);
      const phase = (seed % 6283) / 1000;
      const direction = seed % 2 ? 1 : -1;
      const angularStep = 0.31 + (seed % 11) / 100;
      let box;
      // The vertical component is deliberately compressed: the words themselves
      // define an oval outline while remaining ordinary accessible DOM buttons.
      for (let step = 0; step < 6000; step++) {
        const angle = phase + direction * step * angularStep;
        const radius = step * 0.72;
        const x = centerX + Math.cos(angle) * radius - item.width / 2;
        const y = centerY + Math.sin(angle) * radius * 0.52 - item.height / 2;
        if (x < 8 || x + item.width > width - 8 || y < 8) continue;
        const candidate = { ...item, x, y };
        if (!collides(candidate)) { box = candidate; break; }
      }
      if (!box) {
        // Guaranteed lane below the cloud: a qualified word is never dropped.
        box = { ...item, x: Math.max(4, (width - item.width) / 2), y: fallbackY };
      }
      fallbackY = Math.max(fallbackY, box.y + box.height + 3);
      placed.push(box);
      // Registration padding must exceed the collision gap (2): a pair sitting
      // 1.x px apart could otherwise land in adjacent grid cells and slip
      // through the collision check.
      for (const key of keys(box, 3)) {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(box);
      }
    }
    // Re-center vertically so the cloud fills its frame instead of drifting.
    const minY = Math.min(...placed.map(box => box.y));
    if (minY > 8) for (const box of placed) box.y -= minY - 8;
    const height = Math.ceil(Math.max(...placed.map(box => box.y + box.height))) + 8;
    return { items: placed, height, scale };
  }
  const api = { yearSeries, axis, fontSize, scoreFontSize, isTemporalTag, featuredTags, overlaps, packCloud };
  global.BangumiStatsViz = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);


(function bootstrapBangumiPersonalStats() {
  "use strict";

  const Core = globalThis.BangumiPersonalStatsCore;
  const Viz = globalThis.BangumiStatsViz;
  if (!Core || document.getElementById("bgmstats-host")) return;

  const DEFAULT_USER = "wylt";
  const API_BASE = "https://api.bgm.tv";
  const COLLECTION_TTL = 12 * 60 * 60 * 1000;
  const ENTITY_TTL = 90 * 24 * 60 * 60 * 1000;
  const ENTITY_CONCURRENCY = 1;
  const ENTITY_DELAY = 850;
  const ENTITY_TIMEOUT = 8000;
  const ENTITY_RETRY_LIMIT = 3;
  const ENTITY_RETRY_BASE_DELAY = 1200;
  const AUTO_RESUME_BACKOFF = 15 * 60 * 1000;
  const APP_VERSION = "0.11.0";
  const RANK_PAGE_SIZE = 12;
  const TABS = Object.freeze({ overview: "年代", tags: "标签", staff: "创作", cast: "声优" });

  function text(value) { return String(value ?? ""); }
  function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
  function formatNumber(value) { return new Intl.NumberFormat("zh-CN").format(number(value)); }
  function formatRate(value) { return value ? number(value).toFixed(2) : "—"; }
  function escapeHtml(value) { return text(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

  const ICONS = Object.freeze({
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/></svg>',
    launchArrow: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.75 5.25 5.25-5.25 5.25"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0 2 5.4M20 4v7h-7"/></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-4A4.5 4.5 0 0 0 3 18.5V20m12-6a4 4 0 1 0 0-8m3 8a4.5 4.5 0 0 1 3 4.24V20M9.5 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>',
    database: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.66 3.58 3 8 3s8-1.34 8-3V5m-16 7v7c0 1.66 3.58 3 8 3s8-1.34 8-3v-7"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    chevron: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg>',
  });

  class Store {
    constructor() { this.databasePromise = null; }
    open() {
      if (this.databasePromise) return this.databasePromise;
      this.databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open("bgmpr-stats", 1);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("kv")) request.result.createObjectStore("kv"); };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return this.databasePromise;
    }
    async get(key) {
      const database = await this.open();
      return new Promise((resolve, reject) => {
        const request = database.transaction("kv", "readonly").objectStore("kv").get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    async set(key, value) {
      const database = await this.open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction("kv", "readwrite");
        transaction.objectStore("kv").put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }
  }

  class Client {
    constructor(store, username) { this.store = store; this.username = username; }
    key(part) { return `stats:v1:${this.username}:${part}`; }
    async fetchJson(path, timeoutMilliseconds = 20000) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
      try {
        const response = await fetch(`${API_BASE}${path}`, { signal: controller.signal, credentials: "omit", headers: { Accept: "application/json" } });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          error.status = response.status;
          const retryAfter = Number(response.headers.get("Retry-After"));
          error.retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
          throw error;
        }
        return response.json();
      } finally { clearTimeout(timeout); }
    }
    async collections(force, onProgress) {
      const key = this.key("collections:api");
      const cached = await this.store.get(key);
      if (!force && cached && Date.now() - cached.storedAt < COLLECTION_TTL) return cached.value;
      const rows = [];
      let offset = 0;
      let total = Infinity;
      while (offset < total) {
        const page = await this.fetchJson(`/v0/users/${encodeURIComponent(this.username)}/collections?subject_type=2&limit=100&offset=${offset}`);
        const data = Array.isArray(page.data) ? page.data : [];
        total = number(page.total);
        rows.push(...data);
        offset += data.length;
        onProgress?.("正在同步动画收藏…", Math.min(offset, total), total);
        if (!data.length) break;
      }
      const value = rows.map(Core.compactCollection);
      await this.store.set(key, { storedAt: Date.now(), value });
      return value;
    }
    async entity(kind, subjectId) {
      const key = this.key(`${kind}:${subjectId}`);
      const cached = await this.store.get(key);
      if (cached && Date.now() - cached.storedAt < ENTITY_TTL) return cached.value;
      const path = kind === "people" ? `/v0/subjects/${subjectId}/persons` : `/v0/subjects/${subjectId}/characters`;
      let raw;
      try {
        raw = await this.fetchJson(path, ENTITY_TIMEOUT);
      } catch (error) {
        if (error?.status !== 404) throw error;
        raw = [];
      }
      const value = kind === "people" ? Core.compactPersons(raw) : Core.compactCharacters(raw);
      await this.store.set(key, { storedAt: Date.now(), value });
      return value;
    }
    async entityMap(kind, ids) {
      const result = {};
      await Promise.all(ids.map(async (id) => {
        const cached = await this.store.get(this.key(`${kind}:${id}`));
        if (cached && Date.now() - cached.storedAt < ENTITY_TTL && Array.isArray(cached.value)) result[id] = cached.value;
      }));
      return result;
    }
    async enrichmentState() {
      const cached = await this.store.get(this.key("enrichment:state"));
      return cached?.value || { enabled: false, nextAt: 0 };
    }
    async setEnrichmentState(value) {
      await this.store.set(this.key("enrichment:state"), { storedAt: Date.now(), value });
    }
  }

  class StatsDrawer {
    constructor() {
      this.store = new Store();
      this.client = new Client(this.store, DEFAULT_USER);
      this.state = {
        open: false,
        busy: false,
        syncing: false,
        jobs: { people: false, cast: false },
        cancel: false,
        activeTab: "overview",
        activeStaffGroup: "directors",
        tagMetric: "count",
        search: { staff: "", cast: "" },
        pages: { staff: 1, cast: 1 },
        sort: { staff: "works", cast: "works" },
        collections: [],
        people: {},
        cast: {},
        entityProgress: {
          people: { cached: 0, total: 0, failed: 0, status: "idle" },
          cast: { cached: 0, total: 0, failed: 0, status: "idle" },
        },
        progress: { label: "等待同步", current: 0, total: 0, countText: "" },
        lastSync: 0,
      };
      this.lastFocused = null;
    }
    mount() {
      this.host = globalThis.BangumiProfileUI?.mount("bgmstats-host", 10);
      if (!this.host) return;
      this.shadow = this.host.attachShadow({ mode: "open" });
      this.render();
      this.shadow.addEventListener("click", (event) => this.onClick(event));
      this.shadow.addEventListener("keydown", (event) => this.onKeyDown(event));
      this.shadow.addEventListener("input", (event) => this.onInput(event));
      const inspect = (event) => {
        const label = event.target.closest('[data-viz-label]')?.dataset.vizLabel;
        const caption = this.$('.viz-caption');
        if (label && caption) caption.textContent = label;
      };
      this.shadow.addEventListener('pointerover', inspect);
      this.shadow.addEventListener('focusin', inspect);
      this.shadow.addEventListener('click', inspect);
      this.shadow.addEventListener('pointerleave', () => {
        const caption = this.$('.viz-caption');
        if (caption && !this.shadow.activeElement?.matches('[data-viz-label]')) caption.textContent = caption.dataset.default;
      });
      this.cloudObserver = new ResizeObserver(() => this.scheduleCloud());
      this.cloudObserver.observe(this.host);
      document.fonts?.ready.then(() => { const cloud = this.$('.tag-cloud'); if (cloud) delete cloud.dataset.width; this.scheduleCloud(); });
      const updateTheme = () => { this.host.dataset.theme = this.detectTheme(); };
      updateTheme();
      new MutationObserver(updateTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
      matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", updateTheme);
      globalThis.BangumiProfileUI.lazy(this.host, () => this.open());
    }
    detectTheme() { return globalThis.BangumiProfileUI.theme(); }
    $(selector) { return this.shadow.querySelector(selector); }
    stats() {
      // Aggregate is expensive (full collection × people × cast). Memoize on
      // data shape so re-renders (search typing, tab switches) do not
      // recompute it; enrichment growth invalidates the cache naturally.
      const { collections, people, cast } = this.state;
      const signature = `${collections.length}:${Object.keys(people).length}:${Object.keys(cast).length}`;
      if (this.statsSignature !== signature) {
        this.statsCache = Core.aggregate(collections, people, cast);
        this.statsSignature = signature;
      }
      return this.statsCache;
    }
    isBusy() {
      this.state.busy = this.state.syncing || Object.values(this.state.jobs).some(Boolean);
      return this.state.busy;
    }
    initializeEntityProgress() {
      const total = this.state.collections.length;
      this.state.entityProgress.people = { cached: Object.keys(this.state.people).length, total, failed: 0, status: "idle" };
      this.state.entityProgress.cast = { cached: Object.keys(this.state.cast).length, total, failed: 0, status: "idle" };
    }
    refreshEntityProgress(prefix = "关联资料") {
      const people = this.state.entityProgress.people;
      const cast = this.state.entityProgress.cast;
      const current = people.cached + cast.cached;
      const total = people.total + cast.total;
      const percent = total ? Math.round(current / total * 100) : 0;
      const failed = people.failed + cast.failed;
      const failedText = failed ? ` · ${formatNumber(failed)} 条暂不可用` : "";
      this.progress(`${prefix}：创作人员 ${formatNumber(people.cached)} / ${formatNumber(people.total)} · 声优 ${formatNumber(cast.cached)} / ${formatNumber(cast.total)}${failedText}`, current, total, total ? `${percent}%` : "");
    }
    async open() {
      this.state.open = true;
      if (!this.state.collections.length && !this.isBusy()) await this.sync(false);
    }
    close() {}
    progress(label, current = 0, total = 0, countText = null) {
      this.state.progress = { label, current, total, countText };
      const labelNode = this.$('[data-role="progress-label"]');
      if (!labelNode) { this.render(); return; }
      labelNode.textContent = label;
      const count = this.$('[data-role="progress-count"]');
      const bar = this.$('[data-role="progress-bar"]');
      if (count) count.textContent = countText ?? (total ? `${formatNumber(current)} / ${formatNumber(total)}` : "");
      if (bar) bar.style.width = `${total ? Math.min(100, Math.round(current / total * 100)) : 0}%`;
    }
    async sync(force) {
      if (this.isBusy()) return;
      this.state.syncing = true;
      this.state.cancel = false;
      this.render();
      this.progress("正在同步动画收藏…", 0, 1);
      let shouldResume = false;
      try {
        const allCollections = await this.client.collections(force, (label, current, total) => this.progress(label, current, total));
        this.state.collections = allCollections.filter((row) => row.status === 2);
        const ids = this.state.collections.map((row) => row.subjectId);
        [this.state.people, this.state.cast] = await Promise.all([this.client.entityMap("people", ids), this.client.entityMap("cast", ids)]);
        this.initializeEntityProgress();
        this.state.lastSync = Date.now();
        const enrichmentState = await this.client.enrichmentState();
        shouldResume = Boolean(enrichmentState.enabled && Date.now() >= number(enrichmentState.nextAt));
        this.refreshEntityProgress("已同步收藏");
      } catch (error) { this.progress(`同步失败：${error.message || "网络异常"}`, 0, 0); }
      finally { this.state.syncing = false; this.render(); }
      if (shouldResume && !this.state.cancel) this.enrichAll(false);
    }
    async enrichAll(userInitiated = true) {
      if (!this.state.collections.length || this.state.syncing) return;
      if (userInitiated) await this.client.setEnrichmentState({ enabled: true, nextAt: Date.now() });
      await Promise.all([this.enrich("people"), this.enrich("cast")]);
      const people = this.state.entityProgress.people;
      const cast = this.state.entityProgress.cast;
      const complete = people.cached >= people.total && cast.cached >= cast.total;
      const paused = this.state.cancel;
      await this.client.setEnrichmentState({
        enabled: !complete && !paused,
        nextAt: complete || paused ? 0 : Date.now() + AUTO_RESUME_BACKOFF,
        peopleRemaining: Math.max(0, people.total - people.cached),
        castRemaining: Math.max(0, cast.total - cast.cached),
      });
      this.refreshEntityProgress(complete ? "关联资料已完整缓存" : (paused ? "已暂停" : "本轮补全结束"));
      this.render();
    }
    async enrich(kind) {
      if (this.state.syncing || this.state.jobs[kind] || !this.state.collections.length) return;
      const target = kind === "people" ? this.state.people : this.state.cast;
      const ids = this.state.collections.map((row) => row.subjectId);
      const missing = ids.filter((id) => !Object.hasOwn(target, id));
      if (!missing.length) {
        this.state.entityProgress[kind] = { cached: ids.length, total: ids.length, failed: 0, status: "complete" };
        this.refreshEntityProgress();
        return;
      }
      this.state.jobs[kind] = true;
      this.state.cancel = false;
      this.render();
      let cachedCount = ids.length - missing.length;
      let failedCount = 0;
      const queue = [...missing];
      const attempts = new Map();
      this.state.entityProgress[kind] = { cached: cachedCount, total: ids.length, failed: 0, status: "running" };
      this.refreshEntityProgress("补全中");
      const isRetryable = (error) => !error?.status || error.status === 408 || error.status === 429 || error.status >= 500;
      const updateProgress = () => {
        this.state.entityProgress[kind] = { cached: cachedCount, total: ids.length, failed: failedCount, status: "running" };
        this.refreshEntityProgress("补全中");
      };
      const worker = async () => {
        while (!this.state.cancel && queue.length) {
          const id = queue.shift();
          try {
            target[id] = await this.client.entity(kind, id);
            cachedCount += 1;
          } catch (error) {
            const attempt = (attempts.get(id) || 0) + 1;
            attempts.set(id, attempt);
            if (isRetryable(error) && attempt < ENTITY_RETRY_LIMIT) {
              queue.push(id);
              await sleep(Math.max(number(error?.retryAfterMs), ENTITY_RETRY_BASE_DELAY * attempt));
            } else {
              failedCount += 1;
            }
          }
          updateProgress();
          await sleep(ENTITY_DELAY);
        }
      };
      try {
        await Promise.all(Array.from({ length: ENTITY_CONCURRENCY }, worker));
        this.state.entityProgress[kind] = { cached: cachedCount, total: ids.length, failed: failedCount, status: cachedCount >= ids.length ? "complete" : (this.state.cancel ? "paused" : "pending") };
      } finally {
        this.state.jobs[kind] = false;
        this.refreshEntityProgress(this.state.cancel ? "已暂停" : "补全中");
        this.render();
      }
    }
    async pauseEnrichment() {
      this.state.cancel = true;
      await this.client.setEnrichmentState({ enabled: false, nextAt: 0 });
      this.refreshEntityProgress("已暂停");
    }
    onClick(event) {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;
      if (action === "open") this.open();
      if (action === "close") this.close();
      if (action === "sync") this.sync(true);
      if (action === "all") this.enrichAll();
      if (action === "cancel") this.pauseEnrichment();
      if (action === "tab") { this.state.activeTab = event.target.closest("[data-tab]")?.dataset.tab || "overview"; this.render(); }
      if (action === "tag-metric") {
        const metric = event.target.closest("[data-metric]")?.dataset.metric;
        if (["count", "average"].includes(metric)) { this.state.tagMetric = metric; this.render(); }
      }
      if (action === "staff-group") { this.state.activeStaffGroup = event.target.closest("[data-group]")?.dataset.group || "directors"; this.state.search.staff = ""; this.state.pages.staff = 1; this.render(); }
      if (action === "sort") {
        const button = event.target.closest("[data-sort-kind]");
        const kind = button?.dataset.sortKind;
        const mode = button?.dataset.sort;
        if (kind && Object.hasOwn(this.state.sort, kind) && ["works", "average"].includes(mode)) {
          this.state.sort[kind] = mode;
          this.state.pages[kind] = 1;
          this.render();
        }
      }
      if (action === "page") {
        const button = event.target.closest("[data-page-kind]");
        const kind = button?.dataset.pageKind;
        if (kind) this.state.pages[kind] = Math.max(1, number(button.dataset.page));
        this.render();
        const content = this.$(".content");
        if (content) content.scrollTop = 0;
      }
    }
    onInput(event) {
      const input = event.target.closest("[data-search]");
      if (!input || event.isComposing) return;
      const kind = input.dataset.search;
      if (!Object.hasOwn(this.state.search, kind)) return;
      this.state.search[kind] = input.value;
      this.state.pages[kind] = 1;
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this.render();
        requestAnimationFrame(() => {
          const next = this.$(`[data-search="${kind}"]`);
          next?.focus();
          next?.setSelectionRange?.(next.value.length, next.value.length);
        });
      }, 120);
    }
    onKeyDown(event) {
      if (!event.target.matches('.year-column') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const columns = Array.from(this.shadow.querySelectorAll('.year-column'));
      const index = columns.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? columns.length - 1 : Math.max(0, Math.min(columns.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
      event.preventDefault(); columns[next]?.focus();
    }
    filterRows(rows, query) {
      const normalized = text(query).trim().toLocaleLowerCase();
      if (!normalized) return rows;
      return rows.filter((row) => text(row.name).toLocaleLowerCase().includes(normalized));
    }
    sortControls(kind) {
      const active = this.state.sort[kind];
      const eligibility = kind === 'staff' && this.state.activeStaffGroup === 'studios' ? '仅作品数大于 10 部者入榜' : '仅作品数位于前 10% 者入榜';
      return `<div class="sort-row"><span>排序</span><div class="sort-switch" role="group" aria-label="排名排序方式"><button type="button" data-action="sort" data-sort-kind="${kind}" data-sort="works" aria-pressed="${active === "works"}">作品数</button><button type="button" data-action="sort" data-sort-kind="${kind}" data-sort="average" aria-pressed="${active === "average"}">均分</button></div>${active === "average" ? `<small>${eligibility}</small>` : ""}</div>`;
    }
    pager(kind, page, pages) {
      if (pages <= 1) return "";
      return `<div class="pager" aria-label="分页"><button type="button" data-action="page" data-page-kind="${kind}" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button><span>${page} / ${pages}</span><button type="button" data-action="page" data-page-kind="${kind}" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>下一页</button></div>`;
    }
    listRows(rows, kind, pageKind) {
      if (!rows.length) return '<p class="empty">暂无匹配的人物。资料尚未齐全时，可在“更新”中补全。</p>';
      const pages = Math.max(1, Math.ceil(rows.length / RANK_PAGE_SIZE));
      const page = Math.min(pages, Math.max(1, this.state.pages[pageKind] || 1));
      this.state.pages[pageKind] = page;
      const offset = (page - 1) * RANK_PAGE_SIZE;
      const shown = rows.slice(offset, offset + RANK_PAGE_SIZE);
      const byScore = this.state.sort[pageKind] === 'average';
      const max = byScore ? 10 : Math.max(1, ...this.stats().groups[pageKind === 'cast' ? 'cast' : this.state.activeStaffGroup].map(row => row.works));
      return `<div class="rank-axis" aria-hidden="true"><span>${byScore ? '个人均分' : '看过的作品'} · 0—${max}${byScore ? ' 分' : ' 部'}</span></div><ol class="people-list" start="${offset + 1}">${shown.map((row, index) => {
        const detail = `${formatNumber(row.works)} 部 · 均分 ${formatRate(row.averageRate)}`;
        const share = Math.max(0, Math.min(100, (byScore ? row.averageRate : row.works) / max * 100));
        return `<li><span class="rank">${offset + index + 1}</span><div><div class="person-heading"><a href="/person/${row.id}" target="_blank" rel="noopener">${escapeHtml(row.name)}</a><span class="person-meta">${byScore ? formatRate(row.averageRate) : `${formatNumber(row.works)} 部`}</span></div><span class="sr-only">${detail}</span><span class="person-track" title="${detail}" aria-hidden="true"><i class="person-bar" style="--share:${share}%"></i></span></div></li>`;
      }).join("")}</ol>${this.pager(pageKind, page, pages)}`;
    }
    overview(stats) {
      if (!stats.overview.works) return `<p class="empty">${!this.state.lastSync ? (/失败|异常/.test(this.state.progress.label) ? '可通过“更新”重试。' : '正在读取动画收藏…') : '还没有可回顾的动画。'}</p>`;
      if (this.state.activeTab === 'tags') return this.tags(stats.distributions.tags);
      return this.years(stats.distributions.years);
    }
    years(rows) {
      const series = Viz.yearSeries(rows);
      if (!series.length) return '<p class="empty">暂无年代资料。</p>';
      const axis = Viz.axis(Math.max(...series.map(row => row.count)));
      const first = series[0].year, last = series.at(-1).year;
      const caption = `首播年份 · ${first}—${last}`;
      return `<section class="year-chart" aria-label="看过动画的全部首播年份分布">
        <div class="viz-heading"><span class="viz-caption" data-default="${caption}" aria-live="polite">${caption}</span></div>
        <div class="year-plot"><div class="year-grid" aria-hidden="true">${axis.ticks.map(tick => `<span style="bottom:${tick / axis.max * 100}%"><b>${tick}</b></span>`).join('')}</div>
        <div class="year-columns" style="--columns:${series.length}">${series.map(row => {
          const label = `${row.year} 年 · ${row.count} 部`;
          const boundary = row.year === first || row.year === last;
          const five = boundary || (row.year % 5 === 0 && first - row.year >= 3 && row.year - last >= 3);
          const ten = boundary || (row.year % 10 === 0 && first - row.year >= 5 && row.year - last >= 5);
          return `<button class="year-column" aria-label="${label}" title="${label}" data-viz-label="${label}" data-label-five="${five}" data-label-ten="${ten}" style="--height:${row.count / axis.max * 100}%"><span class="column-fill"><span class="column-value">${row.count || ''}</span></span><span class="column-year">${row.year}</span></button>`;
        }).join('')}</div></div></section>`;
    }
    tags(rows) {
      rows = Viz.featuredTags(rows);
      if (!rows.length) return '<p class="empty">还没有数量大于 10 部的标签。</p>';
      const metric = this.state.tagMetric === 'average' ? 'average' : 'count';
      const ranked = [...rows]
        .filter(row => metric === 'count' || row.ratedCount > 0)
        .sort((a, b) => metric === 'average'
          ? b.averageRate - a.averageRate || b.ratedCount - a.ratedCount || b.count - a.count || a.name.localeCompare(b.name, 'zh-CN')
          : b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
      const values = ranked.map(row => metric === 'average' ? row.averageRate : row.count);
      const min = Math.min(...values), max = Math.max(...values);
      const caption = metric === 'average' ? '标签作品个人均分' : '标签出现次数';
      const controls = `<div class="cloud-metric" role="group" aria-label="词云数值"><button type="button" data-action="tag-metric" data-metric="count" aria-pressed="${metric === 'count'}">出现次数</button><button type="button" data-action="tag-metric" data-metric="average" aria-pressed="${metric === 'average'}">个人均分</button></div>`;
      return `<section aria-label="数量大于10部的个人标签词云"><div class="viz-heading"><span class="viz-caption" data-default="${caption}" aria-live="polite">${caption}</span>${controls}</div><div class="tag-cloud">${ranked.map((row, index) => {
        const value = metric === 'average' ? row.averageRate : row.count;
        const ratio = max === min ? 0.5 : (value - min) / (max - min);
        const tone = ratio >= 0.72 ? 'hero' : ratio >= 0.42 ? 'strong' : ratio >= 0.18 ? 'medium' : 'quiet';
        const size = metric === 'average' ? Viz.scoreFontSize(value, values) : Viz.fontSize(value, min, max);
        const seed = Array.from(String(row.name)).reduce((hash, character) => Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0, 2166136261);
        const angle = 0;
        const color = seed % 8;
        const detail = metric === 'average'
          ? `${row.name} · 个人均分 ${formatRate(row.averageRate)} · ${row.ratedCount}/${row.count} 部已评分`
          : `${row.name} · ${row.count} 部`;
        return `<button class="cloud-word" data-tone="${tone}" data-color="${color}" data-count="${row.count}" data-value="${value}" data-viz-label="${escapeHtml(detail)}" title="${escapeHtml(detail)}" aria-label="${escapeHtml(detail)}" data-size="${size}" data-angle="${angle}" data-seed="${seed}" style="font-size:${size}px"><span class="cloud-label">${escapeHtml(row.name)}</span></button>`;
      }).join('')}</div></section>`;
    }
    scheduleCloud() {
      cancelAnimationFrame(this.cloudFrame);
      this.cloudFrame = requestAnimationFrame(() => this.layoutCloud());
    }
    layoutCloud() {
      const cloud = this.$('.tag-cloud');
      if (!cloud) return;
      const width = cloud.clientWidth;
      if (width < 40 || cloud.dataset.width === String(width)) return;
      const words = Array.from(cloud.querySelectorAll('.cloud-word'));
      // Measure real browser text, including CJK/fallback fonts and browser text scaling.
      words.forEach(word => {
        word.hidden = false;
        word.style.width = 'auto';
        word.style.height = 'auto';
        word.style.maxWidth = 'none';
        word.style.removeProperty('--fit-scale');
        const scale = Math.min(1, Math.pow(width / 680, width < 460 ? 0.58 : 0.35));
        word.style.fontSize = Math.max(12, Number(word.dataset.size) * scale) + 'px';
      });
      words.forEach(word => {
        const naturalWidth = word.querySelector('.cloud-label').offsetWidth;
        if (naturalWidth > width - 32) word.style.fontSize = Math.max(12, parseFloat(word.style.fontSize) * (width - 32) / naturalWidth) + 'px';
        word.style.maxWidth = (width - 20) + 'px';
      });
      const boxes = words.map((word, index) => {
        const label = word.querySelector('.cloud-label');
        const angle = Math.abs(Number(word.dataset.angle) || 0) * Math.PI / 180;
        let naturalWidth = label.offsetWidth;
        let naturalHeight = label.offsetHeight;
        let rotatedWidth = Math.abs(Math.cos(angle)) * naturalWidth + Math.abs(Math.sin(angle)) * naturalHeight;
        if (rotatedWidth > width - 28) {
          word.style.fontSize = Math.max(12, parseFloat(word.style.fontSize) * (width - 28) / rotatedWidth) + 'px';
          naturalWidth = label.offsetWidth;
          naturalHeight = label.offsetHeight;
          rotatedWidth = Math.abs(Math.cos(angle)) * naturalWidth + Math.abs(Math.sin(angle)) * naturalHeight;
        }
        const rotatedHeight = Math.abs(Math.sin(angle)) * naturalWidth + Math.abs(Math.cos(angle)) * naturalHeight;
        return { index, seed: Number(word.dataset.seed), width: Math.ceil(rotatedWidth) + 4, height: Math.ceil(rotatedHeight) + 3 };
      });
      // Every qualified tag is laid out; the packer never drops words.
      const layout = Viz.packCloud(boxes, width);
      const visible = new Set(layout.items.map(box => box.index));
      words.forEach((word, index) => { word.hidden = !visible.has(index); });
      for (const box of layout.items) {
        const word = words[box.index];
        word.style.setProperty('--fit-scale', String(box.fitScale || 1));
        word.style.width = box.width + 'px'; word.style.height = box.height + 'px';
        word.style.left = box.x + 'px'; word.style.top = box.y + 'px';
      }
      cloud.style.height = layout.height + 'px';
      cloud.dataset.shape = layout.shape || 'dense';
      cloud.dataset.visibleCount = String(layout.items.length);
      cloud.dataset.fitScale = String(layout.scale || 1);
      cloud.dataset.width = width;
      cloud.classList.add('is-ready');
    }
    staff(stats) {
      const groups = [{ id: "directors", label: "导演" }, { id: "series", label: "系列构成" }, { id: "studios", label: "动画制作" }, { id: "originals", label: "原作 / 原案" }, { id: "scripts", label: "脚本" }, { id: "music", label: "音乐" }, { id: "characterDesign", label: "角色设计" }];
      const active = groups.find(group => group.id === this.state.activeStaffGroup) || groups[0];
      const ranking = Core.rankEntries(stats.groups[active.id] || [], this.state.sort.staff, 0.1, active.id === 'studios' ? 10 : null);
      const rows = this.filterRows(ranking.rows, this.state.search.staff);
      return `<div class="role-switch" aria-label="创作职位">${groups.map(group => `<button type="button" data-action="staff-group" data-group="${group.id}" aria-pressed="${group.id === active.id}">${group.label}</button>`).join("")}</div>${this.rankingTools("staff", active.label)}${this.listRows(rows, "staff", "staff")}`;
    }
    rankingTools(kind, label) {
      return `<div class="ranking-tools"><label><span class="sr-only">搜索${label}姓名</span><input type="search" data-search="${kind}" value="${escapeHtml(this.state.search[kind])}" placeholder="搜索${label}" autocomplete="off"></label>${this.sortControls(kind)}</div>`;
    }
    cast(stats) {
      const ranking = Core.rankEntries(stats.groups.cast, this.state.sort.cast, 0.1);
      return `${this.rankingTools("cast", "声优")}${this.listRows(this.filterRows(ranking.rows, this.state.search.cast), "cast", "cast")}`;
    }
    content(stats) { if (this.state.activeTab === "staff") return this.staff(stats); if (this.state.activeTab === "cast") return this.cast(stats); return this.overview(stats); }
    render() {
      const active = this.shadow.activeElement;
      const action = active?.getAttribute("data-action");
      const key = active?.getAttribute("data-tab") || active?.getAttribute("data-group") || active?.getAttribute("data-sort") || active?.getAttribute('data-metric') || active?.getAttribute('data-year-page') || active?.getAttribute('data-page-kind');
      const name = active?.getAttribute('aria-label');
      const settingsOpen = this.$(".data-settings")?.open;
      const stats = this.stats();
      this.isBusy();
      const progress = this.state.progress;
      const needsNotice = this.state.busy || /失败|异常/.test(progress.label);
      const tabs = Object.entries(TABS).map(([id, label]) => `<button type="button" aria-pressed="${this.state.activeTab === id}" data-action="tab" data-tab="${id}">${label}</button>`).join("");
      this.shadow.innerHTML = `${this.styles()}<section class="module" aria-labelledby="bgmstats-title"><header class="module-head"><h2 id="bgmstats-title">动画回顾</h2><details class="data-settings" ${settingsOpen ? "open" : ""}><summary>更新</summary><div><button data-action="sync" ${this.state.busy ? "disabled" : ""}>更新收藏</button><button data-action="all" ${this.state.busy || !stats.overview.works ? "disabled" : ""}>补全人物资料</button>${this.state.busy ? '<button data-action="cancel">暂停补全</button>' : ""}</div></details></header><div class="tabs" role="group" aria-label="回顾分类">${tabs}</div><div class="progress" aria-live="polite" ${needsNotice ? "" : "hidden"}><span data-role="progress-label">${escapeHtml(progress.label)}</span><span data-role="progress-count"></span></div><div class="content">${this.content(stats)}</div></section>`;
      if (action && key) this.shadow.querySelectorAll('[data-action]').forEach(el => {
        const nextKey = el.getAttribute('data-tab') || el.getAttribute('data-group') || el.getAttribute('data-sort') || el.getAttribute('data-metric') || el.getAttribute('data-year-page') || el.getAttribute('data-page-kind');
        if (el.getAttribute('data-action') === action && (action === 'year-page' ? el.getAttribute('aria-label') === name : nextKey === key && (!active?.textContent || el.textContent === active.textContent)) && !el.disabled) el.focus({ preventScroll: true });
      });
      this.scheduleCloud();
    }
    styles() { return `<style>${globalThis.BangumiProfileUI.css}
      .content{padding:18px 0 0;min-height:230px}.content header{display:none}
      .data-settings{position:relative;font-size:12px;color:var(--muted)}.data-settings summary{padding:4px 9px;border-radius:6px}.data-settings>div{position:absolute;right:0;top:32px;z-index:2;display:grid;min-width:150px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:6px;box-shadow:0 3px 12px #0000000a}
      .viz-heading{display:flex;justify-content:space-between;align-items:center;min-height:36px;gap:10px;color:var(--muted);font-size:12px;margin-bottom:16px}.viz-caption{overflow-wrap:anywhere}
      .cloud-metric{display:flex;flex-shrink:0;gap:3px;padding:3px;background:var(--soft);border-radius:8px}.cloud-metric button{padding:4px 10px;font-size:12px}.cloud-metric button[aria-pressed="true"]{color:var(--link);background:var(--surface);box-shadow:0 1px 4px #0000000b}
      .year-plot{position:relative;margin:20px 16px 38px 38px;height:210px}.year-grid{position:absolute;inset:0;pointer-events:none}.year-grid>span{position:absolute;left:0;right:0;border-top:1px solid var(--line)}.year-grid b{position:absolute;right:calc(100% + 10px);top:-10px;font-size:11px;font-weight:400;color:var(--muted)}
      .year-columns{position:absolute;inset:0;display:grid;grid-template-columns:repeat(var(--columns),minmax(0,1fr));gap:clamp(1px,.45cqw,5px)}.year-column{position:relative;padding:0;border-radius:3px 3px 0 0;min-width:0;display:flex;align-items:flex-end;justify-content:center}.year-column:hover:not(:disabled){background:var(--soft)}.column-fill{position:relative;display:block;width:100%;max-width:24px;height:var(--height);border-radius:3px 3px 0 0;background:linear-gradient(to top,color-mix(in srgb,var(--pink) 14%,transparent),var(--pink))}.column-value{position:absolute;left:50%;bottom:calc(100% + 3px);transform:translateX(-50%);font-size:11px;color:var(--muted);display:none}.year-column:hover .column-value,.year-column:focus-visible .column-value{display:block}.column-year{display:none;position:absolute;left:50%;top:calc(100% + 10px);transform:translateX(-50%);font-size:10px;color:var(--muted)}.year-column[data-label-five="true"] .column-year{display:block}
      .tag-cloud{--cloud-c0:#313642;--cloud-c1:#8b3f59;--cloud-c2:#836d2f;--cloud-c3:#4f6b61;--cloud-c4:#53677e;--cloud-c5:#765570;--cloud-c6:#805947;--cloud-c7:#5f666f;position:relative;isolation:isolate;min-height:240px;visibility:hidden;overflow:visible;background:radial-gradient(ellipse at center,#fbfbfc 0%,#fdfdfd 58%,transparent 78%)}.tag-cloud.is-ready{visibility:visible}:host([data-theme="dark"]) .tag-cloud{--cloud-c0:#e4e7ed;--cloud-c1:#e5a0b3;--cloud-c2:#d6c180;--cloud-c3:#9bc9b9;--cloud-c4:#a9bfd9;--cloud-c5:#cfacd0;--cloud-c6:#d3aa91;--cloud-c7:#b8bec8;background:radial-gradient(ellipse at center,#27282c 0%,#222328 58%,transparent 78%)}.cloud-word{--word-color:var(--cloud-c0);position:absolute;display:grid;place-items:center;box-sizing:border-box;white-space:nowrap;padding:0;line-height:1;min-height:0!important;font-weight:420;border-radius:5px;color:var(--word-color);overflow:visible;letter-spacing:-.018em;opacity:.76;transition:opacity .2s ease,background .2s ease}.cloud-word[data-color="1"]{--word-color:var(--cloud-c1)}.cloud-word[data-color="2"]{--word-color:var(--cloud-c2)}.cloud-word[data-color="3"]{--word-color:var(--cloud-c3)}.cloud-word[data-color="4"]{--word-color:var(--cloud-c4)}.cloud-word[data-color="5"]{--word-color:var(--cloud-c5)}.cloud-word[data-color="6"]{--word-color:var(--cloud-c6)}.cloud-word[data-color="7"]{--word-color:var(--cloud-c7)}.cloud-label{display:inline-block;padding:1px 2px;transform:scale(var(--fit-scale,1));transform-origin:center;transition:transform .2s ease}.cloud-word[data-tone="hero"]{font-weight:680;opacity:1}.cloud-word[data-tone="strong"]{font-weight:590;opacity:.94}.cloud-word[data-tone="medium"]{font-weight:510;opacity:.86}.cloud-word:hover:not(:disabled),.cloud-word:focus-visible{z-index:2;color:var(--word-color);opacity:1;background:color-mix(in srgb,var(--word-color) 9%,transparent)}.cloud-word:hover:not(:disabled) .cloud-label,.cloud-word:focus-visible .cloud-label{transform:scale(var(--fit-scale,1)) scale(1.045)}
      .role-switch{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:14px}.role-switch button[aria-pressed="true"]{color:var(--link);background:var(--pink-soft)}
      .ranking-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:12px 0 20px}.ranking-tools input{width:160px;font-size:12px}.sort-row{display:flex;gap:8px;align-items:center;font-size:12px}.sort-row>span{display:none}.sort-switch{display:flex;gap:3px}.sort-switch button[aria-pressed="true"]{color:var(--link);background:var(--pink-soft)}.sort-row small{max-width:140px;color:var(--muted)}
      .rank-axis{display:flex;justify-content:space-between;margin:0 0 14px 28px;padding-bottom:5px;border-bottom:1px solid var(--line);color:var(--muted);font-size:11px}.people-list{display:grid;grid-auto-flow:column;grid-template-rows:repeat(6,auto);grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 36px;list-style:none;margin:0;padding:0}.people-list li{display:flex;gap:10px;min-width:0}.rank{font-size:12px;color:var(--muted);width:18px;flex-shrink:0}.people-list li>div{flex:1;min-width:0}.person-heading{display:flex;align-items:baseline;gap:8px;justify-content:space-between}.person-heading a{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.person-meta{font-size:12px;color:var(--muted);white-space:nowrap}.person-track{display:block;height:2px;background:var(--line);margin:10px 5px 4px 0}.person-bar{display:block;position:relative;width:var(--share);height:2px;background:var(--pink)}.person-bar::after{content:"";position:absolute;right:-4px;top:-3px;width:8px;height:8px;border-radius:50%;background:var(--pink);border:1px solid var(--surface)}
      .pager{display:flex;justify-content:center;align-items:center;gap:16px;margin-top:20px;font-size:12px;color:var(--muted)}
      @container(max-width:500px){.people-list{grid-auto-flow:row;grid-template-rows:none;grid-template-columns:1fr;gap:20px}.sort-row{flex-wrap:wrap}.year-plot{height:190px;margin-left:30px}.year-columns{gap:1px}.year-column[data-label-five="true"] .column-year{display:none}.year-column[data-label-ten="true"] .column-year{display:block}}
    </style>`; }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => new StatsDrawer().mount(), { once: true });
  else new StatsDrawer().mount();
})();


(function bootstrapBangumiPersonalRecommender() {
  "use strict";

  const Feed = globalThis.BangumiRecommendationFeed;
  if (!Feed || document.getElementById("bgmpr-host")) return;

  const APP_VERSION = "0.11.0";
  const OWNER = Feed.OWNER;
  const PAGE_SIZE = 5;
  const CACHE_TTL = 6 * 60 * 60 * 1000;
  const FEED_URL = "https://raw.githubusercontent.com/wylt-bupt/bangumi-personal-recommender/main/public/recommendations.json";

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function imageUrl(value) {
    try {
      const url = new URL(value, location.origin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  }

  function cached(key) {
    try { return JSON.parse(localStorage.getItem(`bgmpr:v2:${key}`) || "null"); }
    catch { return null; }
  }

  function cache(key, value) {
    try { localStorage.setItem(`bgmpr:v2:${key}`, JSON.stringify({ storedAt: Date.now(), value })); }
    catch { /* Storage may be unavailable in private mode. */ }
  }

  async function requestJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: "no-cache", credentials: "omit" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } finally { clearTimeout(timer); }
  }

  class RecommenderApp {
    constructor() {
      this.state = {
        open: false, busy: false, pageOrder: [], current: [], currentPage: 1,
        collections: [], feed: null, profile: null, eligibleCandidateCount: 0,
      };
      this.excludedBatch = new Set();
      this.toastTimer = null;
    }

    mount() {
      this.host = globalThis.BangumiProfileUI?.mount("bgmpr-host", 20);
      if (!this.host) return;
      this.host.dataset.theme = globalThis.BangumiProfileUI.theme();
      this.shadow = this.host.attachShadow({ mode: "open" });
      this.shadow.innerHTML = `${this.styles()}<section class="module" aria-labelledby="bgmpr-title">
        <header class="module-head"><h2 id="bgmpr-title">个性推荐 · 动画</h2><button class="refresh-data" type="button" title="同步最新收藏与推荐数据">更新</button></header>
        <div class="progress" role="status" hidden></div>
        <div class="welcome"><p>根据你的评分与公开用户的共同观看轨迹，寻找还未标记的作品。</p><button class="start" type="button">看看推荐</button></div>
        <div class="results" hidden><p class="summary"></p><div class="recommendation-list"></div><nav class="pagination" aria-label="推荐结果分页"></nav></div>
        <div class="error" hidden><p class="error-message"></p><button class="retry" type="button">重试</button></div>
        <div class="toast" role="status" hidden><span></span><button type="button">撤销</button></div>
      </section>`;
      this.bindEvents();
      const updateTheme = () => { this.host.dataset.theme = globalThis.BangumiProfileUI.theme(); };
      new MutationObserver(updateTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
      matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", updateTheme);
      globalThis.BangumiProfileUI.lazy(this.host, () => this.open());
    }

    $(selector) { return this.shadow.querySelector(selector); }

    bindEvents() {
      for (const selector of [".start", ".retry", ".refresh-data"]) {
        this.$(selector).addEventListener("click", () => this.ensureRecommendations({ force: true }));
      }
      this.shadow.addEventListener("click", (event) => {
        const target = event.target.closest?.("[data-dismiss-id], [data-page-direction], .toast button");
        if (!target) return;
        if (target.matches("[data-dismiss-id]")) this.dismiss(Number(target.dataset.dismissId));
        else if (target.matches("[data-page-direction]")) this.changePage(this.state.currentPage + Number(target.dataset.pageDirection));
        else if (target.matches(".toast button")) this.undoDismiss();
      });
      this.shadow.addEventListener("change", (event) => {
        if (event.target.matches?.("[data-page-select]")) this.changePage(Number(event.target.value));
      });
      this.shadow.addEventListener("error", (event) => {
        if (!event.target.matches?.("img[data-cover]")) return;
        event.target.hidden = true;
        event.target.nextElementSibling.hidden = false;
      }, true);
    }

    async open() {
      if (this.state.open) return;
      this.state.open = true;
      await this.ensureRecommendations();
    }

    setBusy(value, message = "") {
      this.state.busy = value;
      for (const selector of [".start", ".retry", ".refresh-data"]) this.$(selector).disabled = value;
      this.$(".progress").hidden = !value;
      this.$(".progress").textContent = message;
      this.$(".module").setAttribute("aria-busy", String(value));
    }

    async getFeed(force) {
      const saved = cached("feed");
      if (!force && saved && Date.now() - saved.storedAt < CACHE_TTL) {
        this.feedSource = "cache";
        return Feed.parseFeed(saved.value);
      }
      try {
        const raw = await requestJson(FEED_URL);
        const parsed = Feed.parseFeed(raw);
        cache("feed", raw);
        this.feedSource = "remote";
        return parsed;
      } catch (error) {
        if (saved?.value) {
          this.feedSource = "cache";
          return Feed.parseFeed(saved.value);
        }
        if (globalThis.BangumiInitialRecommendationFeed) {
          this.feedSource = "bundle";
          return Feed.parseFeed(globalThis.BangumiInitialRecommendationFeed);
        }
        throw new Error(`推荐数据读取失败：${error.message}`);
      }
    }

    async getCollections(force) {
      const saved = cached("collections");
      if (!force && saved && Date.now() - saved.storedAt < CACHE_TTL) {
        this.collectionCheckedAt = saved.storedAt;
        return saved.value;
      }
      try {
        const rows = [];
        let total = Infinity;
        for (let offset = 0; offset < total; offset += 50) {
          const page = await requestJson(`https://api.bgm.tv/v0/users/${OWNER}/collections?subject_type=2&limit=50&offset=${offset}`);
          const batch = Array.isArray(page.data) ? page.data : [];
          total = Number(page.total);
          if (!Number.isFinite(total)) throw new Error("收藏分页信息无效");
          rows.push(...batch.map((row) => ({ subject_id: Number(row.subject_id), rate: Number(row.rate) || 0 })));
          this.$(".progress").textContent = `正在核对已标记动画… ${Math.min(rows.length, total)}/${total}`;
          if (!batch.length) break;
          if (offset + batch.length < total) await new Promise((resolve) => setTimeout(resolve, 180));
        }
        if (!rows.length) throw new Error("没有读取到公开收藏");
        cache("collections", rows);
        this.collectionCheckedAt = Date.now();
        return rows;
      } catch (error) {
        if (!force && saved?.value?.length) {
          this.collectionCheckedAt = saved.storedAt;
          return saved.value;
        }
        throw new Error(`收藏读取失败：${error.message}`);
      }
    }

    async ensureRecommendations({ force = false } = {}) {
      if (this.state.busy) return;
      this.setBusy(true, "正在读取推荐数据…");
      this.$(".error").hidden = true;
      try {
        const [feed, collections] = await Promise.all([this.getFeed(force), this.getCollections(force)]);
        this.state.feed = feed;
        this.state.collections = collections;
        this.state.profile = { collectionCount: collections.length, ratedCount: collections.filter((row) => row.rate > 0).length };
        this.state.pageOrder = Feed.unmarkedCandidates(feed, collections);
        this.state.eligibleCandidateCount = this.state.pageOrder.length;
        if (!this.state.pageOrder.length) throw new Error("暂时没有未标记的候选动画。");
        this.excludedBatch.clear();
        this.state.currentPage = 1;
        this.renderFromPool();
      } catch (error) {
        this.$(".results").hidden = true;
        this.$(".welcome").hidden = true;
        this.$(".error").hidden = false;
        this.$(".error-message").textContent = `${error.message}。可稍后重试；组件不会修改你的 Bangumi 数据。`;
      } finally { this.setBusy(false); }
    }

    renderFromPool() {
      const available = this.state.pageOrder.filter((item) => !this.excludedBatch.has(item.subject.id));
      const pages = Math.max(1, Math.ceil(available.length / PAGE_SIZE));
      const page = Math.min(pages, Math.max(1, this.state.currentPage));
      const start = (page - 1) * PAGE_SIZE;
      this.state.currentPage = page;
      this.state.current = available.slice(start, start + PAGE_SIZE);
      this.$(".welcome").hidden = true;
      this.$(".error").hidden = true;
      this.$(".results").hidden = false;
      const feed = this.state.feed;
      const date = feed?.generatedAt ? new Date(feed.generatedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "本地预览";
      const model = feed?.model === "joint" ? "协同评分与内容偏好" : "内容偏好；公开评分用于发现候选";
      const checked = this.collectionCheckedAt
        ? new Date(this.collectionCheckedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : "本地预览";
      const fallback = this.feedSource === "bundle" ? " · 使用内置 50 条快照" : "";
      const neighbor = feed?.neighborCount ? `（${feed.neighborCount} 位近邻召回）` : "";
      this.$(".summary").textContent = `分析 ${feed?.ratedCount || this.state.profile?.ratedCount || 0} 条个人评分、${feed?.peerCount || 0} 位公开用户${neighbor} · ${model} · 数据 ${date} · 收藏核对 ${checked}${fallback}`;
      this.$(".recommendation-list").innerHTML = this.state.current.map((item) => this.card(item)).join("");
      const options = Array.from({ length: pages }, (_, index) => `<option value="${index + 1}" ${index + 1 === page ? "selected" : ""}>${index + 1}</option>`).join("");
      this.$(".pagination").innerHTML = `<button type="button" data-page-direction="-1" ${page === 1 ? "disabled" : ""}>上一页</button><label>第 <select data-page-select aria-label="跳转到推荐页">${options}</select> / ${pages} 页</label><button type="button" data-page-direction="1" ${page === pages ? "disabled" : ""}>下一页</button>`;
    }

    card(item) {
      const subject = item.subject;
      const title = subject.nameCn || subject.name || `条目 ${subject.id}`;
      const image = imageUrl(subject.image);
      const url = `${location.origin}/subject/${subject.id}`;
      const reasons = item.reasons.length ? item.reasons : ["结合你的历史评分与作品口碑排序。"];
      return `<article class="recommendation-card">
        <a class="cover" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="查看《${escapeHtml(title)}》">${image ? `<img data-cover src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy" width="140" height="196"><span class="cover-placeholder" hidden>暂无封面</span>` : '<span class="cover-placeholder">暂无封面</span>'}</a>
        <h3><a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></h3>
        <div class="content-tags">${subject.tags.slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
        <p class="brief">${escapeHtml(reasons[0])}</p>
        <details class="evidence-panel"><summary>推荐依据</summary><div class="evidence-body">${reasons.map((reason) => `<p>${escapeHtml(reason)}</p>`).join("")}<p class="evidence-score">预测评分 ${item.predicted.toFixed(1)} / 10 · 站点评分 ${subject.rating.score ? subject.rating.score.toFixed(1) : "暂无"}</p><button type="button" data-dismiss-id="${subject.id}">暂时隐藏</button></div></details>
      </article>`;
    }

    changePage(value) {
      this.state.currentPage = Number.isFinite(value) ? Math.trunc(value) : 1;
      this.renderFromPool();
    }

    dismiss(id) {
      this.previousDismiss = new Set(this.excludedBatch);
      this.excludedBatch.add(id);
      this.renderFromPool();
      this.$(".toast span").textContent = "已暂时隐藏，可撤销。";
      this.$(".toast").hidden = false;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { this.$(".toast").hidden = true; }, 5000);
    }

    undoDismiss() {
      this.excludedBatch = this.previousDismiss || new Set();
      this.$(".toast").hidden = true;
      this.renderFromPool();
    }

    styles() {
      return `<style>${globalThis.BangumiProfileUI.css}
        .welcome{padding:28px 0;text-align:center;color:var(--muted)}.summary{color:var(--muted);font-size:11px;margin:0 0 15px}
        .recommendation-list{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:18px;align-items:start}
        .recommendation-card{min-width:0}.cover{display:block;aspect-ratio:5/7;background:var(--soft);overflow:hidden;border-radius:7px}.cover img{display:block;width:100%;height:100%;object-fit:cover}.cover-placeholder{display:flex;width:100%;height:100%;align-items:center;justify-content:center;color:var(--muted)}
        .recommendation-card h3{margin-top:9px;font-size:13px;line-height:1.5}.recommendation-card h3 a{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:39px}
        .content-tags{display:flex;flex-wrap:wrap;gap:4px 7px;margin:5px 0;color:var(--link);font-size:11px;min-height:18px}.brief{font-size:12px;line-height:1.6;color:var(--muted);margin:6px 0 8px}
        .evidence-panel{font-size:12px}.evidence-panel summary{color:var(--site-link);width:fit-content;border-radius:4px;list-style:none}.evidence-body{padding-top:8px;line-height:1.75;overflow-wrap:anywhere}.evidence-body p{margin-bottom:8px}.evidence-score{color:var(--muted);font-size:11px}.evidence-body button{padding-left:0}
        .pagination{display:flex;align-items:center;justify-content:center;gap:15px;margin-top:24px;padding-top:12px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}.pagination label{display:flex;align-items:center;gap:5px}.pagination select{padding:3px 4px;font-size:12px}
        .toast{margin-top:12px;padding:8px 12px;background:var(--pink-soft);border-radius:6px;color:var(--link);font-size:12px}.toast button{margin-left:8px;color:var(--link)}
        @container(max-width:620px){.recommendation-list{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}}
        @container(max-width:400px){.recommendation-list{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 14px}.pagination{gap:9px}}
      </style>`;
    }
  }

  function start() {
    const app = new RecommenderApp();
    app.mount();
    globalThis.BangumiPersonalRecommender = app;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();

