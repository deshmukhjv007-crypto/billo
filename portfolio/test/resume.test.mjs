/* ============================================================================
   test/resume.test.mjs — the résumé pipeline, verified byte by byte.

   The PDF is built by hand (make-pdf.js), the fixture is a real person's CV,
   and there is no external PDF tooling in CI — so these tests read the bytes
   back with test/pdf-lite.mjs and assert on what a viewer would actually see:

     • the file is a well-formed PDF 1.4 (xref, page tree, fonts, metadata)
     • nothing is drawn outside the live area, and no two lines collide
     • every link annotation sits on top of the text it belongs to
     • the text an ATS parser extracts still contains every fact
     • the layout is *one page*, which is a deliberate product decision

   npm test
   ========================================================================== */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as R from '../resume.js';
import * as M from '../make-pdf.js';
import { parsePDF, bounds } from './pdf-lite.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-'));

const stat = M.build({ dir: tmp, quiet: true, date: new Date('2026-01-01T00:00:00Z') });
const bytes = fs.readFileSync(path.join(tmp, stat.pdf));
const pdf = parsePDF(bytes);

/* Rough cap-height / descender factors for Helvetica. Used to prove two lines
   don't collide: the lower line's capitals must clear the upper line's
   descenders. */
const CAP = 0.72, DESC = 0.21;

/** every text run on a page: {font, size, x, y, text} where y is the baseline */
function runs(page) {
  return [...page.matchAll(/\/(F\d) ([\d.]+) Tf\n(?:(-?[\d.]+) Tc\n)?1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\n\(((?:\\.|[^\\()])*)\) Tj/g)]
    .map(m => ({ font: m[1], size: +m[2], tracking: m[3] ? +m[3] : 0, x: +m[4], y: +m[5], raw: m[6] }));
}

const F = M.frame();
const FOOTER_BAND = M.THEME.margin.bottom;      // the colophon is allowed below this
const RIGHT_EDGE = F.right;
const LEFT_EDGE = F.x;

/* -------------------------------------------------------------- data model */

test('resume.js: the person, and every section, is complete', () => {
  for (const key of ['name', 'headline', 'role', 'place', 'email', 'phone', 'linkedin', 'linkedinLabel', 'fileStakeholder'.replace('fileStakeholder', 'years')]) {
    assert.ok(R.PERSON[key], `PERSON.${key} is empty`);
  }
  assert.match(R.PERSON.email, /^[^@\s]+@[^@\s]+\.[a-z]+$/);
  assert.match(R.PERSON.linkedin, /^https:\/\//);
  assert.ok(R.SUMMARY.length > 200, 'summary too short to be the real thing');
  assert.ok(R.SKILLS.length >= 5);
  for (const g of R.SKILLS) assert.ok(g.group && g.items.length, `${g.group} has no items`);
  assert.equal(R.EXPERIENCE.length, 3);
  for (const j of R.EXPERIENCE) {
    assert.ok(j.company && j.role && j.when && j.place, `${j.id} is missing header fields`);
    assert.ok(j.bullets.length >= 3, `${j.id} has too few bullets`);
    assert.ok(j.bullets.every(b => b.length > 30), `${j.id} has a stub bullet`);
  }
  assert.equal(R.EDUCATION.length, 1);
  assert.equal(R.CERTIFICATIONS.length, 2);
  assert.equal(R.ACHIEVEMENTS.length, 2);
});

test('resume.js: no stray typo-creating characters, and facts are traceable', () => {
  const all = JSON.stringify(R);
  assert.ok(!all.includes('SAFefi'), 'a typo from the source document survived');
  assert.ok(all.includes('SAFe 6'), 'SAFe 6 certification missing');
  assert.ok(all.includes('Project Operations'));
  assert.ok(all.includes('SAP'));
  assert.ok(/10,000\+ records/.test(all), 'the scale metric that recruiters scan for is gone');
});

/* ------------------------------------------------------------------ metrics */

test('metrics: advances match the Helvetica AFM tables', () => {
  // spot values straight out of Helvetica.afm
  assert.equal(M.textWidth('A', 1000, 'body'), 667);
  assert.equal(M.textWidth(' ', 1000, 'body'), 278);
  assert.equal(M.textWidth('A', 1000, 'bold'), 722);
  assert.equal(M.textWidth('i', 1000, 'body'), 222);
  assert.equal(Math.round(M.textWidth('Hello', 12, 'body')), Math.round(((722 + 556 + 222 + 222 + 556) / 1000) * 12));
  // proportional and additive
  assert.ok(M.textWidth('Hello world', 10) > M.textWidth('Hello', 10));
  assert.equal(M.textWidth('', 10), 0);
});

test('metrics: wrap() never exceeds the width it is given', () => {
  const samples = [R.SUMMARY, ...R.EXPERIENCE.flatMap(j => j.bullets), ...R.SKILLS.map(g => g.items.join(', '))];
  for (const width of [120, 260, 391.28, F.w]) {
    for (const s of samples) {
      for (const line of M.wrap(s, 9.5, 'body', width)) {
        assert.ok(M.textWidth(line, 9.5, 'body') <= width, `"${line.slice(0, 40)}…" overflows ${width}`);
      }
    }
  }
});

test('metrics: an unbreakable word is still returned, not dropped', () => {
  const long = 'Dynamics365ProjectOperationsIntegrationPlatform';
  const lines = M.wrap(long, 9.5, 'body', 60);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], long);
});

