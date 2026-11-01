import {
  HISTORY_LIMIT, TEXT_SCALES, parseCorpus, createSession, snapshot, fingerprint,
  restoreSession, visit, moveInHistory, nextRandom, restartRandom, crumbFromURL, linkTokens,
} from './core.js';
import { encodeSession, decodeSession, MAX_SESSION_FILE_BYTES } from './session.js';

const STORAGE_KEY = 'thecrumbs.reader.session.v1';
const byId = id => document.getElementById(id);
const controls = Object.fromEntries([
  'load-session', 'save-session', 'go-to', 'favorites', 'back', 'forward', 'quit',
  'text-smaller', 'text-larger', 'previous', 'next', 'random-order', 'favorite',
].map(id => [id, byId(id)]));
const pane = byId('reading-pane');
const numberFormat = new Intl.NumberFormat('en-US');
let corpus = [];
let session = null;
let savedFingerprint = null;
let savedWhere = '';
let allowLeave = false;
let toastTimer;
let unloadListener = false;
let entryIds = [];
let entryCounter = 0;
let browserToken = '';
let browserPosition = 0;
let browserEntries = new Map();
let scrollPositions = new Map();
let pendingHistory = null;
let historyTimer;
let saving = false;
let lastDisplayedCrumb = null;
let hasNavigated = false;
const hintDescriptions = new WeakMap();
let hintDescriptionCount = 0;
let hintOwner = null;
let scheduledHintOwner = null;
let showHintTimer;
let hideHintTimer;

function isDirty() { return session !== null && fingerprint(session) !== savedFingerprint; }
function shouldWarnBeforeLeaving() { return hasNavigated && isDirty(); }

function beforeUnload(event) {
  if (allowLeave || !shouldWarnBeforeLeaving()) return;
  event.preventDefault();
  event.returnValue = '';
}

function updateSaveState() {
  const dirty = isDirty();
  const indicator = byId('save-state');
  const label = !session ? 'Not loaded' : dirty ? 'Unsaved changes' : `Saved${savedWhere ? ` · ${savedWhere}` : ''}`;
  if (indicator.textContent !== label) indicator.textContent = label;
  indicator.classList.toggle('is-dirty', dirty);
  const warn = shouldWarnBeforeLeaving();
  if (warn && !unloadListener) { window.addEventListener('beforeunload', beforeUnload); unloadListener = true; }
  if (!warn && unloadListener) { window.removeEventListener('beforeunload', beforeUnload); unloadListener = false; }
}

function setHint(control, text, describe = true) {
  control.dataset.hint = text;
  control.removeAttribute('title');
  let description = hintDescriptions.get(control);
  if (!description && describe) {
    description = document.createElement('span');
    description.id = `reader-hint-${++hintDescriptionCount}`;
    byId('hint-descriptions').append(description);
    hintDescriptions.set(control, description);
    const existing = control.getAttribute('aria-describedby');
    control.setAttribute('aria-describedby', [existing, description.id].filter(Boolean).join(' '));
  }
  if (description) description.textContent = text;
  if (control === hintOwner && !byId('control-hint').hidden) showHint(control);
}

function hintControl(target) {
  const direct = target?.closest?.('[data-hint]');
  if (direct) return direct;
  const label = target?.closest?.('[data-hint-for]');
  return label ? byId(label.dataset.hintFor) : null;
}

function hideHint() {
  clearTimeout(showHintTimer);
  clearTimeout(hideHintTimer);
  byId('control-hint').hidden = true;
  hintOwner = null;
  scheduledHintOwner = null;
}

function showHint(control) {
  if (!control?.dataset.hint) return;
  clearTimeout(showHintTimer);
  clearTimeout(hideHintTimer);
  const tooltip = byId('control-hint');
  const parent = control.closest('dialog') || document.body;
  // A tooltip for a modal control must live inside the dialog's top layer.
  if (tooltip.parentElement !== parent) parent.append(tooltip);
  tooltip.textContent = control.dataset.hint;
  tooltip.style.left = '12px';
  tooltip.style.top = '12px';
  tooltip.hidden = false;
  const ownerBox = control.getBoundingClientRect();
  const hintBox = tooltip.getBoundingClientRect();
  const width = window.innerWidth;
  const height = window.innerHeight;
  const left = Math.max(12, Math.min((ownerBox.left + ownerBox.right - hintBox.width) / 2, width - hintBox.width - 12));
  const below = ownerBox.bottom + 8;
  const top = below + hintBox.height <= height - 12 ? below : Math.max(12, ownerBox.top - hintBox.height - 8);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  hintOwner = control;
  scheduledHintOwner = null;
}

