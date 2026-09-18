/* ============================================================================
   app.js — enhancement layer. The HTML arrives complete; this only adds life:
   word-split headings, the blueprint line art, the grain engine + lab, the
   particle field, the command palette, theming and the little conveniences.
   ========================================================================== */

import { ME, ART, TEXT_ART, IMAGE_ART, ROLES, ACHIEVED, NAV, TICKER } from '../content.js';
import { grain, mountLab, PRESETS } from './grain.js';
import { field } from './field.js';
import { motion } from './motion.js';
import { bus, state } from './bus.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ------------------------------------------------------------------ theme */

const THEME_KEY = 'jd-theme';
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
  const meta = $('meta[name="theme-color"]:not([media])') || $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#f4f1ea' : '#0a0a0b');
  // grain blend follows the surface unless the user picked one by hand
  if (grain.layer && !grain.layer._blendLocked) {
    grain.set({ blend: t === 'light' ? 'multiply' : 'overlay' });
  }
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (_) {}
  const prefersLight = matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(saved || (prefersLight ? 'light' : 'dark'));
}

/* ------------------------------------------------------- split headings --- */

function splitHeadings() {
  $$('[data-split]').forEach(el => {
    const chaosWord = (el.dataset.chaosWord || '').trim().toLowerCase();
    const frag = document.createDocumentFragment();
    let i = 0;
    const wrap = (node, text) => {
      const span = document.createElement('span');
      span.className = 'w';
      span.style.setProperty('--i', i++);
      if (text && text.trim().replace(/[.!?]$/, '').toLowerCase() === chaosWord) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chaos-word';
        b.dataset.chaos = '';
        b.textContent = text.trim();
        b.setAttribute('aria-label', `${text.trim()} — click to scatter the ink`);
        span.appendChild(b);
        span.classList.add('split-line');
      } else {
        span.textContent = text;
      }
      frag.appendChild(span);
    };
    [...el.childNodes].forEach(node => {
      if (node.nodeType === 3) {
        node.textContent.split(/(\s+)/).forEach(part => { if (part.trim()) wrap(node, part); });
      } else if (node.nodeType === 1) {
        // keep elements (the chaos button, <em>, <br>) inside a .w so they rise with the line
        const span = document.createElement('span');
        span.className = 'w';
        span.style.setProperty('--i', i++);
        span.appendChild(node.cloneNode(true));
        frag.appendChild(span);
      }
    });
    el.innerHTML = '';
    el.appendChild(frag);
    el.classList.add('split');
  });
}

/* --------------------------------------------------------- blueprint art -- */

function blueprint(name) {
  /* Image art has no paths to stroke — it is sampled from a file at runtime.
     The blueprint falls back to the drawn shape, NOT to the photograph: the
     hero already frames the photo, so drawing it twice reads as a bug. */
  const img = IMAGE_ART[name];
  if (img) return img.fallback ? blueprint(img.fallback) : '';
  const art = ART[name];
  if (art) {
    return `<svg class="blueprint" viewBox="0 0 200 200" aria-hidden="true" focusable="false">${
      art.paths.map((d, i) =>
        `<path d="${d}" pathLength="1" style="--i:${i}"/>`).join('')}</svg>`;
  }
  const t = TEXT_ART[name];
  if (t) {
    const [w, h] = t.box || [360, 170];
    return `<svg class="blueprint" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false">
      <text x="50%" y="58%" text-anchor="middle" dominant-baseline="middle">${t.text}</text></svg>`;
  }
  return '';
}

function injectArt() {
  $$('.stage[data-art]').forEach(st => {
    st.insertAdjacentHTML('afterbegin', blueprint(st.dataset.art));
  });
}

/* ------------------------------------------------------------- ticker ----- */

function initTicker() {
  const track = $('[data-ticker]');
  if (!track) return;
  track.innerHTML += track.innerHTML;      // duplicate → seamless -50% loop
  const label = TICKER.join(' · ');
  track.parentElement.setAttribute('aria-label', label);
}

/* --------------------------------------------------------------- field ---- */

