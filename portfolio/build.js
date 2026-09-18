#!/usr/bin/env node
/* ============================================================================
   build.js — renders index.html from content.js.

   The page ships as plain, crawlable, works-without-JS HTML (unlike a
   client-rendered SPA), but the copy still lives in exactly one place.
   Run it whenever content.js changes:

       node build.js          # or: npm run build
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const title = C.HERO.title.map(w => w.t).join('');

/* ---------------------------------------------------------------- partials */

const nav = C.NAV.map(n =>
  `<a href="#${n.id}" data-spy class="${n.hot ? 'pill' : ''}">${n.label}</a>`).join('\n        ');

const mobileNav = C.NAV.map(n =>
  `<a href="#${n.id}" data-spy class="${n.hot ? 'hot' : ''}">${n.label}</a>`).join('');

const heroWords = C.HERO.title
  .map(w => (w.chaos ? `<button class="chaos-word" data-chaos type="button">${esc(w.t.trim())}</button>` : esc(w.t))
  ).join(' ');
const chaosWord = (C.HERO.title.find(w => w.chaos) || { t: '' }).t.trim();

const project = (p, i) => `
    <section class="scene piece ${p.flip ? 'flip' : ''} reveal" id="${p.id}" data-shape="${p.art}">
      <div class="copy">
        <p class="meta"><span>${String(i + 1).padStart(2, '0')}</span><span>${esc(p.kicker)}</span></p>
        <h2 data-wipe>${esc(p.name)}</h2>
        <p class="sub hand">${esc(p.sub)}</p>
        <p class="desc">${esc(p.desc)}</p>
        <ul class="tags">${p.tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
        ${p.href
          ? `<a class="link" href="${esc(p.href)}" target="_blank" rel="noopener">${esc(p.hrefLabel)} <i aria-hidden="true">↗</i></a>`
          : `<p class="link static">${esc(p.hrefLabel)}</p>`}
        ${p.note ? `<p class="note hand">${esc(p.note)}</p>` : ''}
      </div>
      <div class="stage" data-art="${p.art}"></div>
    </section>`;

const bench = C.BENCH.map(b => `
        <li class="reveal">${b.href
          ? `<a href="${esc(b.href)}" target="_blank" rel="noopener"><b>${esc(b.name)}</b><span>${esc(b.desc)}</span><i aria-hidden="true">↗</i></a>`
          : `<div><b>${esc(b.name)}</b><span>${esc(b.desc)}</span><i aria-hidden="true">✳</i></div>`}</li>`).join('');

const kit = C.ABOUT.kit.map(k => `
          <div><dt>${esc(k.k)}</dt><dd>${esc(k.v)}</dd></div>`).join('');

const journey = C.JOURNEY.map((j, i) => `
        <li class="reveal" style="--d:${i}">
          <p class="when">${esc(j.when)}</p>
          <div>
            <h3>${esc(j.org)}</h3>
            <p class="role">${esc(j.role)}</p>
            <p>${esc(j.body)}</p>
          </div>
        </li>`).join('');

const socials = C.ME.socials.map(s =>
  `<li><a href="${esc(s.href)}" ${s.href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>${esc(s.label)}</a></li>`).join('');

/* ------------------------------------------------------------------ page --- */