function initializeHints() {
  for (const control of document.querySelectorAll('[data-hint]')) setHint(control, control.dataset.hint);
  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const tooltip = byId('control-hint');
    if (tooltip.contains(event.target)) { clearTimeout(hideHintTimer); return; }
    const control = hintControl(event.target);
    if (!control) return;
    clearTimeout(hideHintTimer);
    if (control === hintOwner && !tooltip.hidden) return;
    clearTimeout(showHintTimer);
    scheduledHintOwner = control;
    showHintTimer = setTimeout(() => showHint(control), 300);
  });
  document.addEventListener('pointerout', event => {
    if (event.pointerType === 'touch') return;
    const control = hintControl(event.target);
    const tooltip = byId('control-hint');
    if (control?.contains(event.relatedTarget) || tooltip.contains(event.relatedTarget)) return;
    if (control === scheduledHintOwner) { clearTimeout(showHintTimer); scheduledHintOwner = null; }
    if ((control && control === hintOwner) || tooltip.contains(event.target)) {
      if (document.activeElement === hintOwner && hintOwner?.matches(':focus-visible')) return;
      clearTimeout(hideHintTimer);
      hideHintTimer = setTimeout(hideHint, 150);
    }
  });
  document.addEventListener('focusin', event => {
    const control = hintControl(event.target);
    if (control && event.target.matches(':focus-visible')) showHint(control);
  });
  document.addEventListener('focusout', event => {
    if (hintControl(event.target) === hintOwner) hideHint();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !byId('control-hint').hidden) {
      hideHint();
      event.preventDefault();
    }
  });
  document.addEventListener('scroll', hideHint, true);
  window.addEventListener('resize', hideHint);
}

function showToast(message) {
  clearTimeout(toastTimer);
  byId('toast').textContent = message;
  byId('toast').hidden = false;
  toastTimer = setTimeout(() => { byId('toast').hidden = true; }, 4500);
}

function showMessage(title, message) {
  byId('message-title').textContent = title;
  byId('message-text').textContent = message;
  if (!byId('message-dialog').open) byId('message-dialog').showModal();
}

function ask(title, message, accept, cancel = 'Cancel') {
  const dialog = byId('confirm-dialog');
  byId('confirm-title').textContent = title;
  byId('confirm-text').textContent = message;
  byId('confirm-accept').textContent = accept;
  byId('confirm-cancel').textContent = cancel;
  const acceptHints = {
    'Return home': 'Leave the Reader and open the homepage without saving the current changes.',
    'Start new round': 'Reset the visited list and choose another crumb at random. Keep favorites and viewing history.',
    'Load session': 'Replace the active session with the selected file. Leave the browser’s saved copy unchanged.',
  };
  setHint(byId('confirm-accept'), acceptHints[accept] || 'Carry out the action described in this dialog.');
  return new Promise(resolve => {
    let complete = false;
    const finish = value => {
      if (complete) return;
      complete = true;
      byId('confirm-accept').removeEventListener('click', yes);
      byId('confirm-cancel').removeEventListener('click', no);
      dialog.removeEventListener('cancel', escape);
      dialog.close();
      resolve(value);
    };
    const yes = () => finish(true);
    const no = () => finish(false);
    const escape = event => { event.preventDefault(); finish(false); };
    byId('confirm-accept').addEventListener('click', yes);
    byId('confirm-cancel').addEventListener('click', no);
    dialog.addEventListener('cancel', escape);
    dialog.showModal();
    byId('confirm-cancel').focus();
  });
}

function crumbURL(number) {
  const url = new URL(window.location.href);
  url.searchParams.set('crumb', String(number));
  url.hash = '';
  return url;
}

