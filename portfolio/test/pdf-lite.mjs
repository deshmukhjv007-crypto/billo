/* ============================================================================
   test/pdf-lite.mjs — a small PDF *reader*, just enough to audit our writer.

   There is no poppler/qpdf/mutool in CI and no npm dependencies allowed, so
   the tests can't borrow a real parser. Writing a miniature one turns out to be
   the better deal anyway: it checks the bytes we actually emit — xref offsets
   that must land on their "N 0 obj" headers, a page tree whose /Count matches
   /Kids, content streams whose lengths match /Length, and text we can pull back
   out of the content stream and re-measure.

   Scope: classic xref tables only (which is all we write), no object streams,
   no encryption, no incremental updates.
   ========================================================================== */

import zlib from 'node:zlib';

export function parsePDF(buf) {
  const raw = buf.toString('latin1');
  const problems = [];

  /* ---------------------------------------------------------------- header */
  const header = raw.slice(0, 8);
  if (!header.startsWith('%PDF-')) problems.push('missing %PDF- header');

  /* a binary comment line must follow within the first 1024 bytes */
  if (!raw.slice(0, 1024).includes('%\u00e2\u00e3\u00cf\u00d3')) problems.push('missing binary marker comment');

  /* --------------------------------------------------------------- trailer */
  const startxrefAt = raw.lastIndexOf('startxref');
  if (startxrefAt < 0) { problems.push('no startxref'); return { problems, raw }; }
  const startxref = Number(raw.slice(startxrefAt + 9).trim().split(/\s/)[0]);

  const trailerMatch = raw.slice(raw.lastIndexOf('trailer')).match(/<<([\s\S]*?)>>/);
  const trailer = trailerMatch ? trailerMatch[1] : '';
  const size = Number((trailer.match(/\/Size\s+(\d+)/) || [])[1]);
  const rootRef = Number((trailer.match(/\/Root\s+(\d+)\s+\d+\s+R/) || [])[1]);
  const infoRef = Number((trailer.match(/\/Info\s+(\d+)\s+\d+\s+R/) || [])[1]);
  if (!size) problems.push('trailer has no /Size');
  if (!rootRef) problems.push('trailer has no /Root');

  /* ----------------------------------------------------------- xref table */
  if (raw.slice(startxref, startxref + 4) !== 'xref') problems.push(`startxref ${startxref} does not point at "xref"`);
  const xrefBody = raw.slice(startxref);
  const xrefLines = xrefBody.split('\n').slice(2, 2 + size);      // skip "xref" and the subsection header
  const offsets = [];
  xrefLines.forEach((line, i) => {
    const m = line.match(/^(\d{10}) (\d{5}) ([nf])\s*$/);
    if (!m) { problems.push(`xref entry ${i + 1} malformed: ${JSON.stringify(line)}`); return; }
    offsets[i] = m[3] === 'n' ? Number(m[1]) : 0;      // entry 0 is the free one
    if (m[3] === 'n' && Number(m[1]) === 0 && i !== 0) problems.push(`xref entry ${i} claims offset 0`);
  });
  if (offsets.length !== size) problems.push(`xref has ${offsets.length} entries, /Size says ${size}`);
  if (offsets[0] !== 0 || !/^0000000000 65535 f/.test(xrefLines[0] || '')) problems.push('free entry 0 is not the conventional one');

  /* -------------------------------------------- every offset finds its object */
  for (let i = 1; i < offsets.length; i++) {
    const at = offsets[i];
    if (at == null) continue;
    const expect = `${i} 0 obj`;
    if (!raw.startsWith(expect, at)) {
      problems.push(`object ${i}: xref says offset ${at}, but that is ${JSON.stringify(raw.slice(at, at + 24))}`);
    }
  }

  /* ------------------------------------------------------------- the objects */
  const objects = new Map();
  const re = /(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g;
  let m;
  while ((m = re.exec(raw))) {
    const id = Number(m[1]);
    const body = m[2];
    const streamAt = body.indexOf('stream\n');
    if (streamAt >= 0) {
      const dict = body.slice(0, streamAt);
      const len = Number((dict.match(/\/Length\s+(\d+)/) || [])[1]);
      // a reader consumes exactly /Length bytes, then expects an EOL + endstream
      const data = body.slice(streamAt + 7, streamAt + 7 + len);
      const after = body.slice(streamAt + 7 + len);
      if (!/^\r?\n?endstream/.test(after)) {
        problems.push(`object ${id}: after ${len} bytes of stream data comes ${JSON.stringify(after.slice(0, 16))}, not "endstream"`);
      }
      objects.set(id, { id, dict, stream: data, raw: body, after });
    } else {
      objects.set(id, { id, dict: body.trim(), stream: null, raw: body });
    }
  }

  /* -------------------------------------------------------------- page tree */
  const catalog = objects.get(rootRef);
  if (!catalog) problems.push(`/Root points at object ${rootRef}, which does not exist`);
  else if (!/\/Type\s*\/Catalog/.test(catalog.dict)) problems.push('catalog is not /Type /Catalog');

  const pagesRef = catalog && Number((catalog.dict.match(/\/Pages\s+(\d+)\s+\d+\s+R/) || [])[1]);
  const pagesObj = pagesRef && objects.get(pagesRef);
  if (!pagesObj) problems.push('/Pages is missing');
  if (pagesObj && !/\/Type\s*\/Pages/.test(pagesObj.dict)) problems.push('page tree node is not /Type /Pages');

  const count = pagesObj && Number((pagesObj.dict.match(/\/Count\s+(\d+)/) || [])[1]);
  const kids = pagesObj ? [...pagesObj.dict.matchAll(/(\d+)\s+0\s+R/g)].map(x => Number(x[1])) : [];
  if (pagesObj && (!count || count !== kids.length)) problems.push(`/Count ${count} vs ${kids.length} /Kids`);

  const pages = kids.map(id => objects.get(id)).filter(Boolean);
  pages.forEach((p, i) => {
    if (!/\/Type\s*\/Page\b/.test(p.dict)) problems.push(`page ${i + 1} is not /Type /Page`);
    const parent = Number((p.dict.match(/\/Parent\s+(\d+)\s+\d+\s+R/) || [])[1]);
    if (parent !== pagesRef) problems.push(`page ${i + 1} /Parent is ${parent}, expected ${pagesRef}`);
    if (!/\/MediaBox\s*\[/.test(p.dict)) problems.push(`page ${i + 1} has no /MediaBox`);
    if (!/\/Resources/.test(p.dict)) problems.push(`page ${i + 1} has no /Resources`);
  });

  /* --------------------------------------------------- fonts + /Resources */
  const fontRefs = [];
  pages.forEach((p, i) => {
    const fontBlock = (p.dict.match(/\/Font\s*<<([\s\S]*?)>>/) || [])[1] || '';
    if (!fontBlock) problems.push(`page ${i + 1} has no /Font resource`);
    for (const f of fontBlock.matchAll(/\/(F\d+)\s+(\d+)\s+\d+\s+R/g)) {
      fontRefs.push({ name: f[1], id: Number(f[2]) });
      const fo = objects.get(Number(f[2]));
      if (!fo) { problems.push(`/${f[1]} points at missing object ${f[2]}`); continue; }
      if (!/\/Type\s*\/Font/.test(fo.dict)) problems.push(`/${f[1]} is not a font object`);
      if (!/\/BaseFont\s*\/(Helvetica|Helvetica-Bold|Helvetica-Oblique)/.test(fo.dict)) problems.push(`/${f[1]} uses a non-standard font`);
      if (!/\/Encoding\s*\/WinAnsiEncoding/.test(fo.dict)) problems.push(`/${f[1]} has no WinAnsiEncoding`);
    }
  });

  /* -------------------------------------------------------- link annots */
  const annots = [];
  pages.forEach((p, i) => {
    const list = (p.dict.match(/\/Annots\s*\[([^\]]*)\]/) || [])[1] || '';
    for (const r of list.matchAll(/(\d+)\s+0\s+R/g)) {
      const a = objects.get(Number(r[1]));
      if (!a) { problems.push(`page ${i + 1} /Annots references missing object ${r[1]}`); continue; }
      if (!/\/Subtype\s*\/Link/.test(a.dict)) problems.push('annotation is not a /Link');
      const uri = (a.dict.match(/\/URI\s*\(([^)]*)\)/) || [])[1] || '';
      const rect = (a.dict.match(/\/Rect\s*\[([^\]]*)\]/) || [])[1] || '';
      annots.push({ page: i + 1, uri, rect: rect.trim().split(/\s+/).map(Number) });
    }
  });

  /* --------------------------------------------------------------- metadata */
  const info = infoRef && objects.get(infoRef);
  const meta = {};
  if (info) {
    for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate']) {
      const v = info.dict.match(new RegExp(`/${key}\\s*\\(([^)]*)\\)`));
      meta[key] = v ? v[1] : null;
    }
  } else problems.push('/Info object is missing');

  /* --------------------------------------------------------- text extraction */
  const pageText = pages.map(p => extractText(p, objects));

  return {
    problems,
    raw,
    size,
    count,
    objects,
    pages,
    pageCount: pages.length,
    fonts: fontRefs,
    annots,
    meta,
    text: pageText,
    /** every text-showing operator, page by page */
    ops: pages.map(p => contentStream(p, objects))
  };
}

