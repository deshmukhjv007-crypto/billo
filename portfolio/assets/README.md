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

The portrait renders as a **circle, cropped from the top third** of the image
(`object-position: 50% 32%`), so:

| | |
|---|---|
| **Framing** | head and shoulders, eyes roughly a third from the top |
| **Shape** | roughly square. Anything not square gets cropped around the middle, which usually decapitates people — check it after building |
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
