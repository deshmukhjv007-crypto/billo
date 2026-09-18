#!/usr/bin/env node
/* ============================================================================
   build.js — renders index.html from content.js, and picks up the artefacts
   make-pdf.js just wrote.

   The page ships as plain, crawlable, works-without-JS HTML (unlike a
   client-rendered SPA), but the copy still lives in exactly one place.

       npm run build      # make-pdf.js (PDF + txt) → build.js (index.html)
       node build.js      # just the HTML
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './content.js';
import { PERSON, SUMMARY, SKILLS, EDUCATION, CERTIFICATIONS, ACHIEVEMENTS } from './resume.js';
import { findPhoto } from './photo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const title = C.HERO.title.map(w => w.t).join('');

/* ---------------------------------------------------- the downloadable CV -- */

const human = n => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} kB` : `${(n / 1048576).toFixed(1)} MB`;

function artefact(file) {
  try { return { size: fs.statSync(path.join(__dirname, file)).size, exists: true }; }
  catch { return { size: 0, exists: false }; }
}

const pdf = artefact(`${C.FILE_STEM}.pdf`);
const txt = artefact(`${C.FILE_STEM}.txt`);
const pdfLabel = pdf.exists ? `PDF · ${human(pdf.size)} · 1 page` : 'PDF';

/* The photo is picked up from disk so swapping in a real one is a file copy,
   not a code change. Until then an inked monogram stands in. */
const photo = findPhoto(__dirname, C.ME.photo);

/* With a photograph on disk the hero's artwork IS the photograph — sampled
   into a halftone and re-inked by the particle field (js/portrait.js). Without
   one it stays the drawn shape, so the hero is never empty. */
const heroArt = photo ? 'portrait' : C.HERO.shape;

const monogram = `<svg class="monogram" viewBox="0 0 200 200" role="img" aria-label="${esc(C.ME.name)}">
      <defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="currentColor" stop-opacity=".22"/>
        <stop offset="1" stop-color="currentColor" stop-opacity=".06"/></linearGradient></defs>
      <rect width="200" height="200" fill="url(#mg)"/>
      <text x="100" y="100" text-anchor="middle" dominant-baseline="central">JD</text>
      <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1.5"/>
    </svg>`;

const portrait = photo
  ? `<img class="portrait-img" src="${esc(photo)}" alt="${esc(C.ME.photoAlt)}" width="800" height="800" loading="eager" decoding="async">`
  : monogram;

/* ---------------------------------------------------------------- partials */

const nav = C.NAV.map(n =>
  `<a href="#${n.id}" data-spy class="${n.hot ? 'pill' : ''}">${n.label}</a>`).join('\n        ');

const mobileNav = C.NAV.filter(n => !n.desktop).map(n =>
  `<a href="#${n.id}" data-spy class="${n.hot ? 'hot' : ''}">${n.label}</a>`).join('');

const heroWords = C.HERO.title
  .map(w => (w.chaos ? `<button class="chaos-word" data-chaos type="button">${esc(w.t.trim())}</button>` : esc(w.t)))
  .join(' ');
const chaosWord = (C.HERO.title.find(w => w.chaos) || { t: '' }).t.trim();

/* one experience scene: copy on one side, particle drawing on the other */
const role = (r, i) => `
    <section class="scene piece ${i % 2 ? 'flip' : ''} reveal" id="${r.id}" data-shape="${r.art}">
      <div class="copy">
        <p class="meta"><span>${String(i + 1).padStart(2, '0')}</span><span>${esc(r.kicker)}</span>${r.current ? '<span class="tag-live">current</span>' : ''}</p>
        <h2 data-wipe>${esc(r.short)}</h2>
        <p class="sub hand">${esc(r.sub)}</p>
        <p class="org"><b>${esc(r.role)}</b><span>${esc(r.when)}</span></p>
        <ul class="achievements">
          ${r.bullets.map(b => `<li>${esc(b)}</li>`).join('\n          ')}
        </ul>
        <ul class="tags">${r.tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
        ${r.note ? `<p class="note hand">${esc(r.note)}</p>` : ''}
      </div>
      <div class="stage" data-art="${r.art}"></div>
    </section>`;

const stat = s => `
        <li class="reveal"><b>${esc(s.n)}</b><span>${esc(s.label)}</span></li>`;

const kit = C.KIT.map(k => `
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

const achievements = ACHIEVEMENTS.map(a => `
          <li class="reveal">${esc(a)}</li>`).join('');

const socials = C.ME.socials.map(s =>
  `<li><a href="${esc(s.href)}" ${s.href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}${s.download ? ' download' : ''}>${esc(s.label)}</a></li>`).join('');

/* The paper preview: the same document the PDF holds, rendered in HTML. It is
   decorative — the download is the real thing — so it is aria-hidden and the
   text is duplicated only for people who never open the PDF. */
const previewSkills = SKILLS.map(g =>
  `<p class="pv-skill"><b>${esc(g.group)}</b> ${esc(g.items.join(', '))}</p>`).join('\n            ');

const previewRoles = C.ROLES.map(r => `
            <div class="pv-role">
              <p class="pv-head"><b>${esc(r.name)}</b><span>${esc(r.when)}</span></p>
              <p class="pv-role-line">${esc(r.role)} · ${esc(r.place)}</p>
              <ul>${r.bullets.slice(0, 2).map(b => `<li>${esc(b)}</li>`).join('')}</ul>
            </div>`).join('');

const resumeNotes = C.RESUME.notes.map(n => `<li>${esc(n)}</li>`).join('\n          ');

/* ------------------------------------------------------------------ page --- */

const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(C.ME.name)} — ${esc(C.ME.role)}, Dynamics 365 &amp; Azure</title>
<meta name="description" content="${esc(`${C.ME.headline}. ${PERSON.years} building Dynamics 365 CRM, Azure Functions and Power Platform automation in ${C.ME.place}. Résumé available as PDF or plain text.`)}">
<meta name="author" content="${esc(C.ME.name)}">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0a0a0b" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f4f1ea" media="(prefers-color-scheme: light)">
<link rel="canonical" href="https://jayeshdeshmukh.dev/">
<meta property="og:title" content="${esc(C.ME.name)} — ${esc(C.ME.role)}">
<meta property="og:description" content="${esc(C.ME.headline)}">
<meta property="og:type" content="profile">
<meta property="og:url" content="https://jayeshdeshmukh.dev/">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="application/pdf" href="${esc(C.ME.resume)}" title="Résumé (PDF)">
${photo ? `<link rel="preload" as="image" href="${esc(photo)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..800&family=Caveat:wght@600;700&family=Instrument+Sans:ital,wght@0,400..600;1,400..600&family=JetBrains+Mono:wght@400;600&display=swap">
<link rel="stylesheet" href="./styles.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230a0a0b'/%3E%3Cpath d='M16 5v22M5 16h22M8 8l16 16M24 8L8 24' stroke='%23ef5024' stroke-width='2.4' stroke-linecap='round'/%3E%3C/svg%3E">
<script type="application/ld+json">
${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: C.ME.name,
  jobTitle: C.ME.role,
  description: C.ME.headline,
  email: `mailto:${C.ME.email}`,
  telephone: C.ME.phone,
  url: 'https://jayeshdeshmukh.dev/',
  address: { '@type': 'PostalAddress', addressLocality: 'Pune', addressRegion: 'Maharashtra', addressCountry: 'IN' },
  sameAs: [C.ME.socials.find(s => s.label === 'LinkedIn')?.href].filter(Boolean),
  knowsAbout: SKILLS.flatMap(g => g.items).slice(0, 20)
}, null, 2)}
</script>
<script>
document.documentElement.classList.add('js');
try {
  var t = localStorage.getItem('jd-theme');
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
    <a class="pill resume-pill" data-magnet="90" data-act="resume" href="${esc(C.ME.resume)}" download>Résumé <i aria-hidden="true">↓</i></a>
  </div>
</header>

<main id="main">

  <!-- ░░ hero ░░ -->
  <section class="scene hero" id="home" data-shape="${heroArt}">
    <div class="copy">
      <p class="meta reveal"><span>${esc(C.HERO.kicker[0])}</span><span>${esc(C.HERO.kicker[1])}</span></p>
      <h1 data-split data-chaos-word="${esc(chaosWord)}">${heroWords}</h1>
      <p class="lede reveal">${C.HERO.lede}</p>
      <div class="ctas reveal">
        ${C.HERO.ctas.map(c => `<a class="btn ${c.kind === 'ghost' ? 'ghost' : ''}" href="${esc(c.href)}"${c.download ? ' download' : ''}${c.act ? ` data-act="${c.act}"` : ''}>${esc(c.label)} <i aria-hidden="true">${c.ico}</i></a>`).join('\n        ')}
      </div>
      <p class="avail reveal">${esc(C.ME.availability)} · ${esc(C.ME.city)}</p>
    </div>
    <div class="hero-side">
      <figure class="portrait${photo ? ' has-photo' : ''}" data-magnet-host>
        <span class="portrait-frame">${portrait}</span>
        <figcaption class="mono">${esc(PERSON.city)} · IST</figcaption>
      </figure>
      <div class="stage" data-art="${heroArt}">
        <p class="hint hand">${esc(C.HERO.hint)}</p>
      </div>
    </div>
  </section>

  <div class="ticker" aria-hidden="true"><div class="track" data-ticker>${
    C.TICKER.map(t => `<span>${esc(t)}</span><i>✳</i>`).join('')}</div></div>

  <!-- ░░ numbers ░░ -->
  <section class="stats-sec">
    <div class="wrap">
      <p class="meta reveal"><span>by the numbers</span><span>each one from the CV below</span></p>
      <ul class="stats">${C.HIGHLIGHTS.map(stat).join('')}
      </ul>
    </div>
  </section>

  <!-- ░░ work ░░ -->
  <section class="work-head" id="work">
    <div class="wrap">
      <p class="meta reveal"><span>experience</span><span>${C.ROLES.length} roles · ${C.ME.place.split(',')[0]}</span></p>
      <h2 class="huge reveal" data-wipe>Where I've<br>done the work.</h2>
      <p class="lede reveal">${esc(SUMMARY)}</p>
    </div>
  </section>
${C.ROLES.map(role).join('\n')}

  <!-- ░░ highlights ░░ -->
  <section class="bench-sec" id="highlights">
    <div class="wrap">
      <p class="meta reveal"><span>key achievements</span></p>
      <ul class="bench highlights">${achievements}
      </ul>
    </div>
  </section>

  <!-- ░░ skills ░░ -->
  <section class="scene about skills-sec" id="about" data-shape="puzzle">
    <div class="copy">
      <p class="meta reveal"><span>technical skills</span><span>${SKILLS.length} groups</span></p>
      <h2 class="reveal" data-wipe>${C.ABOUT.title.split('\n').map(esc).join('<br>')}</h2>
      <p class="desc reveal">${C.ABOUT.body}</p>
      <dl class="kit reveal">${kit}
      </dl>
      <p class="hand note reveal">${esc(C.ABOUT.hand)}</p>
    </div>
    <div class="stage" data-art="${C.ABOUT.shape}"></div>
  </section>

  <!-- ░░ résumé ░░ -->
  <section class="resume-sec" id="resume">
    <div class="glow" aria-hidden="true"></div>
    <div class="wrap resume-wrap">
      <div class="resume-copy">
        <p class="meta reveal"><span>${esc(C.RESUME.kicker)}</span><span>${pdf.exists ? pdfLabel : 'run npm run build'}</span></p>
        <h2 class="reveal" data-wipe>${esc(C.RESUME.title)}</h2>
        <p class="hand reveal">${esc(C.RESUME.hand)}</p>
        <p class="desc reveal">${C.RESUME.body}</p>
        <ul class="resume-notes reveal">${resumeNotes}</ul>
        <div class="ctas reveal resume-ctas" data-magnet-host>
          <a class="btn big magnet resume-dl" data-magnet="150" data-act="resume" href="${esc(C.ME.resume)}" download>
            <span class="dl-ico" aria-hidden="true">↓</span>
            <span class="dl-text"><b>Download résumé</b><em>${esc(pdf.exists ? `${pdfLabel} · selectable text` : 'PDF')}</em></span>
          </a>
          <a class="btn ghost small" href="${esc(C.ME.resumeTxt)}" download data-act="resume-txt">Plain text (.txt)</a>
          <button class="btn ghost small" data-act="print" type="button">Print this page</button>
        </div>
        <p class="email reveal"><a href="mailto:${esc(C.ME.email)}">${esc(C.ME.email)}</a> <span class="dot">·</span> <a href="${esc(C.ME.phoneHref)}">${esc(C.ME.phone)}</a></p>
      </div>

      <div class="paper-wrap reveal" aria-hidden="true">
        <div class="paper">
          <div class="paper-sheet">
          <div class="paper-head">
            <p class="pv-name">${esc(C.ME.name)}</p>
            <p class="pv-role">${esc(C.ME.headline)}</p>
            <p class="pv-contact">${esc(C.ME.phone)} · ${esc(C.ME.email)} · ${esc(C.ME.linkedinShort || C.ME.socials[0].href.replace('https://', ''))}</p>
          </div>
          <p class="pv-section">Professional Summary</p>
          <p class="pv-body">${esc(SUMMARY)}</p>
          <p class="pv-section">Technical Skills</p>
          ${previewSkills}
          <p class="pv-section">Professional Experience</p>${previewRoles}
          <p class="pv-section">Key Achievements</p>
          <ul class="pv-certs">${ACHIEVEMENTS.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
          <p class="pv-section">Education &amp; Certifications</p>
          <p class="pv-body">${esc(EDUCATION[0].degree)} — ${esc(EDUCATION[0].school)}, ${esc(EDUCATION[0].when)}.</p>
          <ul class="pv-certs">${CERTIFICATIONS.map(c => `<li>${esc(c.name)} — ${esc(c.org)}</li>`).join('')}</ul>
          </div>
        </div>
        <p class="paper-cap hand">that's the whole thing, one page ↝</p>
      </div>
    </div>
  </section>

  <!-- ░░ journey ░░ -->
  <section class="scene journey" id="journey" data-shape="cap">
    <div class="copy">
      <p class="meta reveal"><span>education &amp; certifications</span><span>2020 → now</span></p>
      <h2 class="reveal" data-wipe>Still collecting<br>the paperwork.</h2>
      <ol class="timeline">${journey}
      </ol>
    </div>
    <div class="stage" data-art="cap"></div>
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
        <a class="btn ghost" href="${esc(C.ME.resume)}" download data-act="resume">Résumé ↓</a>
        <button class="btn ghost" data-copy="${esc(C.ME.email)}" type="button">Copy email</button>
      </div>
      <p class="email reveal"><a href="mailto:${esc(C.ME.email)}">${esc(C.ME.email)}</a> <span class="dot">·</span> <a href="${esc(C.ME.phoneHref)}">${esc(C.ME.phone)}</a></p>
      <ul class="socials reveal">${socials}</ul>
    </div>
    <div class="stage" data-art="${C.CONTACT.shape}"></div>
  </section>
</main>

<footer class="foot">
  <div class="wrap foot-in">
    <p>© <span data-year>2026</span> ${esc(C.ME.name)} · ${esc(C.ME.place)}</p>
    <p class="mono">built with 0 dependencies · <span data-hud>— particles · — fps</span> · grain: <span data-grain-label>16mm</span></p>
    <p><a class="linkish" href="${esc(C.ME.resume)}" download data-act="resume">résumé ↓</a> · <button class="linkish" data-act="lab" type="button">grain lab</button> · <button class="linkish" data-act="smooth" type="button">smooth wheel: <span data-smooth>off</span></button></p>
  </div>
</footer>

<nav class="mobile-nav" aria-label="Sections">${mobileNav}</nav>

<div class="palette" id="palette" role="dialog" aria-modal="true" aria-label="Command palette" hidden>
  <div class="palette-box">
    <input type="search" placeholder="Jump to… (work, résumé, skills, email)" aria-label="Command palette" autocomplete="off" spellcheck="false">
    <ul class="palette-list" role="listbox"></ul>
    <p class="palette-foot mono">↑↓ move · ↵ run · esc close</p>
  </div>
</div>

<aside class="lab" id="lab" aria-label="Grain lab" hidden></aside>
<div class="toast" id="toast" role="status" aria-live="polite"></div>

<noscript>
  <style>.field,.grain,.rail,.hint,.paper{display:none}.stage{min-height:0}</style>
  <p style="padding:20px;font-family:ui-monospace,monospace;color:#a5a198">
    JavaScript is off, so the ink is standing still. Everything still works —
    including the résumé: <a href="${esc(C.ME.resume)}" download>download the PDF</a>.</p>
</noscript>

<script type="module" src="./js/app.js"></script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`  index.html   ${(html.length / 1024).toFixed(1)} kB · ${C.ROLES.length} roles · ${SKILLS.length} skill groups · ${ACHIEVEMENTS.length} achievements`);
console.log(`  portrait     ${photo
  ? `${path.basename(photo)} — the hero will ink it into particles (js/portrait.js)`
  : 'inked monogram — drop a photo in assets/ and the hero becomes your face in dots (see assets/README.md)'}`);