/** Resolve a page's /Contents (stream or array of streams) to its text. */
function contentStream(page, objects) {
  const refs = [...page.dict.matchAll(/\/Contents\s+(\d+)\s+0\s+R/g)].map(m => Number(m[1]));
  const arrayed = page.dict.match(/\/Contents\s*\[([^\]]*)\]/);
  if (arrayed) refs.push(...[...arrayed[1].matchAll(/(\d+)\s+0\s+R/g)].map(m => Number(m[1])));
  return refs.map(id => objects.get(id)?.stream || '').join('\n');
}

/**
 * Pull every drawn string out of a content stream.
 * Handles our own escaping (\\, \(, \) and \NNN octal) — no font subsetting,
 * no ToUnicode CMaps, because WinAnsi is a straight byte→glyph mapping.
 */
export function extractText(page, objects) {
  const stream = contentStream(page, objects);
  const out = [];
  const re = /\(((?:\\.|[^\\()])*)\)\s*Tj/g;
  let m;
  while ((m = re.exec(stream))) out.push(unescape(m[1]));
  return out;
}

export function unescape(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') { out += s[i]; continue; }
    const c = s[++i];
    if (c === 'n') out += '\n';
    else if (c === 'r') out += '\r';
    else if (c === 't') out += '\t';
    else if (c >= '0' && c <= '7') {
      let oct = c;
      while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += c;
  }
  return out;
}

/** A tiny rasteriser-free "did anything draw outside the paper?" check. */
export function bounds(stream) {
  const xs = [], ys = [];
  for (const m of stream.matchAll(/([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+re f/g)) {
    xs.push(Number(m[1]), Number(m[1]) + Number(m[3]));
    ys.push(Number(m[2]), Number(m[2]) + Number(m[4]));
  }
  for (const m of stream.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)) {
    xs.push(Number(m[1]));
    ys.push(Number(m[2]));
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export { zlib };
