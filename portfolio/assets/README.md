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
