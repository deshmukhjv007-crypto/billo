/* ============================================================================
   test/page.test.mjs — the *built page*, asserted as text.

   boot.test.mjs boots the JavaScript against a stub DOM; this one checks the
   static artefact build.js writes, because the most expensive bugs on a
   portfolio are the ones that only show up in the HTML: a download link that
   points at a file nobody built, a section that renders "undefined", a
   data-art name with no drawing behind it, or a résumé button that stops
   working when JS is switched off.
   ========================================================================== */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as C from '../content.js';
import { PERSON, SKILLS, EXPERIENCE } from '../resume.js';
import { findPhoto } from '../photo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const has = s => html.includes(s);
const count = re => (html.match(re) || []).length;
/* build.js escapes text on the way into the markup, so allow for that here */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hasText = s => html.includes(esc(s));

/* ------------------------------------------------------------ the artefact */

test('page: index.html exists, is reasonably sized, and leaks nothing', () => {
  assert.ok(html.length > 12000, 'index.html looks truncated');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html.trimEnd(), /<\/html>$/);
  for (const bad of ['undefined', 'NaN', '[object Object]', 'TODO', 'FIXME']) {
    assert.ok(!has(bad), `the built page contains "${bad}" — a template hole`);
  }
});

test('page: every local reference resolves to a file on disk', () => {
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1])
    .filter(u => !/^(https?:|mailto:|tel:|#|data:)/.test(u));
  assert.ok(refs.length >= 6, 'expected stylesheets, scripts and the résumé');
  for (const ref of new Set(refs)) {
    const file = ref.replace(/^\.\//, '').split('#')[0];
    assert.ok(fs.existsSync(path.join(ROOT, file)), `index.html references a missing file: ${ref}`);
  }
});

/* ----------------------------------------------------------- the download */

test('page: the résumé download is a real, complete, JS-free <a download>', () => {
  const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)]
    .filter(m => m[1].endsWith('.pdf'));
  assert.ok(anchors.length >= 3, `expected the download in header, hero and résumé section (found ${anchors.length})`);
  for (const a of anchors) {
    assert.ok(/\sdownload(\s|>)/.test(a[0]), `a résumé link is missing the download attribute: ${a[0].slice(0, 80)}`);
  }
  // the file it points at must be the file make-pdf.js writes
  assert.ok(fs.existsSync(path.join(ROOT, `${PERSON.name.replace(/\s+/g, '-')}-Resume.pdf`)) || has(`${C.FILE_STEM}.pdf`));
  assert.ok(fs.statSync(path.join(ROOT, `${C.FILE_STEM}.pdf`)).size > 8000, 'the PDF is suspiciously small');
});

test('page: the plain-text twin and the print escape hatch are offered', () => {
  assert.ok(has(`${C.FILE_STEM}.txt`), 'no .txt link for ATS portals');
  assert.ok(/href="\.\/[^"]+\.txt"[^>]*download/.test(html), 'the .txt link is not a download');
  assert.ok(has('data-act="print"'), 'no print button');
});

test('page: the résumé still downloads with JavaScript disabled', () => {
  const noscript = html.slice(html.indexOf('<noscript>'), html.indexOf('</noscript>'));
  assert.ok(noscript.includes(`${C.FILE_STEM}.pdf`), 'the <noscript> fallback does not offer the résumé');
  assert.ok(/download/.test(noscript));
});

test('page: the résumé section shows what the download actually contains', () => {
  assert.ok(has('id="resume"'), 'no résumé section');
  assert.ok(has('class="paper"'), 'no document preview');
  assert.ok(has('PDF ·'), 'the file size/kind is not shown on the button');
  /* the section headings are title case in the markup and uppercased in CSS */
  for (const needle of ['Professional Summary', 'Technical Skills', 'Professional Experience', 'Education &amp; Certifications', 'Key Achievements', 'Jayesh Deshmukh']) {
    assert.ok(has(needle), `the preview is missing "${needle}"`);
  }
  // the preview must describe the same person as the PDF
  assert.ok(has(PERSON.phone), 'phone missing from the preview');
  assert.ok(has(PERSON.email), 'email missing from the preview');
  assert.ok(has(PERSON.linkedinLabel), 'LinkedIn missing from the preview');
});

/* ------------------------------------------------------------- structure */