const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(C.ME.name)} — ${esc(title)}</title>
<meta name="description" content="${esc(C.ME.role + ' in ' + C.ME.place + '. ' + C.PROJECTS.slice(0, 3).map(p => p.name.replace('.', '')).join(', ') + ' and more.') }">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0a0a0b" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f4f1ea" media="(prefers-color-scheme: light)">
<link rel="canonical" href="https://hire.rest/">
<meta property="og:title" content="${esc(C.ME.name)} — ${esc(title)}">
<meta property="og:description" content="${esc(C.ME.role + ' in ' + C.ME.place)}">
<meta property="og:type" content="website">
<meta property="og:url" content="https://hire.rest/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..800&family=Caveat:wght@600;700&family=Instrument+Sans:ital,wght@0,400..600;1,400..600&family=JetBrains+Mono:wght@400;600&display=swap">
<link rel="stylesheet" href="./styles.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230a0a0b'/%3E%3Cpath d='M16 5v22M5 16h22M8 8l16 16M24 8L8 24' stroke='%23ef5024' stroke-width='2.4' stroke-linecap='round'/%3E%3C/svg%3E">
<script>
document.documentElement.classList.add('js');
try {
  var t = localStorage.getItem('hr5-theme');
  if (t) document.documentElement.dataset.theme = t;
  else if (matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.dataset.theme = 'light';
} catch (e) {}
</script>
</head>
<body>
<a class="skip" href="#work">Skip to work</a>

<div class="bg-wash" aria-hidden="true"></div>
<div class="bg-grid" aria-hidden="true"></div>
<canvas class="field" aria-hidden="true"></canvas>
<div class="grain" id="grain" aria-hidden="true"></div>
<div class="vignette" aria-hidden="true"></div>
<div class="rail" aria-hidden="true"><i></i></div>

<header class="top">
  <a class="sig" href="#home">${esc(C.ME.sig)}<span>.</span></a>
  <nav class="topnav" aria-label="Sections">
        ${nav}
  </nav>
  <div class="actions" data-magnet-host>
    <button class="ico" data-act="lab" title="Grain lab" aria-keyshortcuts="G" aria-label="Open the grain lab">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10" r="1.1" fill="currentColor"/><circle cx="14.5" cy="8.5" r=".9" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><circle cx="10" cy="15.5" r=".8" fill="currentColor"/></svg>
    </button>
    <button class="ico" data-act="theme" title="Theme" aria-keyshortcuts="T" aria-label="Switch theme">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
    </button>
    <button class="ico kbd" data-act="palette" title="Command palette" aria-keyshortcuts="Control+K" aria-label="Open command palette">⌘K</button>
    <a class="pill" data-magnet="90" href="mailto:${esc(C.ME.email)}">Hire me</a>
  </div>
</header>

<main id="main">

  <!-- ░░ hero ░░ -->
  <section class="scene hero" id="home" data-shape="${C.HERO.shape}">
    <div class="copy">
      <p class="meta reveal"><span>${esc(C.HERO.kicker[0])}</span><span>${esc(C.HERO.kicker[1])}</span></p>
      <h1 data-split data-chaos-word="${esc(chaosWord)}">${heroWords}</h1>
      <p class="lede reveal">${C.HERO.lede}</p>
      <div class="ctas reveal">
        ${C.HERO.ctas.map(c => `<a class="btn ${c.kind === 'ghost' ? 'ghost' : ''}" href="${esc(c.href)}">${esc(c.label)} <i aria-hidden="true">${c.ico}</i></a>`).join('\n        ')}
      </div>
    </div>
    <div class="stage" data-art="${C.HERO.shape}">
      <p class="hint hand">${esc(C.HERO.hint)}</p>
    </div>
  </section>

  <div class="ticker" aria-hidden="true"><div class="track" data-ticker>${
    C.TICKER.map(t => `<span>${esc(t)}</span><i>✳</i>`).join('')}</div></div>

  <!-- ░░ work ░░ -->
  <section class="work-head" id="work">
    <div class="wrap">
      <p class="meta reveal"><span>selected work</span><span>${C.PROJECTS.length} built · ${C.BENCH.length} more</span></p>
      <h2 class="huge reveal" data-wipe>Things I<br>actually shipped.</h2>
      <p class="lede reveal">Two of these live in this very repository — <b>Billo</b> and <b>Myna</b> — with their tests. The rest are deployed and clicking.</p>
    </div>
  </section>
${C.PROJECTS.map(project).join('\n')}

  <section class="bench-sec" id="bench">
    <div class="wrap">
      <p class="meta reveal"><span>also on the workbench</span></p>
      <ul class="bench">${bench}
      </ul>
    </div>
  </section>

  <!-- ░░ about ░░ -->
  <section class="scene about" id="about" data-shape="${C.ABOUT.shape}">
    <div class="copy">
      <p class="meta reveal"><span>${esc(C.ABOUT.kicker)}</span></p>
      <h2 class="reveal" data-wipe>${esc(C.ABOUT.title)}</h2>
      <p class="desc reveal">${C.ABOUT.body}</p>
      <dl class="kit reveal">${kit}
      </dl>
      <p class="hand note reveal">${esc(C.ABOUT.hand)}</p>
    </div>
    <div class="stage" data-art="${C.ABOUT.shape}"></div>
  </section>

  <!-- ░░ journey ░░ -->
  <section class="scene journey" id="journey" data-shape="route">
    <div class="copy">
      <p class="meta reveal"><span>a few chapters in</span><span>2020 → now</span></p>
      <h2 class="reveal" data-wipe>The road so far.</h2>
      <ol class="timeline">${journey}
      </ol>
      <p class="edu reveal">${esc(C.EDU)}</p>
    </div>
    <div class="stage" data-art="route"></div>
  </section>

  <!-- ░░ contact ░░ -->
  <section class="scene contact" id="contact" data-shape="${C.CONTACT.shape}" data-magnet-host>
    <div class="glow" aria-hidden="true"></div>
    <div class="copy">
      <p class="meta reveal"><span>${esc(C.CONTACT.kicker)}</span></p>
      <p class="hand reveal">${esc(C.CONTACT.hand)}</p>
      <h2 class="reveal">${esc(C.CONTACT.title[0])}<br><em>${esc(C.CONTACT.title[1])}</em></h2>
      <div class="ctas reveal">
        <a class="btn big magnet" data-magnet="150" href="mailto:${esc(C.ME.email)}">${esc(C.CONTACT.cta)} <span class="ico-round" aria-hidden="true">↗</span></a>
        <button class="btn ghost" data-copy="${esc(C.ME.email)}" type="button">Copy email</button>
      </div>
      <p class="email reveal"><a href="mailto:${esc(C.ME.email)}">${esc(C.ME.email)}</a></p>
      <ul class="socials reveal">${socials}</ul>
    </div>
    <div class="stage" data-art="${C.CONTACT.shape}"></div>
  </section>
</main>

<footer class="foot">
  <div class="wrap foot-in">
    <p>© <span data-year>2026</span> ${esc(C.ME.name)} · ${esc(C.ME.place)}</p>
    <p class="mono">built with 0 dependencies · <span data-hud>— particles · — fps</span> · grain: <span data-grain-label>16mm</span></p>
    <p><button class="linkish" data-act="lab" type="button">grain lab</button> · <button class="linkish" data-act="smooth" type="button">smooth wheel: <span data-smooth>off</span></button></p>
  </div>
</footer>

<nav class="mobile-nav" aria-label="Sections">${mobileNav}</nav>

<div class="palette" id="palette" role="dialog" aria-modal="true" aria-label="Command palette" hidden>
  <div class="palette-box">
    <input type="search" placeholder="Jump to… (work, grain, theme, email)" aria-label="Command palette" autocomplete="off" spellcheck="false">
    <ul class="palette-list" role="listbox"></ul>
    <p class="palette-foot mono">↑↓ move · ↵ run · esc close</p>
  </div>
</div>

<aside class="lab" id="lab" aria-label="Grain lab" hidden></aside>
<div class="toast" id="toast" role="status" aria-live="polite"></div>

<noscript>
  <style>.field,.grain,.rail,.hint{display:none}.stage{min-height:0}</style>
  <p style="padding:20px;font-family:ui-monospace,monospace;color:#a5a198">
    JavaScript is off, so the ink is standing still. Everything below still works.</p>
</noscript>

<script type="module" src="./js/app.js"></script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`index.html ← content.js  (${(html.length / 1024).toFixed(1)} kB, ${html.split('\n').length} lines)`);
