// ==UserScript==
// @name         Bangumi 个性推荐
// @namespace    https://bgm.tv/user/wylt
// @version      0.13.0
// @description  个人主页的动画个性推荐：按个人评分学习的排序模型与推荐依据。
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
    .module{min-width:0;background:var(--surface)}.module-head{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:0 0 9px;border-bottom:1px solid var(--line);margin-bottom:16px}.module-head h2{margin-right:auto}.module-head>button{font-size:12px}.update-button{min-height:36px;min-width:44px;padding:6px 10px;font-size:12px;border-radius:6px;touch-action:manipulation}@container(max-width:500px){.update-button{min-height:44px}}
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
  "generatedAt": "2026-10-17T16:26:08.888956+00:00",
  "peerCount": 245,
  "neighborCount": 40,
  "ratedCount": 1345,
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
          "total": 19750
        }
      },
      "predicted": 9.549,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《东京残响》题材重合：科幻、原创。"
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
          "total": 5794
        }
      },
      "predicted": 8.938,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《百合熊风暴》题材重合：百合、校园。"
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
          "total": 2970
        }
      },
      "predicted": 8.935,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《86 -不存在的战区- 第2部分》题材重合：科幻、小说改。"
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
          "total": 1576
        }
      },
      "predicted": 8.92,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《侧耳倾听》题材重合：校园、恋爱。"
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
          "total": 299
        }
      },
      "predicted": 8.905,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 7 分的《机动战士高达 水星的魔女》题材重合：sunrise、科幻。"
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
          "total": 8877
        }
      },
      "predicted": 8.894,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《BanG Dream!》题材重合：百合、日常。"
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
          "total": 9753
        }
      },
      "predicted": 8.893,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《葬送的芙莉莲》题材重合：恋爱、催泪。"
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
          "total": 4527
        }
      },
      "predicted": 8.827,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《3月的狮子 第二季》题材重合：校园、恋爱。"
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
          "total": 3543
        }
      },
      "predicted": 8.823,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《章鱼哔的原罪》题材重合：百合、校园。"
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
          "total": 5838
        }
      },
      "predicted": 8.821,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《3月的狮子 第二季》题材重合：校园、恋爱。"
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
          "total": 9462
        }
      },
      "predicted": 8.756,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 7 分的《青之芦苇》题材重合：校园、漫改。"
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
          "total": 2977
        }
      },
      "predicted": 8.748,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《悠哉日常大王 Nonstop》题材重合：百合、日常。"
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
          "total": 6560
        }
      },
      "predicted": 8.737,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《甘城光辉游乐园》题材重合：恋爱、日常。"
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
          "机战"
        ],
        "rating": {
          "score": 8,
          "total": 2484
        }
      },
      "predicted": 8.729,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《古立特宇宙》题材重合：恋爱、科幻。"
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
          "total": 4284
        }
      },
      "predicted": 8.702,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《超辉夜姬！》题材重合：百合、日常。"
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
          "score": 8.2,
          "total": 408
        }
      },
      "predicted": 8.697,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《麦兜故事》题材重合：日常、原创。"
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
          "total": 1017
        }
      },
      "predicted": 8.697,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《Code Geass 复活的鲁路修》题材重合：sunrise、科幻。"
      ]
    },
    {
      "subject": {
        "id": 2741,
        "type": 2,
        "name": "タッチ",
        "nameCn": "棒球英豪",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/cd/cb/2741_GPGN2.jpg",
        "tags": [
          "安达充",
          "棒球",
          "爱情",
          "touch",
          "青春",
          "校园",
          "经典",
          "tv",
          "上杉达也",
          "1985",
          "童年",
          "体育"
        ],
        "rating": {
          "score": 8.2,
          "total": 1958
        }
      },
      "predicted": 8.696,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 7 分的《青之芦苇》题材重合：校园、恋爱。"
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
          "total": 25298
        }
      },
      "predicted": 8.663,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《灵能百分百 第三季》题材重合：奇幻、漫改。"
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
          "total": 3157
        }
      },
      "predicted": 8.614,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《剧场版 少女☆歌剧 Revue Starlight》题材重合：百合、校园。"
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
          "total": 11513
        }
      },
      "predicted": 8.608,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 6 分的《宿命回响：命运节拍》题材重合：原创、音乐。"
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
          "total": 11948
        }
      },
      "predicted": 8.596,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《葬送的芙莉莲》题材重合：奇幻、公路片。"
      ]
    },
    {
      "subject": {
        "id": 10379,
        "type": 2,
        "name": "装甲騎兵ボトムズ",
        "nameCn": "装甲骑兵VOTOMS",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/c1/ba/10379_y3cGG.jpg",
        "tags": [
          "sunrise",
          "高桥良辅",
          "tv",
          "1983",
          "萝卜",
          "原创",
          "真实系",
          "科幻",
          "装甲骑兵",
          "机战",
          "激励哥",
          "高橋良輔"
        ],
        "rating": {
          "score": 8,
          "total": 646
        }
      },
      "predicted": 8.573,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《Code Geass 复活的鲁路修》题材重合：sunrise、科幻。"
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
          "total": 6090
        }
      },
      "predicted": 8.569,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《CLANNAD 〜AFTER STORY〜》题材重合：校园、恋爱。"
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
          "total": 17837
        }
      },
      "predicted": 8.564,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《街角魔族 2丁目》题材重合：百合、校园。"
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
          "total": 12591
        }
      },
      "predicted": 8.563,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 6 分的《君主·埃尔梅罗二世事件簿 魔眼收集列车 特别篇》题材重合：奇幻、梶浦由记。"
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
          "total": 6118
        }
      },
      "predicted": 8.561,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《夜晚的水母不会游泳》题材重合：扭曲、百合。"
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
          "total": 7264
        }
      },
      "predicted": 8.558,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《红辣椒》题材重合：科幻、原创。"
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
          "total": 8629
        }
      },
      "predicted": 8.553,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《幽灵公主》题材重合：奇幻、原创。"
      ]
    },
    {
      "subject": {
        "id": 93739,
        "type": 2,
        "name": "ピンポン THE ANIMATION",
        "nameCn": "乒乓",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/1e/63/93739_1D6TS.jpg",
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
          "total": 17780
        }
      },
      "predicted": 8.549,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《3月的狮子 第二季》题材重合：校园、漫改。"
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
          "total": 1165
        }
      },
      "predicted": 8.534,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《超辉夜姬！》题材重合：百合、恋爱。"
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
          "total": 12704
        }
      },
      "predicted": 8.526,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《街角魔族 2丁目》题材重合：百合、校园。"
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
          "total": 2374
        }
      },
      "predicted": 8.504,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《风之谷》题材重合：奇幻、科幻。"
      ]
    },
    {
      "subject": {
        "id": 750,
        "type": 2,
        "name": "ARIA The OVA ～ARIETTA～",
        "nameCn": "水星领航员 OVA ～ARIETTA～",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/b1/37/750_21A6l.jpg",
        "tags": [
          "ova",
          "水星领航员",
          "治愈",
          "2007",
          "aria",
          "漫画改",
          "halfilmmaker",
          "治愈系",
          "佐藤顺一",
          "治愈系神作",
          "日常",
          "漫改"
        ],
        "rating": {
          "score": 8.2,
          "total": 1719
        }
      },
      "predicted": 8.491,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 7 分的《末世二轮之旅》题材重合：百合、奇幻。"
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
          "坂本真绫",
          "小说改"
        ],
        "rating": {
          "score": 8,
          "total": 9998
        }
      },
      "predicted": 8.468,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《刀剑神域 序列之争》题材重合：恋爱、奇幻。"
      ]
    },
    {
      "subject": {
        "id": 335579,
        "type": 2,
        "name": "ラブライブ！虹ヶ咲学園スクールアイドル同好会 2期",
        "nameCn": "Love Live! 虹咲学园校园偶像同好会 第二季",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/78/6f/335579_3ldtt.jpg",
        "tags": [
          "偶像",
          "原创",
          "sunrise",
          "百合",
          "lovelive！",
          "2022年4月",
          "tv",
          "音乐",
          "校园",
          "2022",
          "田中仁",
          "lovelive"
        ],
        "rating": {
          "score": 7.4,
          "total": 4462
        }
      },
      "predicted": 8.465,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《夜晚的水母不会游泳》题材重合：扭曲、百合。"
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
          "total": 16799
        }
      },
      "predicted": 8.453,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《DARLING in the FRANXX》题材重合：奇幻、科幻。"
      ]
    },
    {
      "subject": {
        "id": 207168,
        "type": 2,
        "name": "結城友奈は勇者である -鷲尾須美の章- 第3章 やくそく",
        "nameCn": "结城友奈是勇者 -鹫尾须美之章- 第3章 约定",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/d9/2c/207168_jk2kY.jpg",
        "tags": [
          "剧场版",
          "百合",
          "studio五组",
          "原创",
          "结城友奈是勇者",
          "2017",
          "战斗",
          "2017年7月",
          "魔法少女",
          "岸诚二",
          "-鹫尾须美之章-",
          "致郁"
        ],
        "rating": {
          "score": 7.3,
          "total": 1294
        }
      },
      "predicted": 8.448,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 7 分的《某科学的超电磁炮S》题材重合：百合、校园。"
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
          "total": 4370
        }
      },
      "predicted": 8.437,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《来自深渊 漂泊之黄昏》题材重合：奇幻、催泪。"
      ]
    },
    {
      "subject": {
        "id": 1027,
        "type": 2,
        "name": "舞-HiME",
        "nameCn": "舞-HiME",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/88/3e/1027_7reJ8.jpg",
        "tags": [
          "百合",
          "舞-hime",
          "sunrise",
          "梶浦由记",
          "tv",
          "2004",
          "吐便当",
          "校园",
          "中原麻衣",
          "原创",
          "战斗",
          "全员白魔法"
        ],
        "rating": {
          "score": 7.3,
          "total": 1867
        }
      },
      "predicted": 8.437,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《SSSS.古立特》题材重合：百合、校园。"
      ]
    },
    {
      "subject": {
        "id": 767,
        "type": 2,
        "name": "劇場版 空の境界 第三章 痛覚残留",
        "nameCn": "剧场版 空之境界 第三章 痛觉残留",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/f2/20/767_T9VD9.jpg",
        "tags": [
          "空之境界",
          "剧场版",
          "type-moon",
          "ufotable",
          "奈须きのこ",
          "梶浦由记",
          "2008",
          "痛觉残留",
          "两仪式",
          "奇幻",
          "空の境界",
          "坂本真绫"
        ],
        "rating": {
          "score": 7.9,
          "total": 11011
        }
      },
      "predicted": 8.42,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 6 分的《君主·埃尔梅罗二世事件簿 魔眼收集列车 特别篇》题材重合：奇幻、梶浦由记。"
      ]
    },
    {
      "subject": {
        "id": 337,
        "type": 2,
        "name": "フルメタル・パニック! The Second Raid",
        "nameCn": "全金属狂潮 The Second Raid",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/35/7a/337_WzSea.jpg",
        "tags": [
          "全金属狂潮",
          "京阿尼",
          "tv",
          "贺东招二",
          "2005",
          "科幻",
          "萝卜",
          "轻小说改",
          "全金属狂潮3",
          "雪野五月",
          "关智一",
          "武本康弘"
        ],
        "rating": {
          "score": 7.8,
          "total": 4782
        }
      },
      "predicted": 8.418,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 7 分的《境界的彼方 -I'LL BE HERE- 未来篇》题材重合：校园、恋爱。"
      ]
    },
    {
      "subject": {
        "id": 1704,
        "type": 2,
        "name": "HUNTER×HUNTER",
        "nameCn": "猎人",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/a5/88/1704_kwXKE.jpg",
        "tags": [
          "富坚义博",
          "hunter×hunter",
          "热血",
          "万年坑",
          "tv",
          "1999",
          "全职猎人",
          "漫画改",
          "坑",
          "集英社",
          "战斗",
          "神作"
        ],
        "rating": {
          "score": 8.4,
          "total": 5891
        }
      },
      "predicted": 8.416,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 7 分的《JOJO的奇妙冒险》题材重合：奇幻、jump。"
      ]
    },
    {
      "subject": {
        "id": 977,
        "type": 2,
        "name": "あずまんが大王 THE ANIMATION",
        "nameCn": "笑园漫画大王",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/cc/1a/977_5rRBg.jpg",
        "tags": [
          "搞笑",
          "j.c.staff",
          "阿兹漫画大王",
          "校园",
          "tv",
          "日常",
          "治愈",
          "2002",
          "漫画改",
          "大阪",
          "四格",
          "电波"
        ],
        "rating": {
          "score": 7.9,
          "total": 2950
        }
      },
      "predicted": 8.412,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《日常》题材重合：百合、电波。"
      ]
    },
    {
      "subject": {
        "id": 844,
        "type": 2,
        "name": "人狼 JIN-ROH",
        "nameCn": "人狼",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/e9/7e/844_Z2u77.jpg",
        "tags": [
          "押井守",
          "剧场版",
          "production.i.g",
          "1999",
          "冲浦启之",
          "科幻",
          "原创",
          "沖浦啓之",
          "人狼",
          "productioni.g",
          "爱情",
          "小红帽"
        ],
        "rating": {
          "score": 8,
          "total": 3235
        }
      },
      "predicted": 8.408,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 9 分的《攻壳机动队2 无罪》题材重合：科幻、原创。"
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
          "total": 720
        }
      },
      "predicted": 8.406,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 7 分的《冰雪奇缘》题材重合：奇幻、原创。"
      ]
    },
    {
      "subject": {
        "id": 67753,
        "type": 2,
        "name": "あしたのジョー2",
        "nameCn": "明日之丈2",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/e5/34/67753_OYWBt.jpg",
        "tags": [
          "tv",
          "1980",
          "明日之丈",
          "出崎统",
          "漫画改",
          "拳击",
          "运动",
          "tms",
          "漫改",
          "热血",
          "杉野昭夫",
          "体育"
        ],
        "rating": {
          "score": 8.7,
          "total": 934
        }
      },
      "predicted": 8.405,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 7 分的《MEGALO BOX》题材重合：漫改、tms。"
      ]
    },
    {
      "subject": {
        "id": 3130,
        "type": 2,
        "name": "デジモンテイマーズ",
        "nameCn": "数码宝贝驯兽师之王",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/c9/22/3130_cGKH5.jpg",
        "tags": [
          "童年",
          "数码宝贝",
          "tv",
          "2001",
          "东映",
          "馴獸師之王",
          "原创",
          "数码暴龙",
          "催泪弹结局",
          "刷蓝卡",
          "燃！",
          "digimon"
        ],
        "rating": {
          "score": 8,
          "total": 2703
        }
      },
      "predicted": 8.405,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《蜡笔小新：我的超时空新娘》题材重合：奇幻、科幻。"
      ]
    },
    {
      "subject": {
        "id": 1269,
        "type": 2,
        "name": "ARIA The NATURAL",
        "nameCn": "水星领航员 第二季",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/e0/04/1269_8hpU3.jpg",
        "tags": [
          "治愈",
          "水星领航员",
          "tv",
          "aria",
          "2006",
          "治愈系神作",
          "漫画改",
          "halfilmmaker",
          "2006年4月",
          "日常",
          "治愈系",
          "漫改"
        ],
        "rating": {
          "score": 8.3,
          "total": 2859
        }
      },
      "predicted": 8.403,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《悠哉日常大王 Nonstop》题材重合：百合、日常。"
      ]
    },
    {
      "subject": {
        "id": 109869,
        "type": 2,
        "name": "たまゆら～卒業写真～",
        "nameCn": "玉响～毕业写真～",
        "image": "https://lain.bgm.tv/r/400/pic/cover/l/2b/30/109869_w5vOo.jpg",
        "tags": [
          "剧场版",
          "治愈",
          "原创",
          "ova",
          "玉响",
          "2015",
          "佐藤顺一",
          "日常",
          "tyoanimations",
          "百合",
          "完结篇",
          "2015年4月"
        ],
        "rating": {
          "score": 7.9,
          "total": 957
        }
      },
      "predicted": 8.4,
      "collaborativeLift": 0,
      "reasons": [
        "与你评过 8 分的《摇曳百合 夏日时光！》题材重合：百合、校园。"
      ]
    }
  ]
};