function updateURL(push = false) {
  const id = entryIds[session.historyIndex];
  if (push) {
    browserPosition++;
    for (const [key, position] of browserEntries) if (position >= browserPosition) browserEntries.delete(key);
  } else {
    for (const [key, position] of browserEntries) if (position === browserPosition && key !== id) browserEntries.delete(key);
  }
  browserEntries.set(id, browserPosition);
  const marker = { crumbReader: browserToken, entry: id, position: browserPosition, crumb: session.current };
  try { window.history[push ? 'pushState' : 'replaceState'](marker, '', crumbURL(session.current)); }
  catch { /* Reading remains possible when a browser restricts History API updates. */ }
}

function initializeHistory() {
  browserToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  entryIds = session.history.map(() => ++entryCounter);
  browserPosition = 0;
  browserEntries = new Map();
  scrollPositions = new Map();
  updateURL();
}

function rememberScroll() {
  if (session) scrollPositions.set(entryIds[session.historyIndex], pane.scrollTop);
}

function renderText(element, text, lineBreaks = true) {
  const fragment = document.createDocumentFragment();
  for (const token of linkTokens(text, corpus.length, lineBreaks)) {
    if (token.type === 'text') { fragment.append(document.createTextNode(token.text)); continue; }
    const link = document.createElement('a');
    link.textContent = token.text;
    if (token.type === 'crumb') {
      link.href = crumbURL(token.number);
      link.dataset.crumb = String(token.number);
      const title = corpus[token.number - 1].title;
      link.setAttribute('aria-label', `Crumb ${token.number}${title ? `: ${title}` : ''}`);
      setHint(link, `Open crumb ${token.number}${title ? `: ${title}` : ''}. Back returns to the current crumb.`, false);
    } else {
      link.href = token.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', `${token.text} (opens in a new tab)`);
      setHint(link, `Open ${token.text} in another tab or window. The Reader stays open.`, false);
    }
    fragment.append(link);
  }
  element.replaceChildren(fragment);
}

function updateControls() {
  const unavailable = !session || pendingHistory !== null;
  for (const [name, control] of Object.entries(controls)) if (name !== 'quit') control.disabled = unavailable;
  if (!session) return;
  controls.back.disabled = unavailable || session.historyIndex === 0;
  controls.forward.disabled = unavailable || session.historyIndex === session.history.length - 1;
  controls.previous.disabled = unavailable || session.random || session.current === 1;
  controls.next.disabled = unavailable || (!session.random && session.current === corpus.length);
  controls['text-smaller'].disabled = unavailable || session.textSize === 0;
  controls['text-larger'].disabled = unavailable || session.textSize === TEXT_SCALES.length - 1;
  controls['random-order'].checked = session.random;
  controls.favorite.checked = session.favorites.has(session.current);
  setHint(controls.next, session.random
    ? 'Choose an unvisited crumb at random. When none remain, a dialog offers a new round.'
    : session.current === corpus.length ? 'This is the last available crumb in numerical order.' : 'Read the next crumb in numerical order.');
  setHint(controls.previous, session.random
    ? 'Previous is unavailable in random order. Back still retraces viewing history.'
    : session.current === 1 ? 'This is the first crumb in numerical order.' : 'Read the preceding crumb in numerical order.');
  byId('reading-progress').textContent = `${numberFormat.format(session.visited.size)} of ${numberFormat.format(corpus.length)} visited`;
  document.documentElement.style.setProperty('--text-scale', TEXT_SCALES[session.textSize]);
  updateSaveState();
}

function renderCrumb({ focus = false, restoreScroll = false } = {}) {
  hideHint();
  if (lastDisplayedCrumb !== null && lastDisplayedCrumb !== session.current) hasNavigated = true;
  lastDisplayedCrumb = session.current;
  const crumb = corpus[session.current - 1];
  byId('crumb-number').textContent = `Crumb ${crumb.number}`;
  byId('crumb-title').hidden = crumb.title.length === 0;
  renderText(byId('crumb-title'), crumb.title, false);
  renderText(byId('crumb-body'), crumb.body);
  byId('crumb').hidden = false;
  byId('loading-state').hidden = true;
  byId('load-error').hidden = true;
  pane.setAttribute('aria-busy', 'false');
  const pageTitle = `Crumb ${crumb.number}:${crumb.title ? ` ${crumb.title}` : ''} by Alfredo Llaquet-Alsina`;
  document.title = pageTitle;
  byId('og-title').setAttribute('content', pageTitle);
  byId('twitter-title').setAttribute('content', pageTitle);
  byId('announcement').textContent = `Crumb ${crumb.number}${crumb.title ? `. ${crumb.title}` : ''}`;
  updateControls();
  const scroll = restoreScroll ? (scrollPositions.get(entryIds[session.historyIndex]) || 0) : 0;
  pane.scrollTop = scroll;
  if (focus) pane.focus({ preventScroll: true });
}

