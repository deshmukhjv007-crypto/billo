#!/usr/bin/env node
/* ============================================================================
   make-pdf.js — a résumé PDF engine with zero dependencies.

   Node ships no PDF library and this repo has no `node_modules` on purpose, so
   the whole thing is written out here: object table, content streams, font
   metrics, pagination, link annotations, page tree.

   Why not just "print the page to PDF"?
     • That needs a browser — a headless one — to do the one job a static
       build should be able to do on its own.
     • The result looks like a web page, not a document: no real text runs, and
       an ATS parser sees nothing at all.
     • This one is real text in a real page tree, uses the standard-14 fonts
       (so no font embedding, no licensing, ~20 kB), carries proper document
       metadata, and its links are clickable in every viewer.

   What's in here
     metrics   exact Helvetica / Helvetica-Bold advances from Adobe's AFM files,
               so wrapping is measured rather than guessed and nothing overflows
     Doc       a tiny drawing canvas: text, rules, dots, colour, letter-spacing,
               URI link annotations
     Flow      need()/keep-together pagination with a repeated running head,
               no orphaned headings, no bullet ever split across a page break
     build()   resume.js → layout → bytes  (.pdf and an ATS-safe .txt)

     node make-pdf.js            # writes both files next to this script
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from './resume.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ═══════════════════════════════════════════════════════ 1. font metrics ══ */

/* Advance widths (units/1000 em) for codes 32..126, straight from Adobe's
   Helvetica.afm / Helvetica-Bold.afm — the same tables a PDF viewer uses, so
   our idea of "does this line fit" is the viewer's idea of it. */
const W_HELV = [
  278, 278, 355, 556, 556, 889, 667, 222, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  222, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];
const W_HELV_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 278, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  278, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
];
/* codes above 126 that this document actually sets */
const WIDE = { 0x00b7: 278, 0x00e9: 556, 0x2013: 556, 0x2014: 1000, 0x2018: 222, 0x2019: 222, 0x201c: 333, 0x201d: 333 };

const FONTS = {
  body: { name: 'Helvetica', key: 'F1', widths: W_HELV },
  bold: { name: 'Helvetica-Bold', key: 'F2', widths: W_HELV_BOLD },
  italic: { name: 'Helvetica-Oblique', key: 'F3', widths: W_HELV }
};

/** Width of `str` in points, summed per character at `size`. */
export function textWidth(str, size, font = 'body') {
  const table = FONTS[font].widths;
  let w = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0);
    w += c >= 32 && c <= 126 ? table[c - 32] : (WIDE[c] ?? 556);
  }
  return (w / 1000) * size;
}

/* ══════════════════════════════════════════ 2. sanitising / encoding ══ */

/* A résumé that silently loses "₹800" or "CRM → SAP" is a bug nobody would
   ever report, so characters outside WinAnsi get transliterated into something
   a standard PDF font can actually draw. */
const TRANSLIT = [
  [/\u20b9\s?/g, 'Rs. '], [/\u2194/g, ' and '], [/\u2192/g, ' -> '], [/\u2026/g, '...'],
  [/[\u2018\u2019]/g, "'"], [/[\u201c\u201d]/g, '"'], [/\u00a0/g, ' '],
  /* general punctuation minus en/em dash — WinAnsi has those two, and roles
     like "MS D365 CRM Developer — Enterprise Solutions" need them */
  [/[\u2000-\u2012\u2015-\u206f]/g, ' '], [/[\u2500-\u27bf\ufe0e\ufe0f]/g, ''],
  [/[\u{1f000}-\u{1faff}]/gu, '']
];
export function sanitise(input) {
  let s = String(input);
  for (const [re, rep] of TRANSLIT) s = s.replace(re, rep);
  s = s.replace(/[^\x20-\x7e\u00a0-\u00ff\u2013\u2014\u00b7]/g, '');   // drop the rest
  return s.replace(/\s{2,}/g, ' ').trim();
}

/* WinAnsi keeps Latin-1 at its Unicode value and puts the typographic
   punctuation at 0x91..0x97. */
const WINANSI_HIGH = { 0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94 };
const toBytes = s => [...s].map(ch => {
  const cp = ch.codePointAt(0);
  return cp <= 0xff ? cp : (WINANSI_HIGH[cp] ?? 0x3f);
});