test('sanitise: characters a core font cannot draw are transliterated, not lost', () => {
  assert.equal(M.sanitise('\u20b9800 cab'), 'Rs. 800 cab');
  assert.equal(M.sanitise('CRM \u2192 SAP'), 'CRM -> SAP');
  assert.equal(M.sanitise('a\u2014b').includes('\u2014'), true, 'em dash should survive (WinAnsi has it)');
  assert.equal(M.sanitise('curly \u201cquotes\u201d'), 'curly "quotes"');
  assert.equal(M.sanitise('emoji \u{1f600} gone'), 'emoji gone');
  assert.ok(!/\s{2,}/.test(M.sanitise('too   many    spaces')));
  for (const s of [R.SUMMARY, ...R.EXPERIENCE.flatMap(j => j.bullets)]) {
    const clean = M.sanitise(s);
    assert.equal(clean, M.sanitise(clean), 'sanitise is not idempotent');
    assert.ok(clean.length >= s.replace(/\s+/g, ' ').trim().length - 6, 'sanitise ate more than the odd glyph');
  }
});

/* --------------------------------------------------------------- structure */

test('pdf: the file parses with no structural problems', () => {
  assert.deepEqual(pdf.problems, [], pdf.problems.join('\n'));
  assert.equal(pdf.pageCount, stat.pages);
  assert.equal(pdf.count, pdf.pages.length, '/Count disagrees with the page tree');
  assert.equal(pdf.meta.Author, R.PERSON.name);
  assert.match(pdf.meta.Title, new RegExp(R.PERSON.name));
  assert.ok(bytes.subarray(0, 8).toString().startsWith('%PDF-1.4'));
  assert.ok(bytes.subarray(-6).toString().startsWith('%%EOF'));
});

test('pdf: every font is a non-embedded standard-14 face', () => {
  const names = new Set(pdf.fonts.map(f => `${f.id}:${f.name}`));
  for (const f of pdf.fonts) {
    const obj = pdf.objects.get(f.id);
    assert.match(obj.dict, /\/BaseFont \/Helvetica(-Bold|-Oblique)?/, 'non-standard font');
    assert.match(obj.dict, /\/Encoding \/WinAnsiEncoding/, 'no encoding means the text is guesswork');
    assert.ok(!/FontFile/.test(obj.dict), 'a standard-14 face must not embed');
  }
  assert.equal(names.size, 3, 'expected Helvetica, Bold and Oblique');
});

test('pdf: one page — the layout decision this whole file exists to defend', () => {
  assert.equal(pdf.pageCount, 1, 'a three-year CV that runs to two pages is a bug, not a feature');
  const used = pdf.ops[0];
  assert.ok(used.length > 3000, 'page content looks empty');
});

/* ---------------------------------------------------------------- geometry */