function initField() {
  const canvas = $('.field');
  if (!canvas || state.reduce) {
    $$('.stage').forEach(s => s.classList.add('still'));   // blueprint stays visible
    return;
  }
  document.documentElement.classList.add('motion');
  field.init(canvas);

  const scenes = $$('[data-shape]');
  const activate = sec => field.setShape(sec.dataset.shape, sec.querySelector('.stage'));

  const first = scenes.find(s => s.getBoundingClientRect().top < innerHeight * 0.6) || scenes[0];
  if (first) activate(first);
  field.prewarm(scenes.map(s => s.dataset.shape));

  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) activate(e.target);
  }, { rootMargin: '-42% 0px -42% 0px' });
  scenes.forEach(s => io.observe(s));

  const foot = $('.foot');
  if (foot) {
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting) field.setShape('cloud', null);
      else if (scenes.length) activate(scenes[scenes.length - 1]);
    }, { threshold: 0.05 }).observe(foot);
  }

  field.start();

  /* The photograph has finished being inked: let the dots be the portrait, and
     retire the framed copy beside them (see .hero.inked in styles.css). */
  bus.on('art', e => {
    if (e && e.name === 'portrait') $('.hero')?.classList.add('inked');
  });

  bus.on('stats', s => {
    const hud = $('[data-hud]');
    if (hud) hud.textContent = `${s.drawn.toLocaleString('en-IN')} of ${s.count.toLocaleString('en-IN')} particles · ${s.fps} fps`;
  });
}

/* ----------------------------------------------------------------- lab ---- */

let labApi = null;
function initLab() {
  grain.init($('#grain'));
  applyTheme(document.documentElement.dataset.theme || 'dark');   // blend mode now has an engine to write to
  const panel = $('#lab');
  panel.hidden = false;
  panel.setAttribute('aria-hidden', 'true');
  labApi = mountLab(panel, grain.layer);

  const smoothSwitch = document.createElement('label');
  smoothSwitch.className = 'sw';
  smoothSwitch.innerHTML = `<input type="checkbox" data-lab="smooth"><span>Smooth wheel (Lenis-style)</span>`;
  panel.querySelector('.switches').appendChild(smoothSwitch);
  const cb = smoothSwitch.querySelector('input');
  cb.checked = motion.smooth;
  cb.addEventListener('change', () => { setSmooth(cb.checked); });

  const stats = document.createElement('p');
  stats.className = 'lab-stats mono';
  stats.dataset.labStats = '';
  panel.querySelector('.lab-head').appendChild(stats);
  bus.on('stats', s => {
    stats.textContent = `${s.drawn.toLocaleString('en-IN')}/${s.count.toLocaleString('en-IN')} particles · ${s.fps} fps · stride ${s.stride}`;
  });

  // blend lock: once you touch the select, the theme stops overriding it
  panel.querySelector('[data-lab=blend]').addEventListener('change', () => {
    if (grain.layer) grain.layer._blendLocked = true;
  });
  // keep the footer label in sync with the closest preset
  const labelEl = $('[data-grain-label]');
  if (labelEl) {
    const iv = setInterval(() => {
      if (!grain.layer) return;
      const s = grain.layer.s;
      const hit = Object.keys(PRESETS).find(name => {
        const p = { ...PRESETS[name] };
        return Object.keys(p).every(k => s[k] === p[k]);
      });
      labelEl.textContent = hit || `custom · ${s.opacity.toFixed(2)} · ${s.blend}${s.filmOn ? ` · ${s.fps}fps` : ' · static'}`;
    }, 700);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearInterval(iv); });
  }
}

function openLab(open = true) {
  const panel = $('#lab');
  panel.classList.toggle('open', open);
  panel.setAttribute('aria-hidden', String(!open));
  if ('inert' in panel) panel.inert = !open;   // no tabbing into a closed drawer
  if (open) {
    labApi && labApi.sync();
    const first = panel.querySelector('input[type=range]');
    setTimeout(() => first && first.focus({ preventScroll: true }), 60);
  }
}

/* ---------------------------------------------------------------- toast --- */

let toastT = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 2200);
}

/* -------------------------------------------------------------- palette --- */

