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
