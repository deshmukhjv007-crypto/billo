# hire.rest v5 — the same idea, built better

A rebuild of [hire.rest](https://hire.rest/) as a **zero-dependency** one-pager:
static, crawlable HTML; one canvas of particles that ink themselves into each
drawing; and a grain engine you can tune live and copy out.

```
portfolio/
├── content.js        every word, link and drawing — edit this only
├── build.js          renders index.html from content.js  (node build.js)
├── index.html        generated, static, works with JS off
├── styles.css        design system, dark + light, reduced-motion aware
├── server.js         zero-dep static server (node server.js → :4173)
├── js/
│   ├── bus.js        one event bus + shared frame state (one rAF loop)
│   ├── grain.js      ★ the grain engine + the Grain Lab
│   ├── field.js      the particle field (procedural art, typed arrays)
│   ├── motion.js     scroll velocity, reveals, scrubs, magnets, smooth wheel
│   └── app.js        enhancement layer: theme, palette, wiring
└── test/
    ├── dom-stub.js   forgiving fake DOM (no browser in CI)
    └── boot.test.mjs 13 tests: boots the real app, asserts nothing throws
```

```bash
npm run build   # content.js → index.html
npm start       # http://localhost:4173
npm test        # 13 tests
```

---

## ★ The grain effect on hire.rest, exactly

It is **one CSS rule** in `https://hire.rest/style.css` — technique #1 from the
usual four (SVG `feTurbulence`, tiled PNG, WebGL shader, gradient hacks):

```css
.grain{position:fixed;inset:0;z-index:60;pointer-events:none;opacity:.07;mix-blend-mode:overlay;
 background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:160px}
```

Decoded, that data URI is:

```xml
<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>
  <filter id='n'>
    <feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/>
  </filter>
  <rect width='100%' height='100%' filter='url(#n)'/>
</svg>
```

What each piece is doing:

| Piece | Why it's there |
|---|---|
| `feTurbulence type='fractalNoise'` | Perlin-style **fractal noise** — soft, cloudy, film-like. (`type='turbulence'` would give harder, veinier marble.) |
| `baseFrequency='.9'` | Very high frequency → **fine** grain. ~0.9 cycles/px. Drop to 0.2 and it becomes blotches; raise past 1 and it aliases into moiré. |
| `numOctaves='2'` | Two noise octaves summed: the 2nd adds half-scale detail. More octaves = richer but slower to rasterise. |
| `stitchTiles='stitch'` | Makes the tile **seamless** — without it you'd see a 160px grid of seams. |
| `width/height='160'` + `background-size:160px` | The tile is generated once at 160px and **repeated**; the browser caches it, so scrolling costs nothing. |
| `opacity:.07` | 7% — the "you feel it, you don't see it" number. |
| `mix-blend-mode:overlay` | Multiplies the dark half / screens the light half, so grain bites into mid-tones and leaves pure black/white alone. |
| `position:fixed;inset:0;z-index:60;pointer-events:none` | One full-viewport overlay above the whole page (their header is `z-index:50`), clicking through it. |

Two things worth knowing about that implementation:

1. **It is completely static.** No `@keyframes`, no JS, no seed change — one frozen
   frame of noise for the life of the page. Real film grain *moves*; that's most of
   why it reads as "film".
2. **The noise is coloured.** `feTurbulence` writes RGBA, so each channel gets an
   independent noise value. At 7% overlay it's nearly invisible, but it does tint
   slightly. Add `<feColorMatrix type='saturate' values='0'/>` after it for neutral
   luminance grain.

There is no `<canvas>` grain and no PNG on that site. The canvas (`.field`,
`z-index:0`) is the **particle field** — a separate effect: 4,000 dots
(2,400 on touch) that are sampled out of the seven `.webp` illustrations and fly
into whichever drawing belongs to the section you're in, scattering with scroll
velocity and repelling from your cursor.

---

## What v5 does differently

### Grain — two layers, and it moves

```
.grain                     ← fixed overlay, mix-blend-mode, master opacity
├── .g-turb                ← layer 1: the hire.rest trick, parameterised
│                             (baseFrequency, numOctaves, seed, mono)
└── .g-film > i            ← layer 2: canvas sprite sheet of N noise frames,
                              stepped with translate3d at 8–24 fps
```

* **Layer 2 is the upgrade.** `js/grain.js` builds one PNG sprite sheet
  (`tile × frames` noise frames, triangular-distribution noise shaped by a gamma
  so it reads as silver halide rather than TV static) and cycles it with a
  `steps()` **transform** animation — compositor-only, no repaint of the page.
* **It reacts to you.** Scroll velocity and pointer speed drive the master
  opacity (`reactMax`), with fast attack / slow release, and a click on the word
  *chaos* spikes it. The grain is now part of the physics of the page instead of
  a decal on it.
* **It follows the theme.** `overlay` on dark, `multiply` on light — unless you
  pick a blend mode by hand, which locks it.
* **`prefers-reduced-motion`** keeps layer 1 and drops the animation + reactivity.
* **Grain Lab** (`G`, or the ◍ button): 11 sliders, 4 switches, 8 presets
  (including `hire.rest (theirs)`), randomize, and an **A/B swatch** that renders
  their exact recipe next to yours on identical art. `Copy CSS` emits a
  ready-to-paste rule for your current settings; `Copy full engine` emits a
  standalone ~40-line IIFE you can drop into any site.

### The field — same idea, no image budget

| hire.rest v4 | v5 |
|---|---|
| 7 `.webp` illustrations downloaded, rasterised to 180px, sampled | art is a list of **SVG path strings** in `content.js` — 0 bytes over the wire, resolution independent, and the same paths are injected as the faint "blueprint" line art that draws itself on with `stroke-dashoffset` |
| 4,000 particle objects | Structure-of-arrays `Float32Array`/`Uint8Array` |
| `fillStyle` swapped per particle | 3 batched paths, one `fill()` per colour, `lighter` compositing on the accents |
| fixed particle count | **adaptive**: measures frame time and drops draw density (stride 1→3) before it drops frames |
| morph moves everything at once | per-particle stagger in scanline order, so the drawing **inks itself on** |
| GSAP + ScrollTrigger + Lenis (≈90 kB CDN) | 0 dependencies, one shared rAF loop |
| wheel hijacked always | **native scroll by default**; smooth wheel is opt-in (`S`) |
| runs while the tab is visible | pauses on hidden, on reduced motion, and when no stage is on screen |

### The rest

* **Static, crawlable HTML.** `build.js` renders `index.html` from `content.js`,
  so the copy lives in one place *and* the page works with JS off (there's a
  `<noscript>` block and the blueprint art carries the illustrations).
* **Light theme** that was designed, not inverted (`T`).
* **Command palette** (`⌘K`/`Ctrl K`) over sections, projects, grain presets and
  actions; keyboard shortcuts `G` lab · `T` theme · `S` smooth wheel · `C` copy email.
* **A11y**: skip link, `:focus-visible` rings, `aria-keyshortcuts`, `inert` on the
  closed lab drawer, `prefers-reduced-motion` everywhere, `prefers-color-scheme`.
* **Tests**: 13, booting the real app against a stub DOM — including one that
  asserts the turbulence data URI round-trips to `filter='url(#g)'` and never
  double-encodes the `#` (the bug that silently kills a data-URI grain layer).

---

## Changing the person, the projects or the art

Everything is in `content.js`:

* `ME`, `HERO`, `ABOUT`, `JOURNEY`, `CONTACT`, `NAV`, `TICKER` — copy.
* `PROJECTS[]` / `BENCH[]` — cards; `art` names a drawing.
* `ART` — each drawing is SVG path data in a `0 0 200 200` box. Add a shape,
  point a project at it, and both the particles and the blueprint pick it up.
* `TEXT_ART` — hand-lettered shapes (`hello`) rasterised in the Caveat face.

Then `npm run build`. Nothing else needs touching.