const COMMANDS = [];
function buildCommands() {
  COMMANDS.length = 0;
  const go = (id, label, hint) => COMMANDS.push({
    label, hint, keywords: `${label} ${id} section jump`,
    run: () => { const el = document.getElementById(id); if (el) motion.scrollTo(el); }
  });
  go('home', 'Hero', 'top of page');
  NAV.forEach(n => go(n.id, n.label, `#${n.id}`));
  ROLES.forEach(r => COMMANDS.push({
    label: r.short, hint: `${r.role} · ${r.when}`, keywords: `${r.name} ${r.short} ${r.role} ${r.tags.join(' ')} work experience`,
    run: () => { const el = document.getElementById(r.id); if (el) motion.scrollTo(el); }
  }));
  ACHIEVED.forEach((a, i) => COMMANDS.push({
    label: `Achievement ${i + 1}`, hint: a.slice(0, 58), keywords: `achievement ${a} highlights`,
    run: () => { const el = document.getElementById('highlights'); if (el) motion.scrollTo(el); }
  }));
  COMMANDS.push(
    { label: 'Grain lab', hint: 'tune the film grain · G', keywords: 'grain lab noise turbulence film preset', run: () => openLab(true) },
    { label: 'Grain: off / on', hint: 'toggle the whole grain layer', keywords: 'grain toggle', run: () => { const on = !grain.layer.s.on; grain.set({ on }); toast(on ? 'grain on' : 'grain off'); } },
    ...Object.keys(PRESETS).filter(n => n !== 'Off').map(n => ({
      label: `Grain preset · ${n}`, hint: 'apply', keywords: `grain preset ${n}`,
      run: () => { grain.preset(n); openLab(true); toast(`grain → ${n}`); }
    })),
    { label: 'Theme: dark ↔ light', hint: 'T', keywords: 'theme dark light mode', run: () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light') },
    { label: 'Smooth wheel: on ↔ off', hint: 'S', keywords: 'smooth scroll lenis wheel', run: () => setSmooth(!motion.smooth) },
    { label: 'Scatter the ink', hint: 'burst the particle field', keywords: 'chaos burst particles scatter', run: () => motion.kick(1) },
    { label: 'Copy email', hint: ME.email, keywords: `email copy contact ${ME.email}`, run: () => copyEmail() },
    {
      label: 'Download résumé (PDF)', hint: 'one page · A4 · R', keywords: 'resume cv pdf download hire curriculum vitae',
      run: () => { const a = $('.resume-dl') || $('a[download]'); if (a) { a.click(); resumeDone('pdf'); } }
    },
    {
      label: 'Plain-text résumé', hint: 'for ATS portals', keywords: 'resume cv txt plain ats text download',
      run: () => { const a = document.querySelector(`a[href$=".txt"]`); if (a) { a.click(); resumeDone('txt'); } }
    },
    {
      label: 'Print this page', hint: 'the PDF prints better', keywords: 'print paper save', run: () => printPage()
    },
    { label: 'View source of this page', hint: 'index.html', keywords: 'source code html', run: () => window.open('./index.html', '_blank') }
  );
}

function initPalette() {
  const root = $('#palette');
  const input = $('input', root);
  const list = $('.palette-list', root);
  let items = [], idx = 0, lastFocus = null;

  const render = (q = '') => {
    const query = q.trim().toLowerCase();
    items = COMMANDS
      .map(c => ({ c, score: scoreIt(c, query) }))
      .filter(x => !query || x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 9)
      .map(x => x.c);
    idx = 0;
    list.innerHTML = items.map((c, i) =>
      `<li role="option" data-i="${i}" class="${i === 0 ? 'sel' : ''}">
         <span>${escapeHtml(c.label)}</span><em>${escapeHtml(c.hint || '')}</em></li>`).join('') ||
      `<li class="empty">nothing matches “${escapeHtml(q)}”</li>`;
  };
  const scoreIt = (c, q) => {
    if (!q) return 1;
    const hay = `${c.label} ${c.hint || ''} ${c.keywords || ''}`.toLowerCase();
    if (c.label.toLowerCase().startsWith(q)) return 100;
    if (hay.includes(q)) return 60 - (hay.indexOf(q) / 10);
    return [...q].filter(ch => hay.includes(ch)).length / q.length > 0.75 ? 20 : 0;
  };
  const move = d => {
    if (!items.length) return;
    idx = (idx + d + items.length) % items.length;
    $$('li', list).forEach((li, i) => li.classList.toggle('sel', i === idx));
    const sel = list.querySelector('.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  };
  const run = i => {
    const c = items[i == null ? idx : i];
    if (!c) return;
    close();
    setTimeout(() => c.run(), 40);
  };
  const open = () => {
    buildCommands();
    lastFocus = document.activeElement;
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add('open'));
    input.value = ''; render(''); input.focus();
  };
  const close = () => {
    root.classList.remove('open');
    setTimeout(() => { root.hidden = true; }, 180);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  };

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  list.addEventListener('click', e => {
    const li = e.target.closest('li[data-i]');
    if (li) run(Number(li.dataset.i));
  });
  list.addEventListener('pointermove', e => {
    const li = e.target.closest('li[data-i]');
    if (li) { idx = Number(li.dataset.i); $$('li', list).forEach((x, i) => x.classList.toggle('sel', i === idx)); }
  });
  root.addEventListener('click', e => { if (e.target === root) close(); });

  paletteApi.open = open; paletteApi.close = close;
}
const paletteApi = {};
const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------ utilities --- */

async function copyEmail() {
  try {
    await navigator.clipboard.writeText(ME.email);
    toast(`${ME.email} copied`);
  } catch (_) {
    toast('copy blocked — ' + ME.email);
  }
}

function setSmooth(on) {
  const v = motion.setSmooth(on);
  const label = $('[data-smooth]');
  if (label) label.textContent = v ? 'on' : 'off';
  toast(v ? 'smooth wheel on — the page now glides' : 'smooth wheel off — native scroll');
  return v;
}

/* -------------------------------------------------------- résumé download */

/* The file is a plain <a download>, so it works with JS off and with the
   keyboard. This only adds the feedback around it: a toast, a button that
   says it happened, and a nudge in the palette for next time. */
const GOT_RESUME_KEY = 'jd-got-resume';

function resumeDone(which) {
  toast(which === 'txt' ? 'plain-text résumé — the ATS-safe one' : 'résumé downloaded · 1 page PDF');
  try { localStorage.setItem(GOT_RESUME_KEY, which); } catch (_) {}
  const btn = $('.resume-dl');
  if (btn) {
    btn.classList.add('done');
    const label = btn.querySelector('.dl-text b');
    const sub = btn.querySelector('.dl-text em');
    if (label) label.textContent = 'Downloaded';
    if (sub) sub.textContent = 'again? it is the same one-page PDF';
    setTimeout(() => {
      btn.classList.remove('done');
      if (label) label.textContent = 'Download résumé';
    }, 3200);
  }
}

function initButtons() {
  document.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (act) {
      const kind = act.dataset.act;
      if (kind === 'lab') { e.preventDefault(); openLab(!$('#lab').classList.contains('open')); }
      else if (kind === 'theme') applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
      else if (kind === 'palette') { e.preventDefault(); paletteApi.open(); }
      else if (kind === 'smooth') { e.preventDefault(); setSmooth(!motion.smooth); }
      else if (kind === 'resume') resumeDone('pdf');          // let the browser follow the link
      else if (kind === 'resume-txt') resumeDone('txt');
      else if (kind === 'print') { e.preventDefault(); printPage(); }
      return;
    }
    const cp = e.target.closest('[data-copy]');
    if (cp) { e.preventDefault(); copyEmail(); }
  });
}

