import {
  HISTORY_LIMIT, TEXT_SCALES, parseCorpus, createSession, snapshot, fingerprint,
  restoreSession, visit, moveInHistory, nextRandom, restartRandom, nextSearchRandom,
  restartSearchRandom, crumbFromURL, linkTokens, MAX_SEARCH_QUERY_LENGTH,
} from './core.js?v=20261105-naming1';
import { encodeSession, decodeSession, MAX_SESSION_FILE_BYTES } from './session.js?v=20261105-naming1';
import { SearchClient } from './search.js?v=3';

// Keep the existing key and JSON mechanism so previous browser saves remain readable.
const STORAGE_KEY = 'thecrumbs.reader.session.v1';
const AUTO_SAVE_DELAY = 500;
const byId = id => document.getElementById(id);
const controls = Object.fromEntries([
  'load-session', 'save-session', 'search', 'favorites', 'back', 'forward', 'quit',
  'text-smaller', 'text-larger', 'previous', 'next', 'random', 'favorite',
].map(id => [id, byId(id)]));
const pane = byId('reading-pane');
const numberFormat = new Intl.NumberFormat('en-US');
let corpus = [];
let session = null;
let baselineFingerprint = null;
let baselineStorage = null;
let browserFingerprint = null;
let autoSaveTimer;
let autoSaveIdle = null;
let autoSaveFailed = false;
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
let searchClient = null;
let regexClient = null;
let searchClientPromise = null;
let searchAbort = null;
let searchBusy = false;
let loadingSession = false;
let searchDraft = '';
let previousSearchMode = 'text';
let searchResult = { matches: [], highlights: {} };
let searchMatchSet = new Set();
let exitSearchTimer;
const hintDescriptions = new WeakMap();
let hintDescriptionCount = 0;
let hintOwner = null;
let scheduledHintOwner = null;
let showHintTimer;
let hideHintTimer;

// New interface copy lives in HTML so it can be translated without editing logic.
function message(key, values = {}) {
  const template = byId(`message-${key}`);
  const text = template?.content?.textContent.trim() || '';
  return text.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
}

function setSearchResult(result) {
  searchResult = result;
  searchMatchSet = new Set(result.matches);
}

async function getSearchClient(mode) {
  // Regular-expression searches can run even when alias data is unavailable.
  if (mode === 'regex') return regexClient ||= new SearchClient(corpus, '');
  if (searchClient) return searchClient;
  if (!searchClientPromise) {
    searchClientPromise = (async () => {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 10000);
      try {
        const response = await fetch(new URL('../Crumbs_Synonyms.txt', import.meta.url), { cache: 'no-cache', signal: abort.signal });
        if (!response.ok) throw new Error('SYNONYMS_INVALID');
        searchClient = new SearchClient(corpus, await response.text());
        return searchClient;
      } catch {
        const error = new Error('SYNONYMS_INVALID');
        error.code = 'SYNONYMS_INVALID';
        throw error;
      } finally {
        clearTimeout(timeout);
        searchClientPromise = null;
      }
    })();
  }
  return searchClientPromise;
}

function searchErrorMessage(error) {
  const keys = {
    EMPTY_QUERY: 'search-empty', INVALID_REGEX: 'search-invalid-regex',
    SYNONYMS_INVALID: 'search-synonyms-unavailable', SEARCH_TIMEOUT: 'search-timeout',
  };
  return message(keys[error.code] || 'search-unavailable', { detail: error.detail || '' });
}

async function restoreSearch(restored) {
  if (!restored.search.active) return { result: { matches: [], highlights: {} }, notice: '' };
  try {
    const client = await getSearchClient(restored.search.mode);
    const result = await client.run(restored.search.query, restored.search.mode);
    if (!result.matches.length) throw new Error('No remaining matches');
    const matches = new Set(result.matches);
    restored.search.visited = new Set([...restored.search.visited].filter(number => matches.has(number)));
    return { result, notice: '' };
  } catch {
    restored.search.active = false;
    restored.search.visited.clear();
    return { result: { matches: [], highlights: {} }, notice: message('search-restored-unavailable') };
  }
}