(function bootstrapBangumiPersonalRecommender() {
  "use strict";

  const Feed = globalThis.BangumiRecommendationFeed;
  if (!Feed || document.getElementById("bgmpr-host")) return;

  const APP_VERSION = "0.13.0";
  const OWNER = Feed.OWNER;
  const PAGE_SIZE = 5;
  const FEED_TTL = 6 * 60 * 60 * 1000;
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

  function cache(key, value, storedAt = Date.now()) {
    try { localStorage.setItem(`bgmpr:v2:${key}`, JSON.stringify({ storedAt, value })); }
    catch { /* Storage may be unavailable in private mode. */ }
  }

  function savedCollections() {
    const saved = cached("collections");
    if (!Number.isFinite(saved?.storedAt) || !Array.isArray(saved.value) ||
        !saved.value.every(row => Number.isSafeInteger(row?.subject_id) && row.subject_id > 0 && Number.isFinite(row.rate))) return null;
    return saved;
  }

  function localFeed() {
    const saved = cached("feed");
    try {
      if (Number.isFinite(saved?.storedAt)) return { feed: Feed.parseFeed(saved.value), raw: saved.value, source: "cache", storedAt: saved.storedAt };
    } catch { /* Ignore incompatible cached feeds and use the bundled fallback. */ }
    try {
      return { feed: Feed.parseFeed(globalThis.BangumiInitialRecommendationFeed), source: "bundle", storedAt: 0 };
    } catch { return null; }
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
      this.revision = 0;
    }

    mount() {
      this.host = globalThis.BangumiProfileUI?.mount("bgmpr-host", 20);
      if (!this.host) return;
      this.host.dataset.theme = globalThis.BangumiProfileUI.theme();
      this.shadow = this.host.attachShadow({ mode: "open" });
      this.shadow.innerHTML = `${this.styles()}<section class="module" aria-labelledby="bgmpr-title">
        <header class="module-head"><h2 id="bgmpr-title">个性推荐 · 动画</h2><button class="refresh-data update-button" type="button" title="核对个人收藏与最新推荐清单" aria-live="polite">更新</button></header>
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
      const collections = savedCollections();
      const feed = localFeed();
      if (collections && feed) {
        this.state.open = true;
        this.applyData(feed, collections.value, collections.storedAt);
        globalThis.BangumiProfileUI.lazy(this.host, () => this.refreshFeed());
      } else globalThis.BangumiProfileUI.lazy(this.host, () => this.open());
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
      this.$(".refresh-data").textContent = value ? "更新中…" : "更新";
      this.$(".progress").hidden = !value;
      this.$(".progress").textContent = message;
      this.$(".module").setAttribute("aria-busy", String(value));
    }

    async getFeed(force) {
      const saved = localFeed();
      if (!force && saved?.source === "cache" && Date.now() - saved.storedAt < FEED_TTL) return saved;
      try {
        const raw = await requestJson(FEED_URL);
        return { feed: Feed.parseFeed(raw), raw, source: "remote", storedAt: Date.now() };
      } catch (error) {
        if (saved) return { ...saved, error };
        throw new Error(`推荐数据读取失败：${error.message}`);
      }
    }

    applyData(next, collections, checkedAt, reset = true) {
      this.state.feed = next.feed;
      this.feedSource = next.source;
      this.state.collections = collections;
      this.collectionCheckedAt = checkedAt;
      this.state.profile = { collectionCount: collections.length, ratedCount: collections.filter(row => row.rate > 0).length };
      this.state.pageOrder = Feed.unmarkedCandidates(next.feed, collections);
      this.state.eligibleCandidateCount = this.state.pageOrder.length;
      if (reset) {
        this.excludedBatch.clear();
        this.state.currentPage = 1;
      }
      this.renderFromPool();
    }

    notice(message) {
      this.$(".error").hidden = false;
      this.$(".error-message").textContent = message;
    }

    async refreshFeed() {
      const saved = localFeed();
      if (saved?.source === "cache" && Date.now() - saved.storedAt < FEED_TTL) return;
      const revision = this.revision;
      try {
        const next = await this.getFeed(false);
        if (revision !== this.revision) return;
        if (next.error) {
          this.notice("推荐清单更新失败，保留已有结果。可点击更新重试。");
          return;
        }
        if (next.source === "remote") cache("feed", next.raw);
        this.applyData(next, this.state.collections, this.collectionCheckedAt, false);
      } catch { if (revision === this.revision) this.notice("推荐清单更新失败，保留已有结果。可点击更新重试。"); }
    }

    async getCollections(force) {
      const saved = savedCollections();
      if (!force && saved) return saved;
      const rows = [];
      const seen = new Set();
      let total = Infinity;
      for (let offset = 0; offset < total; offset += 50) {
        const page = await requestJson(`https://api.bgm.tv/v0/users/${OWNER}/collections?subject_type=2&limit=50&offset=${offset}`);
        const batch = page.data;
        const count = Number(page.total);
        if (!Array.isArray(batch) || !Number.isSafeInteger(count) || count < 0 ||
            (total !== Infinity && total !== count) || batch.length > 50 ||
            (offset < count && !batch.length) || offset + batch.length > count) throw new Error("收藏分页信息无效或不完整");
        total = count;
        for (const row of batch) {
          const id = Number(row.subject_id);
          if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) throw new Error("收藏分页重复或条目无效");
          seen.add(id);
        }
        rows.push(...batch.map((row) => ({ subject_id: Number(row.subject_id), rate: Number(row.rate) || 0 })));
        this.$(".progress").textContent = `正在核对已标记动画… ${Math.min(rows.length, total)}/${total}`;
        if (!batch.length) break;
        if (offset + batch.length < total) await new Promise((resolve) => setTimeout(resolve, 180));
      }
      if (rows.length !== total) throw new Error("收藏分页不完整");
      return { value: rows, storedAt: Date.now() };
    }

    async ensureRecommendations({ force = false } = {}) {
      if (this.state.busy) return;
      this.revision += 1;
      this.setBusy(true, "正在读取推荐数据…");
      this.$(".error").hidden = true;
      try {
        const [feed, collections] = await Promise.all([this.getFeed(force), this.getCollections(force)]);
        if (force || !savedCollections()) cache("collections", collections.value, collections.storedAt);
        if (feed.source === "remote") cache("feed", feed.raw);
        this.applyData(feed, collections.value, collections.storedAt);
        if (feed.error) this.notice("收藏已核对；推荐清单更新失败，保留已有清单。");
      } catch (error) {
        if (!this.state.feed) this.$(".results").hidden = true;
        this.$(".welcome").hidden = true;
        this.$(".error").hidden = false;
        this.$(".error-message").textContent = `${error.message}。${this.state.feed ? "保留已有结果；" : ""}可稍后重试。`;
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
      if (!available.length) this.$(".summary").textContent += " · 暂无未标记的候选动画";
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
        .recommendation-list{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:18px}
        .recommendation-card{min-width:0;display:flex;flex-direction:column}.cover{display:block;aspect-ratio:5/7;background:var(--soft);overflow:hidden;border-radius:7px}.cover img{display:block;width:100%;height:100%;object-fit:cover}.cover-placeholder{display:flex;width:100%;height:100%;align-items:center;justify-content:center;color:var(--muted)}
        .recommendation-card h3{margin-top:9px;font-size:13px;line-height:1.5}.recommendation-card h3 a{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:39px}
        .content-tags{display:flex;flex-wrap:wrap;gap:4px 7px;margin:5px 0;color:var(--link);font-size:11px;min-height:18px}.brief{font-size:12px;line-height:1.6;color:var(--muted);margin:6px 0 8px;min-height:4.8em}
        .evidence-panel{font-size:12px;margin-top:auto}.evidence-panel summary{color:var(--site-link);width:fit-content;border-radius:4px;list-style:none}.evidence-body{padding-top:8px;line-height:1.75;overflow-wrap:anywhere}.evidence-body p{margin-bottom:8px}.evidence-score{color:var(--muted);font-size:11px}.evidence-body button{padding-left:0}
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

