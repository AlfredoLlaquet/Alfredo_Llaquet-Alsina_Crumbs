// Search input is data. Only the worker executes user-supplied regular expressions.
const WORD_CHARACTER = '[\\p{L}\\p{N}\\p{M}_]';
const START_BOUNDARY = `(?<!${WORD_CHARACTER})`;
const END_BOUNDARY = `(?!${WORD_CHARACTER})`;

export class SearchError extends Error {
  constructor(code, detail = '') {
    super(code);
    this.name = 'SearchError';
    this.code = code;
    this.detail = detail;
  }
}

// One CSV record per synonym group. Quotes protect commas; doubled quotes
// represent a literal quote. Empty lines and a UTF-8 BOM are harmless.
export function parseSynonyms(text) {
  if (typeof text !== 'string') throw new SearchError('SYNONYMS_INVALID');
  const groups = [];
  let group = [];
  let value = '';
  let state = 'start';
  const invalid = () => { throw new SearchError('SYNONYMS_INVALID'); };
  const field = () => {
    const alias = value.trim();
    if (!alias) invalid();
    group.push(alias);
    value = '';
    state = 'start';
  };
  const record = () => {
    if (state === 'start' && !value && !group.length) return;
    field();
    groups.push(group);
    group = [];
  };
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (state === 'quoted') {
      if (char === '"') {
        if (source[index + 1] === '"') { value += '"'; index++; }
        else state = 'closed';
      } else if (char === '\r' || char === '\n') invalid();
      else value += char;
      continue;
    }
    if (char === '\r' || char === '\n') {
      record();
      if (char === '\r' && source[index + 1] === '\n') index++;
      continue;
    }
    if (char === ',') { field(); continue; }
    if (state === 'closed') {
      if (char !== ' ' && char !== '\t') invalid();
      continue;
    }
    if (state === 'start') {
      if (char === ' ' || char === '\t') continue;
      if (char === '"') { state = 'quoted'; continue; }
      state = 'plain';
    }
    if (char === '"') invalid();
    value += char;
  }
  if (state === 'quoted') invalid();
  record();
  return groups;
}

function escapePattern(value) {
  return value.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}

function literalSearchSource(query, groups) {
  const entries = [];
  const groupSources = [];
  for (const group of groups) {
    if (!Array.isArray(group) || !group.length || group.some(alias => typeof alias !== 'string' || !alias)) {
      throw new SearchError('SYNONYMS_INVALID');
    }
    const alternatives = [...new Set(group)].sort((a, b) => b.length - a.length);
    const index = groupSources.length;
    groupSources.push(`${START_BOUNDARY}(?:${alternatives.map(escapePattern).join('|')})${END_BOUNDARY}`);
    for (const alias of alternatives) entries.push({ alias, group: index });
  }
  if (!entries.length) return escapePattern(query);
  entries.sort((a, b) => b.alias.length - a.alias.length);
  // Captures retain the identity of each alias without approximating Unicode
  // case folding. Sorting once makes overlapping aliases prefer the longest.
  const recognizer = new RegExp(
    `${START_BOUNDARY}(?:${entries.map(entry => `(${escapePattern(entry.alias)})`).join('|')})${END_BOUNDARY}`,
    'giu',
  );
  const parts = [];
  let cursor = 0;
  for (const match of query.matchAll(recognizer)) {
    parts.push(escapePattern(query.slice(cursor, match.index)));
    const index = match.findIndex((value, position) => position > 0 && value !== undefined) - 1;
    parts.push(groupSources[entries[index].group]);
    cursor = match.index + match[0].length;
  }
  parts.push(escapePattern(query.slice(cursor)));
  return parts.join('');
}

// Returns serializable pattern information. Compilation is deliberately kept
// out of SearchClient, so regex work cannot block the page's event loop.
export function compileSearch(query, mode = 'text', groups = []) {
  if (typeof query !== 'string' || !query || (mode === 'text' && !query.trim())) throw new SearchError('EMPTY_QUERY');
  let source;
  let flags;
  if (mode === 'text') {
    source = literalSearchSource(query, groups);
    flags = 'iu';
  } else if (mode === 'regex') {
    source = query;
    flags = '';
    // Slash-delimited notation is optional. A lone leading slash remains
    // part of a bare pattern; a closing slash makes its suffix flags, so
    // unsupported flags produce a visible validation error.
    if (query.startsWith('/')) {
      const closing = query.lastIndexOf('/');
      if (closing > 0) {
        source = query.slice(1, closing);
        flags = query.slice(closing + 1);
      }
    }
  } else throw new SearchError('INVALID_QUERY');
  try {
    const expression = new RegExp(source, flags);
    return { source: expression.source, flags: expression.flags };
  } catch (error) {
    throw new SearchError('INVALID_REGEX', error.message);
  }
}