function navigate(number, { focus = false, replace = false } = {}) {
  if (!session || pendingHistory !== null || !Number.isInteger(number) || number < 1 || number > corpus.length) return;
  rememberScroll();
  const index = session.historyIndex;
  if (!visit(session, number)) {
    if (focus) pane.focus({ preventScroll: true });
    return;
  }
  entryIds = [...entryIds.slice(0, index + 1), ++entryCounter].slice(-HISTORY_LIMIT);
  const active = new Set(entryIds);
  for (const id of scrollPositions.keys()) if (!active.has(id)) scrollPositions.delete(id);
  for (const id of browserEntries.keys()) if (!active.has(id)) browserEntries.delete(id);
  updateURL(!replace);
  renderCrumb({ focus });
}

function historyStep(direction) {
  if (!session || pendingHistory !== null) return;
  const target = session.historyIndex + direction;
  if (target < 0 || target >= session.history.length) return;
  rememberScroll();
  const id = entryIds[target];
  const position = browserEntries.get(id);
  if (position !== undefined && position !== browserPosition) {
    pendingHistory = target;
    updateControls();
    historyTimer = setTimeout(() => {
      if (pendingHistory === null) return;
      const fallback = pendingHistory;
      pendingHistory = null;
      moveInHistory(session, fallback);
      updateURL();
      renderCrumb({ restoreScroll: true });
    }, 1500);
    try { window.history.go(position - browserPosition); return; }
    catch { clearTimeout(historyTimer); pendingHistory = null; }
  }
  moveInHistory(session, target);
  updateURL();
  renderCrumb({ restoreScroll: true });
}

window.addEventListener('popstate', event => {
  if (!session) return;
  clearTimeout(historyTimer);
  pendingHistory = null;
  rememberScroll();
  const marker = event.state;
  const index = marker?.crumbReader === browserToken ? entryIds.indexOf(marker.entry) : -1;
  if (index !== -1) {
    browserPosition = marker.position;
    moveInHistory(session, index);
    renderCrumb({ restoreScroll: true });
    return;
  }
  const number = crumbFromURL(new URL(window.location.href).searchParams.get('crumb'), corpus.length);
  if (Number.isInteger(number)) navigate(number, { replace: true });
  initializeHistory();
  updateControls();
});

async function readNext() {
  if (!session) return;
  if (!session.random) { navigate(session.current + 1); return; }
  let number = nextRandom(session, corpus.length);
  if (number === null) {
    const accepted = await ask('Every crumb has been visited', 'Start a new random round? The visited list will be reset. Favorites and viewing history will be kept.', 'Start new round');
    if (!accepted) return;
    restartRandom(session);
    number = nextRandom(session, corpus.length);
    updateControls();
  }
  if (number !== null) navigate(number);
}

function showFavorites() {
  const numbers = [...session.favorites].sort((a, b) => a - b);
  byId('favorites-title').textContent = `Favorites (${numberFormat.format(numbers.length)})`;
  byId('favorites-empty').hidden = numbers.length > 0;
  const fragment = document.createDocumentFragment();
  for (const number of numbers) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = crumbURL(number);
    link.dataset.crumb = String(number);
    setHint(link, `Open crumb ${number}. Back returns to the current crumb.`, false);
    const label = document.createElement('span');
    label.textContent = `Crumb ${number}`;
    link.append(label);
    const title = corpus[number - 1].title;
    if (title) { const strong = document.createElement('strong'); strong.textContent = title; link.append(strong); }
    if (number === session.current) link.setAttribute('aria-current', 'page');
    item.append(link);
    fragment.append(item);
  }
  byId('favorites-list').replaceChildren(fragment);
  byId('favorites-dialog').showModal();
}