/** Print the page, with a word of warning: the PDF is the better artefact. */
function printPage() {
  toast('tip: the PDF is laid out for paper — this page is not');
  setTimeout(() => window.print(), 700);
}

function initKeys() {
  addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteApi.open(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'g') { e.preventDefault(); openLab(!$('#lab').classList.contains('open')); }
    else if (k === 't') applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
    else if (k === 's') setSmooth(!motion.smooth);
    else if (k === 'c') copyEmail();
    else if (k === 'r') {
      const a = $('.resume-dl') || $('a[download]');
      if (a) { a.click(); resumeDone('pdf'); }
    }
    else if (k === 'escape') { openLab(false); paletteApi.close && paletteApi.close(); }
  });
}

/* ------------------------------------------------------------------ boot -- */

function boot() {
  initTheme();
  const year = $('[data-year]');
  if (year) year.textContent = new Date().getFullYear();
  splitHeadings();
  injectArt();
  initTicker();
  initLab();
  initField();
  initPalette();
  initButtons();
  initKeys();
  motion.init();

  /* first-paint nicety: let the hero settle before anything heavy happens */
  requestAnimationFrame(() => document.body.classList.add('ready'));
  if (state.reduce) document.documentElement.classList.add('reduced');

  if (localStorage.getItem(GOT_RESUME_KEY)) console.log('%c thanks for reading the CV ', 'background:#ffd166;color:#14130f;font-weight:700;padding:3px 6px;border-radius:4px');
  console.log(
    `%c ${ME.name} %c 0 dependencies · grain engine + particle field · R for the résumé, G for the grain lab, \u2318K for commands `,
    'background:#ef5024;color:#0a0a0b;font-weight:700;padding:3px 6px;border-radius:4px 0 0 4px',
    'background:#121214;color:#f4f1ea;padding:3px 6px;border-radius:0 4px 4px 0');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

export { applyTheme, openLab, toast, blueprint };
