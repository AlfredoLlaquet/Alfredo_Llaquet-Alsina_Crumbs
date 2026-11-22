import { buildCrumbPdf } from './pdf-layout.js?v=20261122-pdf1';

// Each export owns its worker, including its font data and unfinished document.
let pause = null;
let resume = null;
let started = false;

async function loadFont(name) {
  const response = await fetch(new URL(`./pdf-assets/${name}.woff`, import.meta.url));
  if (!response.ok) throw new Error(`Could not load ${name}.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function exportPdf(settings) {
  const [regular, bold] = await Promise.all([loadFont('reader-sans'), loadFont('reader-sans-bold')]);
  let lastUpdate = -Infinity;
  async function checkpoint(done, total) {
    if (performance.now() - lastUpdate >= 60 || done === total) {
      self.postMessage({ type: 'progress', done, total });
      lastUpdate = performance.now();
      // Let incoming pause/resume messages run while paginating a long export.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (pause) await pause;
  }
  const blob = await buildCrumbPdf(settings, { fonts: { regular, bold }, checkpoint });
  if (pause) await pause;
  self.postMessage({ type: 'ready', blob });
}

self.onmessage = ({ data }) => {
  if (data.type === 'pause') {
    if (!pause) pause = new Promise(resolve => { resume = resolve; });
  } else if (data.type === 'resume') {
    resume?.();
    pause = resume = null;
  } else if (!started) {
    started = true;
    exportPdf(data).catch(error => {
      console.error('PDF export failed', error);
      self.postMessage({ type: 'error' });
    });
  }
};
