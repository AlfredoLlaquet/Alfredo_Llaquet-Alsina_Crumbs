import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { formatCrumbBody } from '../core.js';
import { buildCrumbPdf } from '../pdf-layout.js';

test('verse and dialogue-only crumbs keep their Reader breaks in plain text', () => {
  assert.equal(formatCrumbBody('One / two / three.'), 'One\ntwo\nthree.');
  assert.equal(formatCrumbBody('“One.” “Two.”'), '“One.”\n“Two.”');
  assert.equal(formatCrumbBody('She said “One.” “Two,” he added.'), 'She said “One.” “Two,” he added.');
  assert.equal(formatCrumbBody('“One.” “Two / three.”'), '“One.” “Two\nthree.”');
});

test('bookmarks distinguish repeated and untitled crumbs even on a shared page', async () => {
  const regular = await readFile(new URL('../pdf-assets/reader-sans.woff', import.meta.url));
  const bold = await readFile(new URL('../pdf-assets/reader-sans-bold.woff', import.meta.url));
  const first = { number: 81, title: 'First title', body: 'See crumb 1.' };
  const untitled = { number: 1, title: '', body: 'Body only.' };
  for (const newPage of [false, true]) {
    const blob = await buildCrumbPdf({
      crumbs: [first, untitled, first], format: 'A5', fontSize: 11, newPage, title: '',
    }, { fonts: { regular, bold }, checkpoint() {} });
    const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
    // PDFKit leaves outline, page, and link dictionaries uncompressed.
    const bookmarks = [...pdf.matchAll(/\/Dest \[(\d+) 0 R \/XYZ 0 ([\d.]+) 0\]\s+\/Parent \d+ 0 R\s+\/Title \(([^)]+)\)/g)];
    assert.deepEqual(bookmarks.map(entry => entry[3]), ['First title', 'Crumb 1', 'First title']);
    const pages = new Set(bookmarks.map(entry => entry[1]));
    assert.equal(pages.size, newPage ? 3 : 1);
    if (!newPage) {
      const [a, b, c] = bookmarks.map(entry => Number(entry[2]));
      assert.ok(a > b && b > c, 'each occurrence needs its own vertical destination');
    }
    assert.equal([...pdf.matchAll(/\/Type \/Page\b/g)].length, pages.size);
    assert.equal([...pdf.matchAll(/\/URI \(https:\/\/www\.thecrumbs\.org\/\)/g)].length, pages.size);
  }
});