function isDirty() {
  if (!session) return false;
  const current = fingerprint(session);
  return current !== baselineFingerprint && current !== browserFingerprint;
}
function needsBrowserSave() { return session !== null && fingerprint(session) !== browserFingerprint; }
function shouldWarnBeforeLeaving() { return hasNavigated && isDirty(); }

function beforeUnload(event) {
  flushAutoSave();
  if (allowLeave || !shouldWarnBeforeLeaving()) return;
  event.preventDefault();
  event.returnValue = '';
}

function updateSaveState() {
  const unavailable = !session || saving || loadingSession || pendingHistory !== null;
  controls['save-session'].disabled = unavailable;
  setHint(controls['save-session'], !session
    ? 'The Save session form becomes available when the crumbs finish loading.'
    : 'Open the Save session form to save your progress in this browser or download a copy.');
  byId('save-browser').disabled = unavailable || !needsBrowserSave();
  setHint(byId('save-browser'), session && !needsBrowserSave()
    ? 'This browser already has the current session saved.'
    : 'Save your current progress in this browser so reading can continue here later.');
  byId('save-file').disabled = unavailable;
  byId('auto-save').disabled = unavailable;
  byId('auto-save').textContent = session?.autoSave
    ? 'Disable auto saving in this browser' : 'Enable auto saving in this browser';
  setHint(byId('auto-save'), session?.autoSave
    ? 'Turn off auto saving. Save the current session and this choice now.'
    : 'Save this session now, then save later changes automatically in this browser.');
  byId('auto-save-status').textContent = autoSaveFailed && session?.autoSave
    ? 'Auto saving is paused after a storage error. Save now in this browser to retry, or save a text file.'
    : session?.autoSave ? 'Auto saving is enabled. Changes are saved shortly after activity stops.'
    : 'Auto saving is disabled. Browser saving and text-file saving are manual.';
  const warn = shouldWarnBeforeLeaving();
  if (warn && !unloadListener) { window.addEventListener('beforeunload', beforeUnload); unloadListener = true; }
  if (!warn && unloadListener) { window.removeEventListener('beforeunload', beforeUnload); unloadListener = false; }
}

function cancelAutoSave() {
  clearTimeout(autoSaveTimer);
  if (autoSaveIdle !== null) window.cancelIdleCallback?.(autoSaveIdle);
  autoSaveIdle = null;
}

function scheduleAutoSave() {
  cancelAutoSave();
  if (!session?.autoSave || autoSaveFailed || !needsBrowserSave() || saving || loadingSession || pendingHistory !== null) return;
  // Coalesce rapid changes and let the reading interface update before writing.
  autoSaveTimer = setTimeout(() => {
    autoSaveIdle = typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(() => { autoSaveIdle = null; flushAutoSave(); }, { timeout: 1000 })
      : null;
    if (typeof window.requestIdleCallback !== 'function') flushAutoSave();
  }, AUTO_SAVE_DELAY);
}

function writeBrowserSession() {
  const data = snapshot(session);
  const serialized = JSON.stringify(data);
  window.localStorage.setItem(STORAGE_KEY, serialized);
  browserFingerprint = serialized;
  autoSaveFailed = false;
  markSaved(data, 'browser');
  updateBrowserDataControl();
}

function flushAutoSave() {
  cancelAutoSave();
  if (!session?.autoSave || autoSaveFailed || !needsBrowserSave() || pendingHistory !== null) return;
  try { writeBrowserSession(); }
  catch {
    autoSaveFailed = true;
    updateSaveState();
    saveError('Browser storage is unavailable or full. Save now in this browser to retry, or save a text file.');
    showToast('Auto saving failed and is paused. Open Save to retry or save a text file.', 10000);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAutoSave();
});
window.addEventListener('pagehide', flushAutoSave);
window.addEventListener('storage', event => {
  if (!session || event.storageArea !== window.localStorage ||
      !((event.key === STORAGE_KEY && event.newValue === null) || event.key === null)) return;
  forgetBrowserSave();
  showToast('The saved browser session was erased in another tab. Auto saving is now disabled here.');
});

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
    }
  });
  document.addEventListener('scroll', hideHint, true);
  window.addEventListener('resize', hideHint);
}