test('page: the content model and the markup agree', () => {
  for (const r of C.ROLES) {
    assert.ok(has(`id="${r.id}"`), `role section ${r.id} is missing`);
    assert.ok(has(`data-shape="${r.art}"`), `role ${r.id} lost its drawing`);
    for (const b of r.bullets) {
      assert.ok(hasText(b.slice(0, 48)), `bullet missing from the page: ${b.slice(0, 48)}…`);
    }
  }
  for (const k of C.KIT) assert.ok(hasText(k.k), `skill group ${k.k} missing`);
  for (const s of C.HIGHLIGHTS) assert.ok(has(s.n) && hasText(s.label), `stat ${s.n} missing`);
  for (const n of C.NAV) assert.ok(has(`id="${n.id}"`) && has(`href="#${n.id}"`), `nav target ${n.id} is broken`);
  for (const s of C.ME.socials) assert.ok(has(s.href), `social link ${s.label} missing`);
});

test('page: every drawing the markup asks for exists in content.js', () => {
  const known = k => k in C.ART || k in C.TEXT_ART;
  const asked = new Set([
    ...[...html.matchAll(/data-shape="([^"]+)"/g)].map(m => m[1]),
    ...[...html.matchAll(/data-art="([^"]+)"/g)].map(m => m[1])
  ]);
  assert.ok(asked.size >= 5, 'expected several distinct drawings');
  for (const a of asked) assert.ok(known(a), `the page asks for art "${a}", which content.js does not define`);
});

test('page: structure is sane — one h1, no duplicate ids, headings in order', () => {
  assert.equal(count(/<h1[\s>]/g), 1, 'exactly one h1 makes the page outline readable');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
  const levels = [...html.matchAll(/<(h[1-3])[\s>]/g)].map(m => Number(m[1][1]));
  assert.equal(levels[0], 1, 'the page should open with the h1');
  for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i] - levels[i - 1] <= 1, `heading jumps h${levels[i - 1]} → h${levels[i]} at ${i}`);
  }
  // landmarks
  for (const sel of ['<header', '<main', '<footer', '<nav', 'class="skip"']) {
    assert.ok(has(sel), `missing ${sel}`);
  }
});

test('page: SEO and sharing metadata are complete and valid JSON-LD', () => {
  assert.match(html, /<title>[^<]*Jayesh Deshmukh[^<]*<\/title>/);
  assert.ok(/<meta name="description" content="[^"]{80,}"/.test(html), 'description too thin');
  assert.ok(has('rel="canonical"'));
  assert.ok(has('property="og:title"') && has('property="og:description"'));
  assert.ok(has('name="viewport"'));
  assert.ok(has('rel="alternate" type="application/pdf"'));

  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(ld, 'no structured data');
  const data = JSON.parse(ld[1]);
  assert.equal(data['@type'], 'Person');
  assert.equal(data.name, PERSON.name);
  assert.equal(data.email, `mailto:${PERSON.email}`);
  assert.equal(data.telephone, PERSON.phone);
  assert.ok(data.address.addressLocality === 'Pune');
  assert.ok(Array.isArray(data.knowsAbout) && data.knowsAbout.length >= 10);
  for (const skill of ['C#', 'Dynamics 365']) assert.ok(data.knowsAbout.some(s => s.includes(skill)), `${skill} missing from knowsAbout`);
});

test('page: accessibility basics hold', () => {
  assert.ok(has('aria-hidden="true"') , 'decorative layers should be hidden from the a11y tree');
  assert.ok(has('role="status"') || has('aria-live'), 'the toast region needs a live role');
  assert.ok(has('aria-label="Sections"'), 'nav landmarks need labels');
  assert.ok(/class="portrait[^"]*"[^>]*data-magnet-host/.test(html), 'the portrait needs its magnet host');
  assert.ok(/class="monogram"[^>]*role="img"[^>]*aria-label="Jayesh Deshmukh"|alt="Jayesh Deshmukh"/.test(html),
    'the portrait must be described for a screen reader, as an image label or alt text');
  // decorative canvases must not be announced
  assert.match(html, /<canvas class="field" aria-hidden="true">/);
  // the hero's image — monogram or photo — must name the person
  const portraitOk = /class="monogram"[^>]*role="img"[^>]*aria-label="Jayesh Deshmukh"/.test(html)
    || /<img class="portrait-img"[^>]*alt="Jayesh Deshmukh"/.test(html);
  assert.ok(portraitOk, 'the hero image must be labelled for a screen reader');
});