const pdfString = s => '(' + toBytes(s).map(b =>
  b === 0x28 || b === 0x29 || b === 0x5c ? '\\' + String.fromCharCode(b)
    : b < 32 || b > 126 ? '\\' + b.toString(8).padStart(3, '0')
      : String.fromCharCode(b)
).join('') + ')';

const num = n => (Math.round(n * 1000) / 1000).toString();

/** Greedy wrap on real metrics, with optional letter-spacing. */
export function wrap(text, size, font, width, letterSpacing = 0) {
  const words = sanitise(text).split(' ').filter(Boolean);
  const measure = s => textWidth(s, size, font) + Math.max(0, s.length - 1) * letterSpacing;
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word;
    if (!line || measure(candidate) <= width) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

/** Fixed-column wrap, for the plain-text export (no fonts involved there). */
export function wrapChars(text, cols) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= cols) line += ' ' + word;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

/* ═════════════════════════════════════════════════════ 3. theme + page ══ */

export const THEME = {
  page: { w: 595.28, h: 841.89 },                       // A4 portrait
  margin: { x: 46, top: 36, bottom: 30 },
  ink: [0.086, 0.102, 0.125],                           // #161a20  body
  soft: [0.365, 0.396, 0.435],                          // #5d6570  meta
  faint: [0.72, 0.741, 0.765],                          // #b8bdc3  rules
  accent: [0.059, 0.298, 0.506],                        // #0f4c81  the only colour
  body: 9.6, lead: 13.1
};

export const frame = () => ({
  x: THEME.margin.x,
  right: THEME.page.w - THEME.margin.x,
  get w() { return this.right - this.x; },
  top: THEME.margin.top,
  bottom: THEME.page.h - THEME.margin.bottom
});

/* ═════════════════════════════════════════════════════════ 4. the doc ══ */

class Doc {
  constructor() {
    this.pages = [];          // [{ ops: [], annots: [] }]
    this.links = [];
    this.marks = [];          // { page, label, from, to } — what took how much room
    this._y = 0;
    this.addPage();
  }

  /** Record a named block's height so `node make-pdf.js --measure` can show
      where the page budget actually went. Costs nothing at render time. */
  mark(label, from) {
    this.marks.push({ page: this.pages.length, label, from, to: this._y, height: from - this._y });
    return this;
  }

  get page() { return this.pages[this.pages.length - 1]; }

  /* The layout thinks in "cursor space": y = 0 is the TOP edge and y grows
     downward, which is how you actually lay a document out. PDF's own space is
     the opposite (origin bottom-left, y up), so every primitive converts once,
     here, and nowhere else. */
  get y() { return this._y; }
  set y(v) { this._y = v; }
  toPdf(cursorY) { return THEME.page.h - cursorY; }

  addPage() {
    this.pages.push({ ops: [], annots: [] });
    this._y = THEME.margin.top;
    return this;
  }

  push(op) { this.page.ops.push(op); return this; }

  color(c, fill = true) { return this.push(`${num(c[0])} ${num(c[1])} ${num(c[2])} ${fill ? 'rg' : 'RG'}`); }

  /** One line of text. o = { size, font, color, at, letterSpacing, link, underline } */
  text(str, o = {}) {
    const size = o.size ?? THEME.body;
    const font = o.font ?? 'body';
    const s = sanitise(str);
    if (!s) return this;
    const x = o.at ?? frame().x;
    const y = this.toPdf(this._y);          // baseline in PDF space
    this.color(o.color ?? THEME.ink);
    const ops = ['BT', `/${FONTS[font].key} ${num(size)} Tf`];
    if (o.letterSpacing) ops.push(`${num(o.letterSpacing)} Tc`);
    ops.push(`1 0 0 1 ${num(x)} ${num(y)} Tm`, `${pdfString(s)} Tj`);
    if (o.letterSpacing) ops.push('0 Tc');        // text state persists past ET
    ops.push('ET');
    this.push(ops.join('\n'));

    const w = textWidth(s, size, font) + Math.max(0, s.length - 1) * (o.letterSpacing || 0);
    if (o.link) {
      /* the clickable box: descender to just above the cap height */
      this.link(x, this._y - size * 0.78, w, size * 1.25, o.link);
      if (o.underline) this.rule(x, this._y + size * 0.26, w, 0.5, THEME.accent);
    }
    return this;
  }