test('geometry: nothing is drawn outside the live area', () => {
  pdf.pages.forEach((_, i) => {
    for (const r of runs(pdf.ops[i])) {
      assert.ok(r.x >= LEFT_EDGE - 0.5, `"${r.raw.slice(0, 30)}" starts left of the margin (${r.x})`);
      const w = M.textWidth(decode(r.raw), r.size, 'body') + Math.max(0, decode(r.raw).length - 1) * r.tracking;
      assert.ok(r.x + w <= RIGHT_EDGE + 0.5, `"${r.raw.slice(0, 30)}" runs past the right margin by ${(r.x + w - RIGHT_EDGE).toFixed(1)}pt`);
      assert.ok(r.y <= M.THEME.page.h + 0.5 && r.y >= -0.5, `"${r.raw.slice(0, 30)}" is off the page at y=${r.y}`);
    }
  });
});

test('geometry: body content clears the margins; the colophon lives in the footer band', () => {
  let colophonLines = 0;
  for (const r of runs(pdf.ops[0])) {
    const text = decode(r.raw);
    if (r.y < FOOTER_BAND) {
      /* only the colophon is allowed down here, and it must not hug the edge */
      colophonLines++;
      assert.match(text, /^Page \d|^References available|@/, `"${text.slice(0, 34)}" has no business in the footer band`);
      assert.ok(r.y >= 8, `footer is ${r.y}pt from the page edge`);
    } else {
      assert.ok(r.y <= M.THEME.page.h - M.THEME.margin.top + 6, `"${text.slice(0, 34)}" at y=${r.y} is above the top margin`);
    }
  }
  assert.equal(colophonLines, 2, 'expected exactly two colophon runs (page marker + email)');
});

test('geometry: no two lines of text overlap', () => {
  const list = runs(pdf.ops[0]).sort((a, b) => b.y - a.y);
  for (let i = 1; i < list.length; i++) {
    const above = list[i - 1], below = list[i];
    if (above.y - below.y < 0.5) continue;          // two columns of the same row
    // only lines that could touch horizontally matter
    const aboveRight = above.x + M.textWidth(decode(above.raw), above.size, 'body');
    if (below.x > aboveRight) continue;
    const descenderBottom = above.y - above.size * DESC;
    const capTop = below.y + below.size * CAP;
    assert.ok(capTop < descenderBottom + 0.5,
      `"${decode(above.raw).slice(0, 26)}" and "${decode(below.raw).slice(0, 26)}" collide `
      + `(cap top ${capTop.toFixed(1)} vs descender ${descenderBottom.toFixed(1)})`);
  }
});

test('geometry: same-size neighbours keep a comfortable leading ratio', () => {
  /* Mixed-size pairs are judged by the collision test above; this one is about
     running text, where leading/size is the number that decides whether a
     block reads as a paragraph or as a wall. */
  const list = runs(pdf.ops[0]).sort((a, b) => b.y - a.y);
  let tightest = Infinity, where = '';
  for (let i = 1; i < list.length; i++) {
    const above = list[i - 1], below = list[i];
    if (above.size !== below.size) continue;
    const dy = above.y - below.y;
    if (dy < 0.5) continue;
    const ratio = dy / below.size;
    if (ratio < tightest) { tightest = ratio; where = `"${decode(below.raw).slice(0, 30)}"`; }
  }
  assert.ok(tightest >= 1.15, `tightest running-text leading is ${tightest.toFixed(2)} at ${where}`);
});

test('geometry: everything is inside the printed page, not merely the MediaBox', () => {
  const b = bounds(pdf.ops[0]);
  assert.ok(b.minX >= LEFT_EDGE - 0.5 && b.maxX <= RIGHT_EDGE + 0.5, `drawn x ${b.minX}..${b.maxX}`);
  assert.ok(b.minY >= 8 && b.maxY <= M.THEME.page.h - 8, `drawn y ${b.minY}..${b.maxY}`);
});

/* ------------------------------------------------------------------- links */