function markSaved(data, where) {
  savedFingerprint = JSON.stringify(data);
  savedWhere = where;
  updateSaveState();
}

function saveError(message) {
  byId('save-error').textContent = message;
  byId('save-error').hidden = false;
}

function safeFilename() {
  let filename = byId('session-filename').value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
  if (!filename || /^\.+$/.test(filename)) filename = `crumbs-session-${session.current}`;
  if (!filename.toLowerCase().endsWith('.txt')) filename += '.txt';
  return filename;
}

async function saveFile() {
  if (saving) return;
  const data = snapshot(session);
  const filename = safeFilename();
  saving = true;
  byId('save-file').disabled = true;
  byId('save-file').textContent = 'Saving…';
  byId('save-browser').disabled = true;
  byId('save-error').hidden = true;
  try {
    // Request the picker directly from the click, before asynchronous compression.
    let handle = null;
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'Crumb Reader session', accept: { 'text/plain': ['.txt'] } }] });
      } catch (error) {
        if (error.name === 'AbortError') return;
        if (!['SecurityError', 'NotAllowedError'].includes(error.name)) throw error;
        // Embedded previews can prohibit pickers while still allowing downloads.
      }
    }
    const contents = await encodeSession(data);
    if (handle) {
      const writer = await handle.createWritable();
      try { await writer.write(contents); await writer.close(); }
      catch (error) { try { await writer.abort(); } catch { /* Preserve the write error. */ } throw error; }
    } else {
      const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    markSaved(data, 'text file');
    byId('save-dialog').close();
    showToast(handle ? 'Session saved to a text file.' : 'Session download started.');
  } catch {
    saveError('The session file could not be saved. Try again, or save in this browser.');
  } finally {
    saving = false;
    byId('save-file').disabled = false;
    byId('save-file').textContent = 'Save as a text file';
    byId('save-browser').disabled = false;
  }
}

async function importFile(file) {
  if (!file) return;
  try {
    if (file.size > MAX_SESSION_FILE_BYTES) throw new Error('The selected session file is too large.');
    const restored = await decodeSession(await file.text(), corpus.length);
    if (isDirty() && !await ask('Load another session', 'The current session has unsaved changes. Replace it with the session from this file?', 'Load session')) return;
    session = restored;
    markSaved(snapshot(session), 'text file');
    initializeHistory();
    renderCrumb({ focus: true });
    showToast('Session loaded. The browser’s saved copy has not been changed.');
  } catch (error) {
    showMessage('Session could not be loaded', error instanceof SyntaxError ? 'The session file is damaged or incomplete.' : error.message);
  }
}