function showToast(message, duration = 4500) {
  clearTimeout(toastTimer);
  byId('toast').textContent = message;
  byId('toast').hidden = false;
  toastTimer = setTimeout(() => { byId('toast').hidden = true; }, duration);
}

function showMessage(title, message) {
  byId('message-title').textContent = title;
  byId('message-text').textContent = message;
  if (!byId('message-dialog').open) byId('message-dialog').showModal();
}

function ask(title, message, accept, cancel = 'Cancel', { cancelIsPrimary = false, cancelValue = false, acceptHint = '' } = {}) {
  const dialog = byId('confirm-dialog');
  byId('confirm-title').textContent = title;
  byId('confirm-text').textContent = message;
  byId('confirm-accept').textContent = accept;
  byId('confirm-cancel').textContent = cancel;
  byId('confirm-accept').classList.toggle('primary', !cancelIsPrimary);
  byId('confirm-cancel').classList.toggle('primary', cancelIsPrimary);
  setHint(byId('confirm-cancel'), cancelValue === 'save'
    ? 'Stay in the Crumb Reader and open the Save session form.'
    : 'Cancel this action and keep the current reading session.');
  const acceptHints = {
    'Return home': 'Leave the Crumb Reader and open the homepage without saving the current changes.',
    'Start new round': 'Start the visited count again and read a random crumb. Keep Favorites and viewing history.',
    'Load session': 'Replace the open session with the one saved in the selected file.',
  };
  setHint(byId('confirm-accept'), acceptHint || acceptHints[accept] || 'Carry out the action described above.');
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
    const no = () => finish(cancelValue);
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

function appendHighlighted(parent, text, offset, ranges) {
  let cursor = 0;
  for (const [start, end] of ranges) {
    const from = Math.max(0, start - offset);
    const to = Math.min(text.length, end - offset);
    if (from >= to || to <= cursor) continue;
    if (from > cursor) parent.append(document.createTextNode(text.slice(cursor, from)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(Math.max(cursor, from), to);
    parent.append(mark);
    cursor = to;
  }
  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

function renderText(element, text, lineBreaks = true, ranges = []) {
  const fragment = document.createDocumentFragment();
  let offset = 0;
  for (const token of linkTokens(text, corpus.length, lineBreaks)) {
    if (token.type === 'text') {
      appendHighlighted(fragment, token.text, offset, ranges);
      offset += token.text.length;
      continue;
    }
    const link = document.createElement('a');
    appendHighlighted(link, token.text, offset, ranges);
    offset += token.text.length;
    if (token.type === 'crumb') {
      link.href = crumbURL(token.number);
      link.dataset.crumb = String(token.number);
      const title = corpus[token.number - 1].title;
      link.setAttribute('aria-label', `Crumb ${token.number}${title ? `: ${title}` : ''}`);
      setHint(link, `Read crumb ${token.number}${title ? `: ${title}` : ''}. Use Back to return.`, false);
    } else {
      link.href = token.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    fragment.append(link);
  }
  element.replaceChildren(fragment);
}

function updateControls() {
  const unavailable = !session || loadingSession || pendingHistory !== null;
  for (const [name, control] of Object.entries(controls)) if (name !== 'quit') control.disabled = unavailable;
  if (!session) return;
  controls.back.disabled = unavailable || session.historyIndex === 0;
  controls.forward.disabled = unavailable || session.historyIndex === session.history.length - 1;
  controls.previous.disabled = unavailable || session.current === 1;
  controls.next.disabled = unavailable || session.current === corpus.length;
  controls['text-smaller'].disabled = unavailable || session.textSize === 0;
  controls['text-larger'].disabled = unavailable || session.textSize === TEXT_SCALES.length - 1;
  controls.favorite.setAttribute('aria-pressed', String(session.favorites.has(session.current)));
  setHint(controls.favorite, session.favorites.has(session.current)
    ? 'Remove this crumb from Favorites.' : 'Add this crumb to Favorites.');
  setHint(controls.back, session.historyIndex === 0
    ? 'There is no earlier crumb in the viewing history.' : 'Return to the crumb viewed before this one.');
  setHint(controls.forward, session.historyIndex === session.history.length - 1
    ? 'There is no later crumb in the viewing history.' : 'Return to the crumb viewed next after using Back.');
  setHint(controls['text-smaller'], session.textSize === 0
    ? 'The crumb’s title and text are already at their smallest size.' : 'Make the crumb’s title and text smaller.');
  setHint(controls['text-larger'], session.textSize === TEXT_SCALES.length - 1
    ? 'The crumb’s title and text are already at their largest size.' : 'Make the crumb’s title and text larger.');
  setHint(controls.next, message(session.search.active ? 'hint-next-search' : 'hint-next'));
  setHint(controls.previous, message(session.search.active ? 'hint-previous-search' : 'hint-previous'));
  setHint(controls.random, message(session.search.active ? 'hint-random-search' : 'hint-random'));
  byId('search-status').hidden = !session.search.active;
  if (session.search.active) {
    const index = searchResult.matches.indexOf(session.current);
    byId('search-position').textContent = message(index === -1 ? 'search-current-outside' : 'search-count', {
      position: numberFormat.format(index + 1), total: numberFormat.format(searchResult.matches.length),
    });
  }
  byId('reading-progress').textContent = `${numberFormat.format(session.visited.size)} of ${numberFormat.format(corpus.length)} visited`;
  document.documentElement.style.setProperty('--text-scale', TEXT_SCALES[session.textSize]);
  updateSaveState();
  scheduleAutoSave();
}

function renderCrumb({ focus = false, restoreScroll = false, keepScroll = false } = {}) {
  hideHint();
  clearTimeout(exitSearchTimer);
  const previousScroll = pane.scrollTop;
  if (lastDisplayedCrumb !== null && lastDisplayedCrumb !== session.current) hasNavigated = true;
  lastDisplayedCrumb = session.current;
  const crumb = corpus[session.current - 1];
  if (session.search.active && searchMatchSet.has(session.current)) session.search.visited.add(session.current);
  const highlights = session.search.active ? searchResult.highlights[session.current] : null;
  byId('crumb-number').textContent = `Crumb ${crumb.number}`;
  byId('crumb-title').hidden = crumb.title.length === 0;
  renderText(byId('crumb-title'), crumb.title, false, highlights?.title || []);
  renderText(byId('crumb-body'), crumb.body, true, highlights?.body || []);
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
  const scroll = keepScroll ? previousScroll : restoreScroll ? (scrollPositions.get(entryIds[session.historyIndex]) || 0) : 0;
  pane.scrollTop = scroll;
  if (focus) pane.focus({ preventScroll: true });
}

function navigate(number, { focus = false, replace = false } = {}) {
  if (!session || pendingHistory !== null || !Number.isInteger(number) || number < 1 || number > corpus.length) return;
  rememberScroll();
  const index = session.historyIndex;
  if (!visit(session, number)) {
    renderCrumb({ focus, keepScroll: true });
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

function readStep(direction) {
  if (!session || pendingHistory !== null) return;
  if (!session.search.active) { navigate(session.current + direction); return; }
  const matches = searchResult.matches;
  const number = direction > 0
    ? matches.find(value => value > session.current)
    : matches.findLast(value => value < session.current);
  if (number === undefined) showToast(message(direction > 0 ? 'search-no-next' : 'search-no-previous'));
  else navigate(number);
}

async function readRandom() {
  if (!session || pendingHistory !== null) return;
  if (session.search.active) {
    if (searchResult.matches.length === 1 && searchMatchSet.has(session.current)) {
      showToast(message('search-random-only-current'));
      return;
    }
    let number = nextSearchRandom(session, searchResult.matches);
    if (number === null) {
      const accepted = await ask(message('search-random-exhausted-title'), message('search-random-exhausted'), message('search-random-restart'), 'Cancel', { acceptHint: message('hint-search-random-restart') });
      if (!accepted) return;
      restartSearchRandom(session, searchResult.matches);
      number = nextSearchRandom(session, searchResult.matches);
      updateControls();
    }
    if (number !== null) navigate(number);
    return;
  }
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
    setHint(link, `Read crumb ${number}. Use Back to return.`, false);
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

function markSaved(data, storage) {
  baselineFingerprint = JSON.stringify(data);
  baselineStorage = storage;
  updateSaveState();
}

function forgetBrowserSave() {
  cancelAutoSave();
  session.autoSave = false;
  autoSaveFailed = false;
  browserFingerprint = null;
  if (baselineStorage === 'browser') {
    baselineFingerprint = null;
    baselineStorage = null;
  }
  updateSaveState();
  updateBrowserDataControl();
}

function updateBrowserDataControl() {
  const control = byId('erase-browser');
  try {
    const exists = window.localStorage.getItem(STORAGE_KEY) !== null;
    control.disabled = saving || !exists;
    setHint(control, exists
      ? 'Erase the session saved in this browser and turn off auto saving. Keep reading the open session.'
      : 'There is no saved Crumb Reader session in this browser to erase.');
  } catch {
    control.disabled = true;
    setHint(control, 'The browser is not allowing access to its saved session.');
  }
}

function saveError(message) {
  byId('save-error').textContent = message;
  byId('save-error').hidden = false;
}

function proposedSessionFilename() {
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `crumbs-session-${year}-${month}-${day}.txt`;
}

function safeFilename() {
  let filename = byId('session-filename').value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
  if (!filename || /^\.+$/.test(filename)) filename = proposedSessionFilename();
  if (!filename.toLowerCase().endsWith('.txt')) filename += '.txt';
  return filename;
}

async function saveFile() {
  if (saving || !session || pendingHistory !== null) return;
  const data = snapshot(session);
  const filename = safeFilename();
  saving = true;
  cancelAutoSave();
  updateSaveState();
  updateBrowserDataControl();
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
    markSaved(data, 'file');
    byId('save-dialog').close();
    showToast(handle ? 'Session saved to a text file.' : 'Session download started.');
  } catch {
    saveError('The session file could not be saved. Try again, or save in this browser.');
  } finally {
    saving = false;
    byId('save-file').disabled = false;
    byId('save-file').textContent = 'Save as a text file';
    byId('save-browser').disabled = false;
    updateBrowserDataControl();
    updateSaveState();
    scheduleAutoSave();
  }
}

async function importFile(file) {
  if (!file || loadingSession) return;
  loadingSession = true;
  cancelAutoSave();
  updateControls();
  try {
    if (file.size > MAX_SESSION_FILE_BYTES) throw new Error('The selected session file is too large.');
    const restored = await decodeSession(await file.text(), corpus.length);
    if (isDirty() && !await ask('Load another session', 'The current session has unsaved changes. Replace it with the session from this file?', 'Load session')) return;
    const savedFingerprint = fingerprint(restored);
    const restoredSearch = await restoreSearch(restored);
    cancelAutoSave();
    session = restored;
    setSearchResult(restoredSearch.result);
    autoSaveFailed = false;
    baselineFingerprint = savedFingerprint;
    baselineStorage = 'file';
    initializeHistory();
    renderCrumb({ focus: true });
    showToast(restoredSearch.notice || (session.autoSave
      ? 'Session loaded. Auto saving will update this browser’s saved copy.'
      : 'Session loaded. The browser’s saved copy has not been changed.'));
  } catch (error) {
    showMessage('Session could not be loaded', error instanceof SyntaxError ? 'The session file is damaged or incomplete.' : error.message);
  } finally {
    loadingSession = false;
    updateControls();
  }
}

controls['load-session'].addEventListener('click', () => { byId('session-file').value = ''; byId('session-file').click(); });
byId('session-file').addEventListener('change', event => importFile(event.target.files[0]));
function openSaveDialog() {
  if (!session || saving || pendingHistory !== null) return;
  byId('session-filename').value = proposedSessionFilename();
  byId('save-error').hidden = !autoSaveFailed;
  updateBrowserDataControl();
  updateSaveState();
  byId('save-dialog').showModal();
}
controls['save-session'].addEventListener('click', openSaveDialog);
byId('auto-save').addEventListener('click', () => {
  if (saving || !session || pendingHistory !== null) return;
  cancelAutoSave();
  session.autoSave = !session.autoSave;
  autoSaveFailed = false;
  byId('save-error').hidden = true;
  try {
    writeBrowserSession();
    byId('save-dialog').close();
    showToast(session.autoSave ? 'Auto saving is enabled in this browser.' : 'Auto saving is disabled in this browser.');
  }
  catch {
    autoSaveFailed = true;
    updateSaveState();
    saveError('The auto-saving choice could not be saved in this browser. Save now in this browser to retry, or save a text file.');
  }
});
byId('save-browser').addEventListener('click', () => {
  if (saving || !session || !needsBrowserSave()) return;
  cancelAutoSave();
  try {
    writeBrowserSession();
    byId('save-dialog').close();
    showToast('Session saved in this browser.');
  } catch { saveError('Browser storage is unavailable or full. Save the session as a text file instead.'); }
});
byId('erase-browser').addEventListener('click', () => {
  if (saving || !session) return;
  byId('save-error').hidden = true;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    forgetBrowserSave();
    byId('save-dialog').close();
    showToast('The saved browser session was erased and auto saving is disabled. The current reading session remains open.', 7000);
  } catch {
    saveError('The saved session could not be erased because browser storage is unavailable.');
  }
});
byId('save-file').addEventListener('click', saveFile);
byId('save-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
function setSearchBusy(busy) {
  searchBusy = busy;
  byId('search-form').setAttribute('aria-busy', String(busy));
  byId('search-submit').disabled = busy;
  byId('search-help').disabled = busy;
  byId('search-mode').disabled = busy;
  byId('search-input').readOnly = busy;
  byId('search-submit').textContent = message(busy ? 'search-loading' : 'search-submit');
}

function showSearchError(text) {
  byId('search-error').textContent = text;
  byId('search-error').hidden = false;
  byId('search-input').setAttribute('aria-invalid', 'true');
  byId('search-input').focus();
}

function configureSearchInput() {
  const mode = byId('search-mode').value;
  const input = byId('search-input');
  input.type = 'text';
  input.inputMode = mode === 'number' ? 'numeric' : 'text';
  input.enterKeyHint = 'search';
  input.maxLength = MAX_SEARCH_QUERY_LENGTH;
  input.setAttribute('aria-label', message(`search-input-${mode}`));
  const inputHints = {
    text: 'Enter a word or phrase to find in crumb titles and text.',
    number: `Enter a whole crumb number from 1 to ${numberFormat.format(corpus.length)}.`,
    regex: 'Enter a regular expression. Use the yellow question mark for examples and help.',
  };
  setHint(input, inputHints[mode]);
  setHint(byId('search-submit'), mode === 'number'
    ? 'Go to the entered crumb number and end any active search.'
    : 'Find matching crumbs and open the first one in numerical order.');
  input.placeholder = mode === 'number'
    ? message('search-number-placeholder', { total: numberFormat.format(corpus.length) }) : '';
  input.removeAttribute('aria-invalid');
  byId('search-error').hidden = true;
}

function endSearch({ announce = true } = {}) {
  if (!session?.search.active) return;
  session.search.active = false;
  session.search.visited.clear();
  setSearchResult({ matches: [], highlights: {} });
  renderCrumb({ keepScroll: true });
  if (announce) byId('announcement').textContent = message('search-ended');
}

controls.search.addEventListener('click', () => {
  byId('search-mode').value = session.search.mode;
  byId('search-input').value = session.search.query;
  searchDraft = session.search.query;
  previousSearchMode = session.search.mode;
  configureSearchInput();
  byId('search-dialog').showModal();
  byId('search-input').focus();
  byId('search-input').select();
});
byId('search-mode').addEventListener('change', () => {
  if (previousSearchMode !== 'number') searchDraft = byId('search-input').value;
  configureSearchInput();
  previousSearchMode = byId('search-mode').value;
  byId('search-input').value = previousSearchMode === 'number' ? session.current : searchDraft;
  byId('search-input').focus();
  byId('search-input').select();
});
byId('search-input').addEventListener('input', () => {
  byId('search-input').removeAttribute('aria-invalid');
  byId('search-error').hidden = true;
});
byId('search-dialog').addEventListener('close', () => {
  searchAbort?.abort();
  searchAbort = null;
  setSearchBusy(false);
});
byId('search-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!session || searchBusy || pendingHistory !== null) return;
  const mode = byId('search-mode').value;
  const query = byId('search-input').value;
  byId('search-error').hidden = true;
  byId('search-input').removeAttribute('aria-invalid');
  if (mode === 'number') {
    const number = crumbFromURL(query.trim(), corpus.length);
    if (!Number.isInteger(number)) {
      showSearchError(message('search-number-invalid', { total: numberFormat.format(corpus.length) }));
      return;
    }
    endSearch({ announce: false });
    byId('search-dialog').close();
    navigate(number, { focus: true });
    return;
  }
  if (!query.length || (mode === 'text' && !query.trim())) {
    showSearchError(message('search-empty'));
    return;
  }
  const abort = new AbortController();
  searchAbort = abort;
  setSearchBusy(true);
  try {
    const client = await getSearchClient(mode);
    if (abort.signal.aborted) return;
    const result = await client.run(query, mode, { signal: abort.signal });
    if (abort.signal.aborted || !byId('search-dialog').open) return;
    const next = result.matches[0];
    if (next === undefined) {
      showSearchError(message('search-no-matches'));
      return;
    }
    session.search = { query, mode, active: true, visited: new Set() };
    setSearchResult(result);
    byId('search-dialog').close();
    navigate(next, { focus: true });
  } catch (error) {
    if (error.name !== 'AbortError' && !abort.signal.aborted) showSearchError(searchErrorMessage(error));
  } finally {
    if (searchAbort === abort) {
      searchAbort = null;
      setSearchBusy(false);
    }
  }
});
controls.favorites.addEventListener('click', showFavorites);
controls.back.addEventListener('click', () => historyStep(-1));
controls.forward.addEventListener('click', () => historyStep(1));
controls.previous.addEventListener('click', () => readStep(-1));
controls.next.addEventListener('click', () => readStep(1));
controls.random.addEventListener('click', readRandom);
controls.favorite.addEventListener('click', () => {
  if (!session || pendingHistory !== null) return;
  if (session.favorites.has(session.current)) session.favorites.delete(session.current);
  else session.favorites.add(session.current);
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
  flushAutoSave();
  if (shouldWarnBeforeLeaving()) {
    const choice = await ask('Return to TheCrumbs.org', 'Do you want to return to the home page of TheCrumbs.org without saving your session?', 'Return home', 'Stay here and save', { cancelIsPrimary: true, cancelValue: 'save' });
    if (choice === 'save') { openSaveDialog(); return; }
    if (!choice) return;
  }
  allowLeave = true;
  window.location.assign(new URL('../', window.location.href));
}
controls.quit.addEventListener('click', returnHome);
function openHelp({ section = null, showControlHints = false } = {}) {
  hideHint();
  if (showControlHints) showPhoneHints();
  const dialog = byId('help-dialog');
  setHint(dialog.querySelector('[data-close]'), section
    ? 'Close Help and return to the Search form.' : 'Close Help and continue reading.');
  if (!dialog.open) dialog.showModal();
  const content = byId('help-content');
  content.scrollTop = 0;
  const heading = byId(section || 'help-title');
  if (section) content.scrollTop += heading.getBoundingClientRect().top - content.getBoundingClientRect().top;
  heading.focus({ preventScroll: true });
}
byId('reader-help').addEventListener('click', () => openHelp({ showControlHints: true }));
byId('search-help').addEventListener('click', () => openHelp({ section: 'help-search' }));
byId('help-dialog').addEventListener('close', hideHint);

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

function initializeSearchExit() {
  const crumb = byId('crumb');
  let gesture = null;
  const selected = () => Boolean(window.getSelection()?.toString());
  crumb.addEventListener('pointerdown', event => {
    clearTimeout(exitSearchTimer);
    gesture = { x: event.clientX, y: event.clientY, time: performance.now(), moved: false, selected: selected() };
  });
  crumb.addEventListener('pointermove', event => {
    if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6) gesture.moved = true;
  });
  crumb.addEventListener('pointercancel', () => { if (gesture) gesture.moved = true; });
  pane.addEventListener('scroll', () => {
    if (gesture) gesture.moved = true;
    clearTimeout(exitSearchTimer);
  }, { passive: true });
  crumb.addEventListener('click', event => {
    clearTimeout(exitSearchTimer);
    if (!session?.search.active || event.target.closest('a, button, input, select') || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.detail > 1 ||
        gesture?.moved || gesture?.selected || selected() ||
        (gesture && performance.now() - gesture.time > 700)) return;
    // Allow double-click word selection to complete before treating a click as exit.
    exitSearchTimer = setTimeout(() => {
      if (!selected() && !document.querySelector('dialog[open]')) endSearch();
    }, 250);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]') && session?.search.active) {
      event.preventDefault();
      endSearch();
    }
  });
}

function showPhoneHints() {
  if (window.matchMedia('(max-width: 800px)').matches) document.body.classList.add('initial-hints');
}

function initializePhoneHints() {
  showPhoneHints();
  const dismiss = event => {
    // Help can be read and closed without dismissing the labels behind it.
    if (byId('help-dialog').open || event.target?.closest?.('#help-dialog')) return;
    document.body.classList.remove('initial-hints');
  };
  // Capture removes labels before the action; it never cancels or swallows that action.
  document.addEventListener('pointerdown', dismiss, true);
  document.addEventListener('click', dismiss, true);
  document.addEventListener('keydown', dismiss, true);
}

function updateDialogViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty('--dialog-viewport-height', `${viewport?.height || window.innerHeight}px`);
  document.documentElement.style.setProperty('--dialog-viewport-top', `${viewport?.offsetTop || 0}px`);
}
window.visualViewport?.addEventListener('resize', updateDialogViewport);
window.visualViewport?.addEventListener('scroll', updateDialogViewport);
window.addEventListener('resize', updateDialogViewport);

async function start() {
  controls.quit.disabled = false;
  byId('loading-state').hidden = false;
  byId('load-error').hidden = true;
  byId('reading-progress').textContent = 'Loading crumbs…';
  pane.setAttribute('aria-busy', 'true');
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch(new URL('../Crumbs.txt', import.meta.url), { cache: 'no-cache', signal: abort.signal });
    if (!response.ok) throw new Error('The text file is unavailable.');
    corpus = parseCorpus(await response.text());
    const notices = [];
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        session = restoreSession(JSON.parse(stored), corpus.length);
        browserFingerprint = fingerprint(session);
        markSaved(snapshot(session), 'browser');
      }
    } catch (error) {
      notices.push(error.name === 'SecurityError'
        ? 'Browser storage is unavailable. Reading and saving to a text file still work.'
        : 'The saved browser session could not be restored. It has been left unchanged. A fresh session is open; a saved text file can also be loaded.');
    }
    const requested = crumbFromURL(new URL(window.location.href).searchParams.get('crumb'), corpus.length);
    if (!session) {
      session = createSession(Number.isInteger(requested) ? requested : 1);
      if (window.matchMedia('(max-width: 800px), (max-height: 500px)').matches) session.textSize = 0;
      baselineFingerprint = fingerprint(session);
      baselineStorage = 'initial';
    }
    if (Number.isNaN(requested)) notices.push(`The address contains an invalid crumb number. Available numbers are 1–${numberFormat.format(corpus.length)}.`);
    else if (requested !== null) visit(session, requested);
    const restoredSearch = await restoreSearch(session);
    setSearchResult(restoredSearch.result);
    if (restoredSearch.notice) notices.push(restoredSearch.notice);
    initializeHistory();
    renderCrumb();
    if (notices.length) showMessage('Reading session', notices.join(' '));
  } catch (error) {
    byId('loading-state').hidden = true;
    byId('load-error').hidden = false;
    byId('load-error-detail').textContent = error.name === 'AbortError' ? 'The request did not finish. Check the connection and try again.' : `${error.message} Check the connection and try again.`;
    byId('reading-progress').textContent = 'Crumbs unavailable';
    pane.setAttribute('aria-busy', 'false');
  } finally { clearTimeout(timeout); }
}

byId('retry').addEventListener('click', start);
initializeHints();
initializePhoneHints();
initializeSearchExit();
updateDialogViewport();
setSearchBusy(false);
start();