test('page: the portrait slot is honest about whether a photo exists', () => {
  /* Uses the same discovery as build.js, so "the test passed" means the
     asset actually reached the markup. */
  const found = findPhoto(ROOT, C.ME.photo);
  if (found) {
    assert.ok(has(`<img class="portrait-img" src="${found}"`), `a photo exists at ${found} but is not in the markup`);
    assert.ok(has(`alt="${PERSON.photoAlt}"`), 'the photo needs descriptive alt text');
    assert.ok(fs.statSync(path.join(ROOT, found)).size > 2000, 'that photo file looks empty');
    assert.ok(!/class="monogram"/.test(html), 'both a photo and the monogram were rendered');
  } else {
    assert.ok(has('class="monogram"'), 'no photo and no monogram: the hero would be empty');
    assert.ok(!has('class="portrait-img"'), 'a broken <img> was rendered for a missing photo');
  }
  // either way the frame is clipped, so the crop cannot spill onto the page
  assert.match(html, /class="portrait-frame"/, 'the portrait needs its clipping frame');
});

test('css: nothing in the background animates forever', () => {
  /* Regression, from a reader's report: "the background keeps rocking".
     Two culprits. The blueprint drawing had a 9s scale-and-rotate "breathe"
     loop on a full-viewport SVG, and the grain sprite teleported 400-570px
     per frame — both of which read as the page rocking under you.

     Only the ticker marquee is allowed a perpetual animation. Everything else
     must be a finite, one-shot animation or nothing at all. */
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const ALLOWED = ['.track', '.ticker:hover .track', '.ticker:focus-within .track'];

  const offenders = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim().split('\n').pop().trim();
    const body = rule[2];
    if (!/animation[^;]*\binfinite\b/.test(body)) continue;
    if (ALLOWED.some(a => selector.includes(a))) continue;
    offenders.push(`${selector} → ${(body.match(/animation[^;]*/) || [''])[0].trim()}`);
  }
  assert.deepEqual(offenders, [], `perpetual animations in the background:\n  ${offenders.join('\n  ')}`);

  /* and the specific one that was removed should not come back */
  assert.ok(!/@keyframes\s+breathe/.test(css), 'the "breathe" rocking keyframe is back');
  assert.ok(!/\.js\.motion \.blueprint\s*\{[^}]*animation/.test(css), 'the blueprint is animating itself again');
  /* and no *background* layer may be transformed on two axes (the shape of the
     grain teleport). Scoped to the layers that sit behind the content, because
     ordinary components are allowed to move on both axes. */
  const LAYERS = ['.grain', '.grain .g-film', '.grain .g-film i', '.g-film i', '.field', '.blueprint', '.bg-wash', '.bg-grid', '.vignette'];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim().split('\n').pop().trim();
    if (!LAYERS.some(l => selector === l || selector.startsWith(l + ' '))) continue;
    const m = rule[2].match(/translate3?d\(([^)]*)\)/);
    if (!m) continue;
    const parts = m[1].split(',').map(x => x.trim());
    const moving = parts.slice(0, 2).filter(x => x && x !== '0' && x !== '0px' && x !== '0%');
    assert.ok(moving.length <= 1, `background layer "${selector}" translates on ${moving.length} axes: ${m[0]}`);
  }
});

test('css: the grain holds still unless motion is switched on', () => {
  const grain = fs.readFileSync(path.join(ROOT, 'js/grain.js'), 'utf8');
  assert.match(grain, /filmAnimate:\s*false/, 'grain animation must be opt-in');
  /* the Y-axis term that caused the teleport must be gone from the animation */
  const keyframes = grain.slice(grain.indexOf('export function grainKeyframes'), grain.indexOf('export function filmSprite'));
  assert.ok(keyframes.length > 100, 'grainKeyframes() disappeared');
  assert.ok(!/%\s*5/.test(keyframes), 'the `(f * 37) % 5` Y-jump term is back');
  assert.ok(!/dy/i.test(keyframes), 'grainKeyframes must not compute a second axis');
});

test('page: the résumé bullets on the page are the CV bullets, verbatim', () => {
  /* The whole point of importing resume.js into content.js: if someone edits a
     bullet on the CV, the page must change with it. This is the tripwire. */
  for (const job of EXPERIENCE) {
    for (const b of job.bullets) {
      const escaped = b.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      assert.ok(html.includes(escaped), `the page is out of sync with resume.js: "${b.slice(0, 56)}…"`);
    }
  }
  for (const g of SKILLS) {
    assert.ok(html.includes(g.items.join(' · ').replace(/&/g, '&amp;')), `skills drifted: ${g.group}`);
  }
});