controls['load-session'].addEventListener('click', () => { byId('session-file').value = ''; byId('session-file').click(); });
byId('session-file').addEventListener('change', event => importFile(event.target.files[0]));
controls['save-session'].addEventListener('click', () => {
  byId('session-filename').value = `crumbs-session-${session.current}.txt`;
  byId('save-error').hidden = true;
  byId('save-dialog').showModal();
});
byId('save-browser').addEventListener('click', () => {
  if (saving) return;
  const data = snapshot(session);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    markSaved(data, 'browser');
    byId('save-dialog').close();
    showToast('Session saved in this browser.');
  } catch { saveError('Browser storage is unavailable or full. Save the session as a text file instead.'); }
});
byId('save-file').addEventListener('click', saveFile);
byId('save-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
controls['go-to'].addEventListener('click', () => {
  byId('go-help').textContent = `Crumb number (1–${numberFormat.format(corpus.length)})`;
  byId('crumb-input').max = corpus.length;
  byId('crumb-input').value = session.current;
  byId('go-error').hidden = true;
  byId('go-dialog').showModal();
  byId('crumb-input').focus();
  byId('crumb-input').select();
});
byId('go-form').addEventListener('submit', event => {
  event.preventDefault();
  const number = crumbFromURL(byId('crumb-input').value.trim(), corpus.length);
  if (!Number.isInteger(number)) {
    byId('go-error').textContent = `Enter a whole number from 1 to ${numberFormat.format(corpus.length)}.`;
    byId('go-error').hidden = false;
    byId('crumb-input').focus();
    return;
  }
  byId('go-dialog').close();
  navigate(number, { focus: true });
});
controls.favorites.addEventListener('click', showFavorites);
controls.back.addEventListener('click', () => historyStep(-1));
controls.forward.addEventListener('click', () => historyStep(1));
controls.previous.addEventListener('click', () => { if (!session.random) navigate(session.current - 1); });
controls.next.addEventListener('click', readNext);
controls['random-order'].addEventListener('change', event => { session.random = event.target.checked; updateControls(); });
controls.favorite.addEventListener('change', event => {
  if (event.target.checked) session.favorites.add(session.current);
  else session.favorites.delete(session.current);
  updateControls();
});
for (const [id, delta] of [['text-smaller', -1], ['text-larger', 1]]) {
  controls[id].addEventListener('click', () => {
    session.textSize = Math.max(0, Math.min(TEXT_SCALES.length - 1, session.textSize + delta));
    updateControls();
    byId('announcement').textContent = `Text size ${Math.round(TEXT_SCALES[session.textSize] * 100)} percent.`;
  });
}
async function returnHome() {
  if (shouldWarnBeforeLeaving() && !await ask('Return to TheCrumbs.org', 'Do you want to return to the home page of TheCrumbs.org without saving your session?', 'Return home', 'Stay here')) return;
  allowLeave = true;
  window.location.assign(new URL('../', window.location.href));
}
controls.quit.addEventListener('click', returnHome);
byId('reader-help').addEventListener('click', () => { hideHint(); byId('help-dialog').showModal(); });

document.addEventListener('click', event => {
  hideHint();
  const home = event.target.closest('a[data-reader-home]');
  if (home && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    returnHome();
    return;
  }
  const close = event.target.closest('[data-close]');
  if (close) {
    if (close.dataset.close === 'save-dialog' && saving) return;
    byId(close.dataset.close).close();
  }
  const link = event.target.closest('a[data-crumb]');
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (byId('favorites-dialog').open) byId('favorites-dialog').close();
  navigate(Number(link.dataset.crumb), { focus: true });
});

async function start() {
  controls.quit.disabled = false;
  byId('loading-state').hidden = false;
  byId('load-error').hidden = true;
  byId('save-state').textContent = 'Loading crumbs…';
  byId('reading-progress').textContent = 'Loading crumbs…';
  pane.setAttribute('aria-busy', 'true');
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch(new URL('./Crumbs.txt', import.meta.url), { cache: 'no-cache', signal: abort.signal });
    if (!response.ok) throw new Error('The text file is unavailable.');
    corpus = parseCorpus(await response.text());
    const notices = [];
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        session = restoreSession(JSON.parse(stored), corpus.length);
        markSaved(snapshot(session), 'browser');
      }
    } catch (error) {
      notices.push(error.name === 'SecurityError'
        ? 'Browser storage is unavailable. Reading and saving to a text file still work.'
        : 'The saved browser session could not be restored. It has been left unchanged. A fresh session is open; a saved text file can also be loaded.');
    }
    const requested = crumbFromURL(new URL(window.location.href).searchParams.get('crumb'), corpus.length);
    if (!session) session = createSession(Number.isInteger(requested) ? requested : 1);
    if (Number.isNaN(requested)) notices.push(`The address contains an invalid crumb number. Available numbers are 1–${numberFormat.format(corpus.length)}.`);
    else if (requested !== null) visit(session, requested);
    initializeHistory();
    renderCrumb();
    if (notices.length) showMessage('Reading session', notices.join(' '));
  } catch (error) {
    byId('loading-state').hidden = true;
    byId('load-error').hidden = false;
    byId('load-error-detail').textContent = error.name === 'AbortError' ? 'The request did not finish. Check the connection and try again.' : `${error.message} Check the connection and try again.`;
    byId('save-state').textContent = 'Not loaded';
    byId('reading-progress').textContent = 'Collection unavailable';
    pane.setAttribute('aria-busy', 'false');
  } finally { clearTimeout(timeout); }
}

byId('retry').addEventListener('click', start);
initializeHints();
start();
