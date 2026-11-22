import { formatCrumbBody } from './core.js?v=20261122-pdf1';
import { LineWrapper, PDFDocument, toBlob } from './pdf-assets/pdfkit-0.21.0.js';
import { drawText, lineWidth, needsFallback } from './pdf-glyphs.js';

const ADDRESS = 'www.TheCrumbs.org';
const HOME = 'https://www.thecrumbs.org/';
const AUTHOR = 'Alfredo Llaquet-Alsina';
const TEXT = '#20252b';
const HEADINGS = '#111820';
const MUTED = '#435166';

// The color is part of the text's meaning. PDF outlines for these emoji are monochrome.
const discColors = {
  '🔴': '#d72a29', '🔵': '#216aca', '🟠': '#ed841a', '🟡': '#eab814',
  '🟢': '#319046', '🟣': '#8747ae', '🟤': '#865737',
};
const discs = /([🔴🔵🟠🟡🟢🟣🟤])/u;

function wrappedLines(doc, text, width) {
  if (!text) return [];
  // Measure with PDFKit's Unicode line breaker and the same font used to draw.
  // The measuring callback does not advance the document's page or cursor.
  const options = { width, height: doc.page.height * 2 };
  const wrapper = new LineWrapper(doc, options);
  if (needsFallback(doc, text)) wrapper.wordWidth = word => lineWidth(doc, word);
  const lines = [];
  // At a discretionary break PDFKit already supplies the visible hyphen.
  // Inside a line, a soft hyphen has no ink or space, just as in the Reader.
  wrapper.on('line', line => lines.push(line.replace(/\n$/, '').replaceAll('\u00AD', '')));
  wrapper.wrap(text, options);
  return lines;
}

function fittedHeading(doc, text, width, size, availableHeight) {
  let lines, leading;
  for (;;) {
    doc.fontSize(size);
    lines = wrappedLines(doc, text, width);
    leading = size * 1.26;
    const height = leading * lines.length;
    if (height <= availableHeight) return { size, lines, leading, height };
    // An unusually long heading must still leave room for the opening body lines.
    size *= Math.min(0.9, Math.sqrt(availableHeight / height));
  }
}

function drawLine(doc, text, x, y, color) {
  doc.fillColor(color);
  if (!discs.test(text)) {
    drawText(doc, text, x, y, color);
    return;
  }
  for (const run of text.split(discs)) {
    if (!run) continue;
    const ink = discColors[run] || color;
    doc.fillColor(ink);
    drawText(doc, run, x, y, ink);
    x = doc.x;
  }
}

function centeredLine(doc, text, y, color) {
  const line = text.trimEnd();
  drawLine(doc, line, (doc.page.width - lineWidth(doc, line)) / 2, y, color);
}

export async function buildCrumbPdf({ crumbs, format, fontSize, newPage, title }, { fonts, checkpoint }) {
  if (!crumbs.length) throw new Error('An export needs at least one crumb.');
  await checkpoint(0, crumbs.length);
  const doc = new PDFDocument({
    size: format, margin: 0, font: null, lang: 'en-US', pdfVersion: '1.7',
    info: { Title: title || 'Crumbs', Author: AUTHOR, Creator: 'Crumb Reader' },
  });
  const result = toBlob(doc);
  doc.registerFont('Reader', fonts.regular);
  doc.registerFont('ReaderBold', fonts.bold);

  const compact = format === 'A5';
  const margin = compact ? 34 : 50;
  const width = doc.page.width - 2 * margin;
  const headerY = compact ? 15 : 21;
  const footerY = doc.page.height - (compact ? 27 : 32);
  const bottom = footerY - (compact ? 18 : 25);
  const noteSize = 8.5;
  doc.font('Reader');
  const runningHeader = fittedHeading(doc, title, width, noteSize, doc.page.height * 0.15);
  const top = Math.max(margin + 4, headerY + runningHeader.height + 15);
  const numberSize = fontSize * 0.74;
  const numberHeight = numberSize * 1.4;
  const bodyLeading = fontSize * 1.5;
  let y = top;

  function drawHeader() {
    doc.font('Reader').fontSize(runningHeader.size);
    runningHeader.lines.forEach((line, i) => centeredLine(doc, line, headerY + i * runningHeader.leading, MUTED));
  }

  function drawFooter() {
    doc.font('Reader').fontSize(noteSize).fillColor('#0366d6');
    doc.text(ADDRESS, margin, footerY, { lineBreak: false, link: HOME, underline: true });
    const credit = `By ${AUTHOR}`;
    drawLine(doc, credit, doc.page.width - margin - doc.widthOfString(credit), footerY, MUTED);
  }

  function nextPage() {
    drawFooter();
    doc.addPage();
    drawHeader();
    y = top;
  }

  drawHeader();
  for (const [index, crumb] of crumbs.entries()) {
    doc.font('Reader').fontSize(fontSize);
    const body = wrappedLines(doc, formatCrumbBody(crumb.body), width);
    const openingHeight = Math.min(2, body.length) * bodyLeading;
    const titleGap = crumb.title ? fontSize * 0.5 : 0;
    const bodyGap = body.length ? fontSize : 0;
    const fixedHeight = numberHeight + titleGap + bodyGap + openingHeight;
    doc.font('ReaderBold');
    const heading = fittedHeading(doc, crumb.title, width, fontSize * 1.5, bottom - top - fixedHeight);
    const gap = index ? fontSize * 1.7 : 0;
    if (index && (newPage || y + gap + fixedHeight + heading.height > bottom)) nextPage();
    else y += gap;

    const label = `Crumb ${crumb.number}`;
    // PDFKit measures the outline's left offset from the right edge of the page.
    doc.outline.addItem(crumb.title || label, { left: doc.page.width, top: y });
    doc.font('Reader').fontSize(numberSize);
    centeredLine(doc, label, y, MUTED);
    y += numberHeight + titleGap;
    doc.font('ReaderBold').fontSize(heading.size);
    for (const line of heading.lines) {
      centeredLine(doc, line, y, HEADINGS);
      y += heading.leading;
    }
    y += bodyGap;
    doc.font('Reader').fontSize(fontSize);
    for (const line of body) {
      if (y + bodyLeading > bottom) {
        nextPage();
        doc.font('Reader').fontSize(fontSize);
      }
      drawLine(doc, line, margin, y, TEXT);
      y += bodyLeading;
    }
    await checkpoint(index + 1, crumbs.length);
  }
  drawFooter();
  doc.end();
  return result;
}