  /** Text whose right edge lands exactly on the frame's right edge. */
  textRight(str, o = {}) {
    const size = o.size ?? THEME.body;
    const s = sanitise(str);
    const w = textWidth(s, size, o.font ?? 'body') + Math.max(0, s.length - 1) * (o.letterSpacing || 0);
    return this.text(str, { ...o, at: frame().right - w });
  }

  /** A filled bar. `y` is the cursor-space line the bar hangs below. */
  rule(x, y, w, h = 0.6, c = THEME.faint) {
    this.color(c);
    return this.push(`${num(x)} ${num(this.toPdf(y) - h)} ${num(w)} ${num(h)} re f`);
  }

  hr(y = this._y, c = THEME.faint, h = 0.6) { return this.rule(frame().x, y, frame().w, h, c); }

  /** A truly round bullet — four Béziers on the unit circle. */
  dot(cx, cursorY, r, c = THEME.accent) {
    const cy = this.toPdf(cursorY);
    const k = 0.5523 * r;
    this.color(c);
    return this.push(
      `${num(cx + r)} ${num(cy)} m\n`
      + `${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c\n`
      + `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c\n`
      + `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c\n`
      + `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c f`
    );
  }

  move(dy) { this._y += dy; return this; }

  /** `y` is cursor space; the rect is stored in PDF space (bottom-left first). */
  link(x, cursorY, w, h, uri) {
    const y = this.toPdf(cursorY) - h;
    this.page.annots.push({ rect: [x, y, x + w, y + h], uri });
    this.links.push(uri);
    return this;
  }
}

/* ══════════════════════════════════════════════════════ 5. layout spec ══ */

/* Every number below was arrived at by measuring, not by taste: the whole CV
   has to land on one page (a three-year candidate with a second page is a
   candidate whose second page nobody reads), and these are the values at which
   it fits with the baselines still breathing. Overflow is still handled — if
   you add a bullet at the bottom of resume.js it will paginate cleanly rather
   than clip — but the intent is one page. */
export const S = {
  name: 22.5, role: 10.2, contact: 8.6,
  section: 9.2, sectionToRule: 4.4, sectionAfter: 9, sectionBefore: 9,
  jobTitle: 10.5, jobMeta: 8.5,
  bullet: 9.5, bulletLead: 11.7, bulletIndent: 12, bulletGap: 1.8, dotR: 1.3,
  jobGap: 5, skillLabelW: 112, skillLead: 11.9
};

/** Shrink type until `str` fits `width` — company names can be very long. */
function fitSize(str, size, font, width, min = 6.5) {
  let s = size;
  while (s > min && textWidth(sanitise(str), s, font) > width) s -= 0.2;
  return s;
}

/* ═══════════════════════════════════════════════════════ 6. the layout ══ */