function scanField(text, compiled) {
  const flags = compiled.flags.includes('g') ? compiled.flags : `${compiled.flags}g`;
  const expression = new RegExp(compiled.source, flags);
  const ranges = [];
  let matched = false;
  // matchAll advances after empty matches, including astral Unicode text.
  // Empty matches qualify a crumb but never create a fictitious highlight.
  for (const match of text.matchAll(expression)) {
    matched = true;
    if (!match[0].length) continue;
    const start = match.index;
    const end = start + match[0].length;
    const previous = ranges.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else ranges.push([start, end]);
  }
  return { matched, ranges };
}

export function searchCorpus(corpus, query, mode = 'text', groups = []) {
  const compiled = compileSearch(query, mode, groups);
  const matches = [];
  const highlights = {};
  for (const crumb of corpus) {
    const title = scanField(crumb.title, compiled);
    const body = scanField(crumb.body.replaceAll(' / ', '\n'), compiled);
    if (!title.matched && !body.matched) continue;
    matches.push(crumb.number);
    highlights[crumb.number] = { title: title.ranges, body: body.ranges };
  }
  matches.sort((a, b) => a - b);
  return { matches, highlights };
}

function abortError() {
  return new DOMException('Search canceled.', 'AbortError');
}

// Corpus and synonyms cross the worker boundary once per worker lifetime.
// A timed-out or canceled worker is discarded before another search runs.
export class SearchClient {
  constructor(corpus, synonymsText, options = {}) {
    this.corpus = corpus;
    this.synonymsText = synonymsText;
    this.timeout = options.timeout ?? 2000;
    this.startupTimeout = options.startupTimeout ?? 10000;
    this.workerFactory = options.workerFactory ?? (() => new Worker(new URL('./search-worker.js?v=3', import.meta.url), { type: 'module' }));
    this.worker = null;
    this.ready = null;
    this.readyState = null;
    this.active = null;
    this.sequence = 0;
    this.destroyed = false;
  }

  ensureWorker() {
    if (this.ready) return this.ready;
    let resolve;
    let reject;
    const ready = new Promise((yes, no) => { resolve = yes; reject = no; });
    this.ready = ready;
    this.readyState = { resolve, reject, timer: null };
    try {
      const worker = this.workerFactory();
      this.worker = worker;
      worker.onmessage = event => {
        if (this.worker !== worker) return;
        const data = event.data;
        if (data?.type === 'ready') {
          clearTimeout(this.readyState?.timer);
          this.readyState?.resolve();
          this.readyState = null;
        } else if (data?.type === 'result' && data.id === this.active?.id) {
          this.finish(this.active, null, data.result);
        } else if (data?.type === 'error' && data.id === this.active?.id) {
          this.finish(this.active, new SearchError(data.code || 'SEARCH_UNAVAILABLE', data.detail || ''));
        }
      };
      worker.onerror = event => {
        event.preventDefault?.();
        if (this.worker === worker) this.failWorker(new SearchError('SEARCH_UNAVAILABLE'));
      };
      worker.onmessageerror = () => {
        if (this.worker === worker) this.failWorker(new SearchError('SEARCH_UNAVAILABLE'));
      };
      this.readyState.timer = setTimeout(() => this.failWorker(new SearchError('SEARCH_UNAVAILABLE')), this.startupTimeout);
      worker.postMessage({ type: 'initialize', corpus: this.corpus, synonymsText: this.synonymsText });
    } catch {
      this.failWorker(new SearchError('SEARCH_UNAVAILABLE'));
    }
    return ready;
  }

  finish(call, error, result) {
    if (!call || call !== this.active) return;
    this.active = null;
    clearTimeout(call.timer);
    call.signal?.removeEventListener('abort', call.abort);
    if (error) call.reject(error);
    else call.resolve(result);
  }

  discardWorker(error) {
    this.worker?.terminate();
    this.worker = null;
    clearTimeout(this.readyState?.timer);
    this.readyState?.reject(error);
    this.readyState = null;
    this.ready = null;
  }

  failWorker(error) {
    this.finish(this.active, error);
    this.discardWorker(error);
  }

  run(query, mode = 'text', { signal } = {}) {
    if (this.destroyed) return Promise.reject(new SearchError('SEARCH_UNAVAILABLE'));
    if (this.active) this.failWorker(abortError());
    return new Promise((resolve, reject) => {
      const call = { id: ++this.sequence, resolve, reject, signal, timer: null, abort: null };
      call.abort = () => {
        if (call === this.active) this.failWorker(abortError());
      };
      this.active = call;
      if (signal?.aborted) { call.abort(); return; }
      signal?.addEventListener('abort', call.abort, { once: true });
      this.ensureWorker().then(() => {
        if (call !== this.active) return;
        call.timer = setTimeout(() => this.failWorker(new SearchError('SEARCH_TIMEOUT')), this.timeout);
        try { this.worker.postMessage({ type: 'search', id: call.id, query, mode }); }
        catch { this.failWorker(new SearchError('SEARCH_UNAVAILABLE')); }
      }).catch(error => this.finish(call, error));
    });
  }

  destroy() {
    this.destroyed = true;
    this.failWorker(abortError());
  }
}
