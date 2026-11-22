const byId = id => document.getElementById(id);
const numberFormat = new Intl.NumberFormat('en-US');

function crumbNumber(text, total) {
  const number = Number(text);
  return /^\d+$/.test(text) && Number.isSafeInteger(number) && number >= 1 && number <= total ? number : null;
}

function pdfFilename(title) {
  const name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '') || 'Crumbs';
  return /\.pdf$/i.test(name) ? name : name + '.pdf';
}

export function initializePdfExport({ getReader, ask, message, downloadBlob, showToast }) {
  const button = byId('to-pdf');
  const dialog = byId('pdf-dialog');
  const form = byId('pdf-form');
  const scope = byId('pdf-scope');
  const matchingOption = scope.querySelector('option[value="matching"]');
  const list = byId('pdf-list');
  const from = byId('pdf-from');
  const to = byId('pdf-to');
  const error = byId('pdf-error');
  const progressDialog = byId('pdf-progress-dialog');
  const progress = byId('pdf-progress');
  const status = byId('pdf-progress-status');
  let active = null;

  function clearError() {
    error.hidden = true;
    error.textContent = '';
    form.querySelector('[aria-invalid]')?.removeAttribute('aria-invalid');
  }

  function report(text, field) {
    error.textContent = text;
    error.hidden = false;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    }
    return null;
  }

  function updateScope() {
    byId('pdf-list-field').hidden = scope.value !== 'list';
    byId('pdf-range-fields').hidden = scope.value !== 'range';
    clearError();
  }

  function selectedCrumbs({ corpus, session, matches }) {
    const total = corpus.length;
    const formattedTotal = numberFormat.format(total);
    let numbers;
    switch (scope.value) {
      case 'current':
        return [corpus[session.current - 1]];
      case 'matching':
        numbers = session.search.active ? [...matches] : [];
        break;
      case 'favorites':
        numbers = [...session.favorites];
        break;
      case 'visited':
        numbers = [...session.lastVisits.keys()];
        break;
      case 'not-visited': {
        const remaining = corpus.filter(crumb => !session.lastVisits.has(crumb.number));
        return remaining.length ? remaining : report(message('pdf-all-visited'), scope);
      }
      case 'list': {
        if (!list.value.trim()) return report(message('pdf-list-empty'), list);
        const crumbs = [];
        for (const [index, entry] of list.value.split(',').entries()) {
          const number = crumbNumber(entry.trim(), total);
          if (number === null) {
            return report(message('pdf-list-invalid', {
              position: numberFormat.format(index + 1), entry: entry.trim(), total: formattedTotal,
            }), list);
          }
          crumbs.push(corpus[number - 1]);
        }
        return crumbs;
      }
      case 'range': {
        const first = crumbNumber(from.value, total);
        const last = crumbNumber(to.value, total);
        if (first === null || last === null) {
          return report(message('search-number-invalid', { total: formattedTotal }), first === null ? from : to);
        }
        if (last < first) return report(message('pdf-range-reversed'), to);
        return corpus.slice(first - 1, last);
      }
    }
    if (!numbers?.length) return report(message('pdf-empty-selection'), scope);
    return numbers.sort((a, b) => a - b).map(number => corpus[number - 1]);
  }

  function stop(job) {
    job.worker?.terminate();
    active = null;
    progressDialog.close();
  }

  function receive(job, data) {
    if (job !== active) return;
    if (data.type === 'progress') {
      if (!job.confirming) {
        progress.value = data.done;
        if (!data.done) return;
        status.textContent = data.done === data.total ? message('pdf-finalizing') : message('pdf-progress', {
          done: numberFormat.format(data.done), total: numberFormat.format(data.total),
        });
      }
      return;
    }
    // A short export can finish before the worker processes the pause message.
    // Hold the result until the reader has decided whether to keep the PDF.
    if (job.confirming) {
      job.pending = data;
      return;
    }
    stop(job);
    if (data.type === 'ready') {
      try {
        downloadBlob(data.blob, job.filename);
        showToast(message('pdf-downloading'));
        button.focus({ preventScroll: true });
        return;
      } catch { /* Show the same retryable error as a worker failure. */ }
    }
    dialog.showModal();
    report(message('pdf-failed'));
    byId('pdf-export').focus();
  }

  async function confirmCancel(event) {
    event.preventDefault();
    const job = active;
    if (!job || job.confirming) return;
    job.confirming = true;
    job.worker.postMessage({ type: 'pause' });
    const cancel = await ask(message('pdf-cancel-question'), message('pdf-cancel-detail'),
      message('pdf-cancel'), message('pdf-continue'), {
        cancelIsPrimary: true, cancelHint: message('pdf-continue-hint'), acceptHint: message('pdf-cancel-hint'),
      });
    if (active !== job) return;
    job.confirming = false;
    if (cancel) {
      stop(job);
      dialog.showModal();
      byId('pdf-export').focus();
    } else if (job.pending) {
      receive(job, job.pending);
    } else {
      job.worker.postMessage({ type: 'resume' });
    }
  }

  button.addEventListener('click', () => {
    const { corpus, session } = getReader();
    if (!session || active) return;
    form.reset();
    // Remove the unavailable option even from mobile browsers' native pickers.
    if (session.search.active) scope.options[0].after(matchingOption);
    else matchingOption.remove();
    from.max = to.max = String(corpus.length);
    from.value = '1';
    to.value = String(corpus.length);
    updateScope();
    dialog.showModal();
  });

  scope.addEventListener('change', updateScope);
  form.addEventListener('input', clearError);
  byId('pdf-progress-cancel').addEventListener('click', confirmCancel);
  progressDialog.addEventListener('cancel', confirmCancel);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (active) return;
    clearError();
    const crumbs = selectedCrumbs(getReader());
    if (!crumbs) return;
    const title = byId('pdf-title').value.trim();
    const job = { filename: pdfFilename(title), worker: null, confirming: false, pending: null };
    active = job;
    dialog.close();
    progress.max = crumbs.length;
    progress.removeAttribute('value');
    status.textContent = message('pdf-preparing');
    progressDialog.showModal();
    try {
      job.worker = new Worker(new URL('./pdf-worker.js?v=20261122-pdf1', import.meta.url), { type: 'module' });
      job.worker.onmessage = event => receive(job, event.data);
      job.worker.onerror = job.worker.onmessageerror = () => receive(job, { type: 'error' });
      job.worker.postMessage({
        crumbs, title, format: byId('pdf-format').value,
        fontSize: Number(byId('pdf-font-size').value), newPage: byId('pdf-new-page').checked,
      });
    } catch {
      receive(job, { type: 'error' });
    }
  });
}