export function render(opts = {}) {
  /* `spacing` overrides any of the S values below; `balance()` in build() uses
     it to hand the page's leftover points back to the gaps. Merging here (not
     mutating S) keeps render() a pure function of its arguments. */
  const K = { ...S, ...(opts.spacing || {}) };
  const doc = new Doc();
  const F = frame();

  /* ── running head for continuation pages (defined before use, hoisted) ── */
  function pageChrome() {
    doc.y = THEME.margin.top - 15;
    doc.text(R.PERSON.name, { size: 8.4, font: 'bold', color: THEME.soft });
    doc.textRight(R.PERSON.headline.split(' · ')[0], { size: 8, color: THEME.faint });
    doc.y += 6;
    doc.hr(doc.y, THEME.faint, 0.6);
    doc.y = THEME.margin.top + 8;
  }

  /** Reserve `pts`; break the page if they aren't there. */
  function need(pts) {
    if (doc.y + pts > F.bottom) { doc.addPage(); pageChrome(); }
  }

  function sectionTitle(label) {
    need(K.sectionBefore + K.sectionAfter + 14);
    doc.y += K.sectionBefore - 4;
    doc.text(label.toUpperCase(), { size: K.section, font: 'bold', color: THEME.accent, letterSpacing: 1.05 });
    doc.y += K.sectionToRule;
    doc.hr(doc.y, THEME.faint, 0.7);
    doc.y += K.sectionAfter;
  }

  function para(text, o = {}) {
    const size = o.size ?? THEME.body;
    const lead = o.lead ?? THEME.lead;
    for (const line of wrap(text, size, o.font ?? 'body', F.w)) {
      need(lead);
      doc.text(line, { size, font: o.font, color: o.color ?? THEME.ink });
      doc.y += lead;
    }
  }

  /** A bullet: marker, wrapped body, and an atomic page-break guarantee. */
  function bullet(text, o = {}) {
    const lines = wrap(text, K.bullet, 'body', F.w - K.bulletIndent);
    need(lines.length * K.bulletLead + K.bulletGap);
    const top = doc.y;
    doc.dot(F.x + 2.6, top + K.bullet * 0.33, K.dotR, o.dot ?? THEME.accent);
    lines.forEach((line, i) => {
      doc.y = top + i * K.bulletLead;
      doc.text(line, { at: F.x + K.bulletIndent, size: K.bullet, color: o.color ?? THEME.ink });
    });
    doc.y = top + lines.length * K.bulletLead + K.bulletGap;
    return lines.length;
  }

  /* ── masthead ─────────────────────────────────────────────────────────── */
  doc.y = THEME.margin.top + 2;
  doc.text(R.PERSON.name, { size: K.name, font: 'bold', color: THEME.ink, letterSpacing: 0.25 });
  /* 15pt, not "some room": the name's descender bottom sits 0.21em below its
     baseline and the headline's capitals reach 0.72em above theirs, so this is
     the gap at which they clear each other, with a couple of points to spare.
     Scaling it with the font size is what made the first draft collide. */
  doc.y += 19;

  doc.text(R.PERSON.headline, { size: K.role, font: 'bold', color: THEME.accent });
  doc.y += K.role + 5.4;

  /* contact strip — every item except the location is a live link */
  const items = [
    { t: R.PERSON.phone, link: `tel:${R.PERSON.phoneHref}` },
    { t: R.PERSON.email, link: `mailto:${R.PERSON.email}` },
    { t: R.PERSON.linkedinLabel, link: R.PERSON.linkedin },
    { t: R.PERSON.place, link: null }
  ];
  let cx = F.x;
  items.forEach((item, i) => {
    doc.text(item.t, { at: cx, size: K.contact, color: item.link ? THEME.accent : THEME.soft, link: item.link });
    cx += textWidth(item.t, K.contact, 'body');
    if (i < items.length - 1) {
      doc.text('\u00b7', { at: cx + 5.5, size: K.contact, color: THEME.faint });
      cx += 5.5 + textWidth('\u00b7', K.contact, 'body') + 5.5;
    }
  });
  doc.y += K.contact + 6;
  doc.hr(doc.y, THEME.accent, 1.5);
  doc.y += 2.3;
  doc.hr(doc.y, THEME.accent, 0.4);
  doc.y += 8;

  /* ── summary ──────────────────────────────────────────────────────────── */
  let m0 = doc.y;
  sectionTitle('Professional Summary');
  para(R.SUMMARY);
  doc.mark('masthead + summary', m0);

  /* ── skills: label column, flowing value column ───────────────────────── */
  m0 = doc.y;
  sectionTitle('Technical Skills');
  R.SKILLS.forEach((g, i) => {
    const lines = wrap(g.items.join(', '), 9.5, 'body', F.w - K.skillLabelW);
    need(lines.length * K.skillLead);
    const top = doc.y;
    doc.text(g.group, { size: 9.5, font: 'bold', color: THEME.ink });
    lines.forEach((line, k) => {
      doc.y = top + k * K.skillLead;
      doc.text(line, { at: F.x + K.skillLabelW, size: 9.5, color: THEME.soft });
    });
    doc.y = top + lines.length * K.skillLead + (i === R.SKILLS.length - 1 ? 0 : 3.2);
  });

  doc.mark('skills', m0);

  /* ── experience ───────────────────────────────────────────────────────── */
  m0 = doc.y;
  sectionTitle('Professional Experience');
  R.EXPERIENCE.forEach((job, ji) => {
    need(30 + 1.6 * K.bulletLead);                 // header + ~2 bullets
    if (ji > 0) doc.y += 4.5;

    const top = doc.y;
    const companySize = fitSize(job.company, K.jobTitle, 'bold', F.w - 130);
    doc.text(job.company, { size: companySize, font: 'bold', color: THEME.ink });
    doc.textRight(job.when, { size: K.jobMeta, font: 'bold', color: THEME.accent });
    doc.y = top + K.jobTitle + 2.6;
    doc.text(job.role, { size: K.jobMeta + 0.7, font: 'italic', color: THEME.soft });
    doc.textRight(job.place, { size: K.jobMeta, color: THEME.soft });
    doc.y = top + K.jobTitle + 2.6 + K.jobMeta + 5.6;

    job.bullets.forEach(b => bullet(b));
    doc.y += K.jobGap - K.bulletGap;
  });

  doc.mark('experience', m0);

  /* ── key achievements ─────────────────────────────────────────────────── */
  m0 = doc.y;
  sectionTitle('Key Achievements');
  R.ACHIEVEMENTS.forEach(a => bullet(a));
  doc.mark('achievements', m0);

  /* ── education + certifications ───────────────────────────────────────── */
  m0 = doc.y;
  /* One section, not two: they're both "the paperwork", and on a one-pager the
     saved heading and its surrounding space is worth a whole extra bullet. */
  sectionTitle('Education & Certifications');
  R.EDUCATION.forEach(e => {
    need(28);
    const top = doc.y;
    doc.text(e.degree, { size: K.jobTitle - 1.2, font: 'bold', color: THEME.ink });
    doc.textRight(e.when, { size: K.jobMeta, font: 'bold', color: THEME.accent });
    doc.y = top + K.jobTitle + 1.8;
    doc.text(e.school, { size: K.jobMeta + 0.7, font: 'italic', color: THEME.soft });
    doc.textRight(e.place, { size: K.jobMeta, color: THEME.soft });
    doc.y += K.jobMeta + 2;
  });
  R.CERTIFICATIONS.forEach(c => {
    const nameLines = wrap(c.name, K.bullet, 'bold', F.w - K.bulletIndent - 4);
    need(nameLines.length * K.bulletLead + K.bulletGap);
    const top = doc.y;
    doc.dot(F.x + 2.6, top + K.bullet * 0.33, K.dotR);
    nameLines.forEach((line, i) => {
      doc.y = top + i * K.bulletLead;
      doc.text(line, { at: F.x + K.bulletIndent, size: K.bullet, font: 'bold', color: THEME.ink });
      if (i === nameLines.length - 1) {
        const w = textWidth(line, K.bullet, 'bold');
        doc.text(`\u2014 ${c.org}`, { at: F.x + K.bulletIndent + w + 6, size: K.bullet - 0.5, color: THEME.soft });
      }
    });
    doc.y = top + nameLines.length * K.bulletLead + K.bulletGap;
  });

  doc.mark('education + certifications', m0);

  /* ── colophon ─────────────────────────────────────────────────────────── */
  const total = doc.pages.length;
  doc.pages.forEach((_, i) => {
    const saved = doc.y;
    /* cursor space: y grows downward, so the footer lives near y = page height */
    doc.y = THEME.page.h - 15;
    doc.hr(doc.y - 8, THEME.faint, 0.4);       // rule just above the footer line
    if (total > 1) doc.text(`Page ${i + 1} of ${total}`, { size: 7.6, color: THEME.faint });
    else doc.text('References available on request', { size: 7.6, color: THEME.faint });
    doc.textRight(R.PERSON.email, { size: 7.6, color: THEME.faint, link: `mailto:${R.PERSON.email}` });
    doc.y = saved;
  });

  return doc;
}