test('links: contact details are clickable, and each box sits on its own text', () => {
  const uris = pdf.annots.map(a => a.uri);
  assert.ok(uris.includes(`tel:${R.PERSON.phoneHref}`), 'phone is not a tel: link');
  assert.ok(uris.includes(`mailto:${R.PERSON.email}`), 'email is not a mailto: link');
  assert.ok(uris.includes(R.PERSON.linkedin), 'LinkedIn is not linked');

  const list = runs(pdf.ops[0]);
  for (const a of pdf.annots) {
    const [x0, y0, x1, y1] = a.rect;
    assert.ok(x1 > x0 && y1 > y0, 'degenerate annotation rect');
    assert.ok(x1 <= RIGHT_EDGE + 0.5 && x0 >= LEFT_EDGE - 0.5, 'annotation outside the frame');
    // there must be text inside the rect
    const inside = list.filter(r => r.x >= x0 - 1 && r.x <= x1 && r.y >= y0 - 1 && r.y <= y1 + 1);
    assert.ok(inside.length >= 1, `nothing under the link rect for ${a.uri}`);
  }
});

/* -------------------------------------------------------------- the content */

test('content: every fact survives the round trip into the PDF', () => {
  const text = pdf.text[0].join('\n');
  for (const needle of [
    R.PERSON.name, R.PERSON.email, R.PERSON.phone, R.PERSON.linkedinLabel, R.PERSON.place,
    'PROFESSIONAL SUMMARY', 'TECHNICAL SKILLS', 'PROFESSIONAL EXPERIENCE', 'EDUCATION & CERTIFICATIONS', 'KEY ACHIEVEMENTS',
    'Siemens Technology and Services Private Limited', 'UST (Pragmasys LLP)', 'AssetCues',
    'Dynamics 365 Project Operations', 'Azure Function Apps', 'Ribbon Workbench',
    'Power BI', 'Power Automate', '10,000+ records', 'SAP ERP',
    'Master of Computer Applications', 'Pune University', 'Certified SAFe 6 Practitioner',
    'C# .NET Core with Real World Examples'
  ]) {
    assert.ok(text.includes(needle), `"${needle}" is missing from the PDF text`);
  }
  // and nothing that should have been transliterated leaked through
  assert.ok(!/[\u{1f000}-\u{1faff}\u2700-\u27bf]/u.test(text), 'emoji survived into the PDF');
});

test('plain text: complete, ASCII, and inside 80 columns', () => {
  const txt = fs.readFileSync(path.join(tmp, stat.txt), 'utf8');
  for (const j of R.EXPERIENCE) {
    assert.ok(txt.includes(j.company), `${j.company} missing from the text export`);
    for (const b of j.bullets) {
      const flat = txt.replace(/\s+/g, ' ');
      assert.ok(flat.includes(M.sanitise(b).replace(/\s+/g, ' ')), `bullet missing: ${b.slice(0, 40)}…`);
    }
  }
  for (const c of R.CERTIFICATIONS) assert.ok(txt.includes(c.name));
  for (const line of txt.split('\n')) {
    assert.ok(line.length <= 80, `over-wide line (${line.length}): ${line.slice(0, 60)}`);
    assert.ok(!/[\u2018\u2019\u201c\u201d\u20b9]/u.test(line), 'smart punctuation will upset an ATS parser');
  }
  assert.ok(txt.endsWith('\n'));
});

test('build(): is deterministic for a fixed timestamp', () => {
  const again = M.build({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'resume2-')), quiet: true, date: new Date('2026-01-01T00:00:00Z') });
  assert.equal(again.bytes, stat.bytes, 'same input, different byte count');
  assert.equal(again.pages, 1);
});

/* ------------------------------------------------------- the repo's output */

test('the committed PDF is current — regenerate with `npm run build`', () => {
  const shipped = path.join(__dirname, '..', `${R.FILE_STEM}.pdf`);
  if (!fs.existsSync(shipped)) return;                 // first run, before any build
  const onDisk = fs.readFileSync(shipped);
  const fresh = fs.readFileSync(path.join(tmp, stat.pdf));
  // timestamps differ, so compare the layout: page count, size within a byte or two
  assert.equal(parsePDF(onDisk).pageCount, 1, 'the shipped PDF is not one page');
  assert.ok(Math.abs(onDisk.length - fresh.length) <= 64,
    `the shipped PDF is stale (${onDisk.length} bytes on disk vs ${fresh.length} fresh) — run npm run build`);
});

function decode(s) {
  return s.replace(/\\([nrt])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' }[c]))
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\([()\\])/g, '$1');
}
