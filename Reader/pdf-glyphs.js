// A character absent from the embedded font still needs its own PDF text code.
// Type 3 glyphs can carry both a platform-rendered shape and a Unicode mapping.
const faces = new WeakMap();
const em = 112;
const graphemes = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function faceFor(doc) {
  const font = doc._font.font;
  let face = faces.get(font);
  if (!face) {
    face = { font, coverage: new Map(), glyphs: new Map() };
    faces.set(font, face);
  }
  return face;
}

function covered(face, character) {
  const point = character.codePointAt(0);
  if (point < 128) return true;
  if (!face.coverage.has(point)) face.coverage.set(point, face.font.hasGlyphForCodePoint(point));
  return face.coverage.get(point);
}

export function needsFallback(doc, text) {
  if (!/[^\x00-\x7f]/.test(text)) return false;
  const face = faceFor(doc);
  for (const c of text) if (!covered(face, c)) return true;
  return false;
}

function glyphFor(doc, face, text) {
  if (face.glyphs.has(text)) return face.glyphs.get(text);
  if (!('context' in face)) {
    try {
      face.context = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true }) : null;
    } catch {
      face.context = null;
    }
  }
  const ctx = face.context;
  const font = `${/bold/i.test(doc._font.name) ? 'bold ' : ''}${em}px system-ui, sans-serif`;
  if (ctx) ctx.font = font;
  const metrics = ctx?.measureText(text);
  const glyph = { ctx, font, metrics, width: metrics ? metrics.width / em : 1, text, colors: new Map() };
  face.glyphs.set(text, glyph);
  return glyph;
}

function* runs(doc, text) {
  const face = faceFor(doc);
  const segments = graphemes ? graphemes.segment(text) : text;
  let regular = '';
  for (const item of segments) {
    const cluster = item.segment ?? item;
    if (Array.from(cluster).every(c => covered(face, c))) regular += cluster;
    else {
      if (regular) yield regular;
      regular = '';
      yield glyphFor(doc, face, cluster);
    }
  }
  if (regular) yield regular;
}

export function lineWidth(doc, text) {
  if (!needsFallback(doc, text)) return doc.widthOfString(text);
  let width = 0;
  for (const run of runs(doc, text)) width += typeof run === 'string' ? doc.widthOfString(run) : run.width * doc._fontSize;
  return width;
}

function platformImage(doc, glyph, color) {
  const { ctx, metrics, font, text } = glyph;
  if (!ctx) return null;
  const canvas = ctx.canvas;
  const left = Math.ceil(metrics.actualBoundingBoxLeft) + 1;
  const top = Math.ceil(metrics.actualBoundingBoxAscent) + 1;
  canvas.width = Math.max(1, left + Math.ceil(metrics.actualBoundingBoxRight) + 1);
  canvas.height = Math.max(1, top + Math.ceil(metrics.actualBoundingBoxDescent) + 1);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.fillText(text, left, top);
  const { width, height } = canvas;
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const alpha = new Uint8Array(width * height);
  const rgb = new Uint8Array(alpha.length * 3);
  for (let i = 0; i < alpha.length; i++) {
    rgb[i * 3] = pixels[i * 4];
    rgb[i * 3 + 1] = pixels[i * 4 + 1];
    rgb[i * 3 + 2] = pixels[i * 4 + 2];
    alpha[i] = pixels[i * 4 + 3];
  }
  const imageSpec = { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: 8 };
  const mask = doc.ref({ ...imageSpec, ColorSpace: 'DeviceGray' });
  mask.end(alpha);
  const image = doc.ref({ ...imageSpec, ColorSpace: 'DeviceRGB', SMask: mask });
  image.end(rgb);
  const unit = 1000 / em;
  return { image, paint: `q ${width * unit} 0 0 ${height * unit} ${-left * unit} ${(top - height) * unit} cm /I Do Q` };
}

function glyphFont(doc, glyph, color) {
  if (glyph.colors.has(color)) return glyph.colors.get(color);
  const painted = platformImage(doc, glyph, color);
  const advance = glyph.width * 1000;
  const shape = doc.ref();
  shape.end(`${advance} 0 d0\n${painted?.paint || '48 w 80 0 750 720 re S'}`);
  const utf16 = glyph.text.split('').map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  const unicode = doc.ref();
  unicode.end(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /ReaderUnicode def /CMapType 2 def
1 begincodespacerange <01> <01> endcodespacerange 1 beginbfchar <01> <${utf16}> endbfchar
endcmap CMapName currentdict /CMap defineresource pop end end`);
  // Some PDF viewers infer the scale of a Type 3 font from the width of its m.
  const meter = doc.ref();
  meter.end('600 0 d0');
  const font = doc.ref({
    Type: 'Font', Subtype: 'Type3', Name: 'ReaderFallback', FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    FontBBox: [-300, -300, Math.max(1300, advance), 1100], FirstChar: 1, LastChar: 2, Widths: [advance, 600],
    CharProcs: { glyph: shape, m: meter }, Encoding: { Type: 'Encoding', Differences: [1, 'glyph', 'm'] }, ToUnicode: unicode,
    Resources: painted ? { XObject: { I: painted.image } } : {},
  });
  font.end();
  glyph.colors.set(color, font);
  return font;
}

export function drawText(doc, text, x, y, color) {
  if (!needsFallback(doc, text)) {
    doc.text(text, x, y, { lineBreak: false });
    return;
  }
  for (const run of runs(doc, text)) {
    if (typeof run === 'string') {
      doc.text(run, x, y, { lineBreak: false });
      x = doc.x;
    } else {
      const font = glyphFont(doc, run, color);
      const name = `G${font.id}`;
      doc.page.fonts[name] = font;
      const baseline = y + doc._font.ascender * doc._fontSize / 1000;
      doc.addContent(`q BT /${name} ${doc._fontSize} Tf 1 0 0 -1 ${x} ${baseline} Tm <01> Tj ET Q`);
      x += run.width * doc._fontSize;
    }
  }
  doc.x = x;
  doc.y = y;
}
