# assets/

## Your photo

Drop your portrait in this folder using **one of these names**, and the next
`npm run build` picks it up automatically — no code change:

```
assets/jayesh.jpg      ← first choice
assets/jayesh.jpeg
assets/jayesh.png
assets/jayesh.webp
assets/jayesh.avif
assets/photo.jpg       ← also checked, as is portrait.* and me.*
```

Then:

```bash
npm run build
```

The hero will swap the inked **JD** monogram for your picture. Until a file
exists, the monogram is drawn instead, so the page never shows a broken image.

### What actually happens to the photo

Your photograph is **sampled into particles** — the hero draws it as several
thousand dots of ink that drift, and scatter when you move the pointer through
them. That is the effect on [hire.rest](https://hire.rest/), except that one is
a drawn illustration; this one is really you.

The sampling happens in the browser, in `js/portrait.js`:

1. the file is drawn into an offscreen canvas, cover-cropped to a square
2. every pixel's luminance is compared against an 8×8 ordered-dither matrix
   (`BAYER8`), which decides how densely each patch of tone turns into dots
3. a radial falloff fades the edges out, so there is no rectangle of dots
   sitting on the page
4. the surviving dots become particle targets, roughly 3–4 thousand of them

Around 5% come out in the ember accent colour so the portrait matches the
palette of the drawn illustrations elsewhere on the page.

A few consequences worth knowing:

- **A bright background inks as densely as a face.** Portraits photographed
  against a white wall turn the whole frame into dots, and the face reads only
  through the dark features. A darker or softer background gives a clearer
  silhouette.
- **Contrast is what carries detail.** Eyes, hair and a beard shadow survive the
  process; flat lighting loses the features entirely.
- **The framed copy steps aside once the dots exist** — otherwise the hero shows
  the same photograph twice. You can watch this happen on a slow connection: the
  framed portrait sits there until the particles are ready, then fades out.

Tuning lives in `IMAGE_ART.portrait` in `content.js`: `pivot` and `gain` control
how dark a pixel must be before it inks, `size` and `step` trade resolution for
particle count, and `falloff` in `js/portrait.js` controls the vignette.

### What works best

The portrait renders inside a **circle** that clips the image. Two CSS variables
control the framing, both on `.portrait-frame` in `styles.css`:

| variable | default | what it does |
|---|---|---|
| `--portrait-zoom` | `1.12` | scales the photo inside the circle. **Raise it to ~1.25** to fill the circle with the face; set it to `1` to show the whole frame |
| `--portrait-focus` | `50% 30%` | which part of the image the circle centres on (`x y`). Raise the second number to show more of the top of the head |

For example, a slightly tighter crop:

```css
.portrait { --portrait-zoom: 1.22; --portrait-focus: 50% 26%; }
```

A **square** photo needs no cropping at all — it fills the circle as-is. For
anything else the image is centre-cropped, so:

| | |
|---|---|
| **Framing** | head and shoulders, eyes roughly a third from the top |
| **Shape** | square if you have it. Non-square images get centre-cropped, so check the result after building |
| **Size** | 800×800 px is plenty. It renders at ~230 px on a retina screen |
| **Background** | the page is dark ink with an ember accent; a plain or softly blurred background reads best |
| **Format** | `.jpg` for photographs, `.png` only if you need transparency (the circle crop hides it anyway) |

### Want a different crop or position?

Edit `object-position` in `styles.css`:

```css
.portrait img, .portrait .monogram {
  object-position: 50% 32%;   /* x y — raise the second number to show more head */
}
```

Or point at a file by name instead of relying on discovery, in `resume.js`:

```js
export const PERSON = {
  ...
  photo: './assets/Jayesh-2026.jpg',
  photoAlt: 'Jayesh Deshmukh',
};
```

`photoAlt` is the screen-reader description of the picture — say what it
actually is ("Jayesh Deshmukh, smiling, in a dark shirt"), not "photo of me".