/* ═══════════════════════════════════════════ 7. serialisation (PDF 1.4) ══ */

export function serialise(doc, meta = {}) {
  const objs = [];                                   // 1-based ids
  const add = o => { objs.push(o); return objs.length; };
  const ref = id => `${id} 0 R`;

  /* fonts first — nothing has to be patched afterwards */
  const fontIds = {};
  for (const [k, f] of Object.entries(FONTS)) {
    fontIds[k] = add({ dict: `<< /Type /Font /Subtype /Type1 /BaseFont /${f.name} /Encoding /WinAnsiEncoding >>` });
  }

  const pageIds = doc.pages.map(() => add(null));                  // placeholders
  const contentIds = doc.pages.map(p => add({ stream: p.ops.join('\n') + '\n' }));

  const annotIds = doc.pages.map(p => p.annots.map(a => add({
    dict: `<< /Type /Annot /Subtype /Link /Rect [${a.rect.map(num).join(' ')}] `
      + `/Border [0 0 0] /F 4 /A << /S /URI /URI ${pdfString(a.uri)} >> >>`
  })));

  doc.pages.forEach((p, i) => {
    objs[pageIds[i] - 1] = {
      dict: `<< /Type /Page /Parent PAGESREF /MediaBox [0 0 ${num(THEME.page.w)} ${num(THEME.page.h)}] `
        + `/Resources << /Font << /F1 ${ref(fontIds.body)} /F2 ${ref(fontIds.bold)} /F3 ${ref(fontIds.italic)} >> >> `
        + `/Contents ${ref(contentIds[i])}`
        + (annotIds[i].length ? ` /Annots [${annotIds[i].map(ref).join(' ')}]` : '')
        + ' >>'
    };
  });

  const pagesId = add({
    dict: `<< /Type /Pages /Count ${doc.pages.length} /Kids [${pageIds.map(ref).join(' ')}] >>`
  });

  const now = meta.date instanceof Date ? meta.date : new Date();
  const stamp = `D:${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    + `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}Z`;
  const infoId = add({
    dict: `<< /Title ${pdfString(meta.title || `${R.PERSON.name} — ${R.PERSON.role}`)} `
      + `/Author ${pdfString(R.PERSON.name)} /Subject ${pdfString(R.PERSON.headline)} `
      + `/Keywords ${pdfString(meta.keywords || '')} `
      + `/Creator ${pdfString('make-pdf.js — résumé engine, zero dependencies')} `
      + `/Producer ${pdfString('portfolio/build.js')} /CreationDate (${stamp}) /ModDate (${stamp}) >>`
  });

  const catalogId = add({ dict: `<< /Type /Catalog /Pages ${ref(pagesId)} >>` });

  /* ---- bytes ---- */
  const chunks = [];
  const offsets = new Array(objs.length + 1).fill(0);
  let pos = 0;
  const put = s => { const b = Buffer.from(s, 'latin1'); chunks.push(b); pos += b.length; };

  put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');

  objs.forEach((o, i) => {
    offsets[i + 1] = pos;
    if (o.stream != null) {
      const raw = Buffer.from(o.stream, 'latin1');
      put(`${i + 1} 0 obj\n<< /Length ${raw.length} >>\nstream\n`);
      put(raw.toString('latin1'));
      /* the EOL that must precede `endstream` is a delimiter, not stream data,
         so it sits outside /Length — a reader consumes exactly /Length bytes */
      put('\nendstream\nendobj\n');
    } else {
      put(`${i + 1} 0 obj\n${o.dict.replaceAll('PAGESREF', ref(pagesId))}\nendobj\n`);
    }
  });

  const xref = pos;
  put(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objs.length; i++) put(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size ${objs.length + 1} /Root ${ref(catalogId)} /Info ${ref(infoId)} >>\nstartxref\n${xref}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

/* ══════════════════════════════════════════════ 7b. even spacing pass ══ */

/**
 * Because a page break cascades — once a bullet doesn't fit, everything after
 * it moves to page 2 as well — there is always a band of leftover points at
 * the bottom that uniform tightening can't spend. Rather than leave the page
 * bottom-heavy with dead space, find the largest spacing that still fits on one
 * page and hand the slack back to the gaps.
 *
 * render() is deterministic and monotonic in `spacing`, so this is a bisection
 * on one number. Returns the spacing to use.
 */
export function balance({ attempts = 14, maxExtra = 6, target = 1 } = {}) {
  const fits = spacing => render({ spacing }).pages.length <= target;
  if (!fits({})) return {};                       // already overflowing: leave it
  let lo = 0, hi = maxExtra;
  if (fits(scale(hi))) return scale(hi);          // roomy page, take it all
  for (let i = 0; i < attempts; i++) {
    const mid = (lo + hi) / 2;
    if (fits(scale(mid))) lo = mid;
    else hi = mid;
  }
  return scale(lo * 0.97);                        // a hair under the cliff edge
}

/* The multiplier shape: section gaps take most of the slack, line spacing the
   least — so the page opens up between ideas, never inside a sentence. */
function scale(s) {
  return {
    sectionBefore: S.sectionBefore + s,
    sectionAfter: S.sectionAfter + s * 0.7,
    jobGap: S.jobGap + s * 0.8,
    skillLead: S.skillLead + s * 0.25,
    bulletLead: S.bulletLead + s * 0.12
  };
}

/* ═════════════════════════════════════════════════ 8. plain-text export ══ */

export function writeText(cols = 78) {
  const L = [];
  const rule = ch => ch.repeat(cols);
  const push = (label, text, indent = 0) => {
    const lines = wrapChars(text, cols - indent);
    L.push(' '.repeat(indent) + (label ? label.padEnd(indent) + lines[0] : lines[0]));
    for (const line of lines.slice(1)) L.push(' '.repeat(indent) + line);
  };

  L.push(R.PERSON.name.toUpperCase());
  L.push(R.PERSON.headline);
  L.push(...wrapChars(`${R.PERSON.phone} | ${R.PERSON.email} | ${R.PERSON.linkedinLabel} | ${R.PERSON.place}`, cols));
  L.push('');

  L.push('PROFESSIONAL SUMMARY', rule('-'));
  L.push(...wrapChars(R.SUMMARY, cols), '');

  L.push('TECHNICAL SKILLS', rule('-'));
  const LBL = 24;
  for (const g of R.SKILLS) {
    const lines = wrapChars(g.items.join(', '), cols - LBL);
    L.push(g.group.padEnd(LBL) + lines[0]);
    for (const line of lines.slice(1)) L.push(' '.repeat(LBL) + line);
  }
  L.push('');

  L.push('PROFESSIONAL EXPERIENCE', rule('-'));
  for (const j of R.EXPERIENCE) {
    L.push(...wrapChars(j.company, cols));
    L.push(...wrapChars(`${j.role} | ${j.when} | ${j.place}`, cols));
    for (const b of j.bullets) push('', '\u2022 ' + b, 2);
    L.push('');
  }

  L.push('EDUCATION', rule('-'));
  for (const e of R.EDUCATION) {
    L.push(...wrapChars(e.degree, cols));
    L.push(...wrapChars(`${e.school} | ${e.place} | ${e.when}`, cols), '');
  }

  L.push('CERTIFICATIONS', rule('-'));
  for (const c of R.CERTIFICATIONS) push('', '\u2022 ' + c.name + ' \u2014 ' + c.org, 2);
  L.push('');

  L.push('KEY ACHIEVEMENTS', rule('-'));
  for (const a of R.ACHIEVEMENTS) push('', '\u2022 ' + a, 2);

  L.push('', rule('-'));
  L.push('Plain-text version of Jayesh-Deshmukh-Resume.pdf — same content,');
  L.push('no layout, so applicant tracking systems parse every field.');
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/* ═══════════════════════════════════════════════════════════════ 9. CLI ══ */

export function build({ dir = __dirname, quiet = false, date, balance: doBalance = true } = {}) {
  const doc = render({ spacing: doBalance ? balance() : {} });
  const pdf = serialise(doc, {
    title: `${R.PERSON.name} — ${R.PERSON.role} | Dynamics 365 & Azure`,
    keywords: 'Dynamics 365, D365 CRM, Project Operations, Power Platform, Power Automate, Power BI, Azure Functions, C#, .NET Core, SAP integration, REST API, CRM Developer, Pune, India',
    date
  });

  const pdfPath = path.join(dir, `${R.FILE_STEM}.pdf`);
  const txtPath = path.join(dir, `${R.FILE_STEM}.txt`);
  fs.writeFileSync(pdfPath, pdf);
  fs.writeFileSync(txtPath, writeText(), 'utf8');

  const stat = {
    pages: doc.pages.length,
    bytes: pdf.length,
    links: doc.links.length,
    pdf: path.basename(pdfPath),
    txt: path.basename(txtPath),
    objects: undefined
  };
  if (!quiet) {
    console.log(`  ${stat.pdf}   ${(stat.bytes / 1024).toFixed(1)} kB · ${stat.pages} page${stat.pages > 1 ? 's' : ''} · ${stat.links} clickable links`);
    console.log(`  ${stat.txt}   ${(fs.statSync(txtPath).size / 1024).toFixed(1)} kB · plain text for ATS parsers`);
  }
  return stat;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invoked) build();
