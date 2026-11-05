import { topLevelDomains } from './domains.js';

export const HISTORY_LIMIT = 100;
export const SESSION_VERSION = 3;
export const TEXT_SCALES = [0.9, 1, 1.12, 1.25, 1.4, 1.6];
export const MAX_CRUMB_NUMBER = 1_000_000;
export const MAX_SEARCH_QUERY_LENGTH = 8192;

export function parseCorpus(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  while (lines.length && lines.at(-1) === '') lines.pop();
  if (!lines.length) throw new Error('The crumbs text file is empty.');
  const prefixEnd = lines[0].indexOf('//');
  if (prefixEnd !== -1 && !/^Crumb \d+:/.test(lines[0])) lines[0] = lines[0].slice(prefixEnd + 2);
  return lines.map((line, index) => {
    const match = /^Crumb (\d+):[ \t]*(.*?):(?:[ \t]?)(.*)$/.exec(line);
    if (!match || Number(match[1]) !== index + 1) {
      throw new Error(`The crumbs text file has an unexpected format on line ${index + 1}.`);
    }
    return { number: index + 1, title: match[2], body: match[3] };
  });
}

export function createSession(number = 1) {
  return {
    current: number, visited: new Set([number]), favorites: new Set(),
    history: [number], historyIndex: 0, textSize: 1, autoSave: false,
    search: { query: '', mode: 'text', active: false, visited: new Set() },
  };
}

export function snapshot(session) {
  return {
    version: SESSION_VERSION, current: session.current,
    visited: [...session.visited].sort((a, b) => a - b),
    favorites: [...session.favorites].sort((a, b) => a - b),
    history: [...session.history],
    historyIndex: session.historyIndex, textSize: session.textSize, autoSave: session.autoSave,
    search: {
      query: session.search.query, mode: session.search.mode, active: session.search.active,
      visited: [...session.search.visited].sort((a, b) => a - b),
    },
  };
}

export function fingerprint(session) {
  return JSON.stringify(snapshot(session));
}

export function restoreSession(data, total = MAX_CRUMB_NUMBER) {
  const fail = () => { throw new Error('This file does not contain a valid Crumb Reader session.'); };
  if (!data || typeof data !== 'object' || Array.isArray(data) || ![1, 2, SESSION_VERSION].includes(data.version)) fail();
  if (data.version >= 2 && typeof data.autoSave !== 'boolean') fail();
  const validNumber = n => Number.isSafeInteger(n) && n >= 1 && n <= MAX_CRUMB_NUMBER;
  if (!validNumber(data.current) || (data.version < 3 && typeof data.random !== 'boolean')) fail();
  for (const key of ['visited', 'favorites', 'history']) {
    if (!Array.isArray(data[key]) || data[key].length > MAX_CRUMB_NUMBER || !data[key].every(validNumber)) fail();
  }
  if (!data.history.length || data.history.length > HISTORY_LIMIT ||
      !Number.isInteger(data.historyIndex) || data.historyIndex < 0 ||
      data.historyIndex >= data.history.length || data.history[data.historyIndex] !== data.current ||
      !Number.isInteger(data.textSize) || data.textSize < 0 || data.textSize >= TEXT_SCALES.length) fail();
  if (new Set(data.visited).size !== data.visited.length || new Set(data.favorites).size !== data.favorites.length) fail();
  const search = data.version < 3 ? { query: '', mode: 'text', active: false, visited: [] } : data.search;
  if (!search || typeof search !== 'object' || Array.isArray(search) ||
      typeof search.query !== 'string' || search.query.length > MAX_SEARCH_QUERY_LENGTH ||
      !['text', 'regex'].includes(search.mode) || typeof search.active !== 'boolean' ||
      (search.active && !search.query.length) || !Array.isArray(search.visited) ||
      search.visited.length > MAX_CRUMB_NUMBER || !search.visited.every(validNumber) ||
      new Set(search.visited).size !== search.visited.length) fail();
  if ([data.history, data.visited, data.favorites, search.visited].some(numbers => numbers.some(n => n > total))) {
    throw new Error('This session includes crumbs beyond the loaded text. Reload the Crumb Reader to get the latest text, then load the session again.');
  }
  const visited = new Set(data.visited);
  if (!visited.has(data.current)) fail();
  // A new random round can deliberately clear visits still present in history.
  return {
    current: data.current, visited, favorites: new Set(data.favorites),
    history: [...data.history],
    historyIndex: data.historyIndex, textSize: data.textSize,
    autoSave: data.version === 1 ? false : data.autoSave,
    search: { query: search.query, mode: search.mode, active: search.active, visited: new Set(search.visited) },
  };
}

export function visit(session, number) {
  if (!Number.isInteger(number) || number < 1) throw new Error('Invalid crumb number.');
  if (number === session.current) return false;
  session.history = session.history.slice(0, session.historyIndex + 1);
  session.history.push(number);
  session.history = session.history.slice(-HISTORY_LIMIT);
  session.historyIndex = session.history.length - 1;
  session.current = number;
  session.visited.add(number);
  return true;
}

export function moveInHistory(session, index) {
  if (!Number.isInteger(index) || index < 0 || index >= session.history.length) return false;
  if (session.historyIndex === index) return false;
  session.historyIndex = index;
  session.current = session.history[index];
  session.visited.add(session.current);
  return true;
}

export function nextRandom(session, total, random = Math.random) {
  const remaining = total - [...session.visited].filter(n => n <= total).length;
  if (remaining <= 0) return null;
  let choice = Math.floor(random() * remaining);
  for (let n = 1; n <= total; n++) {
    if (!session.visited.has(n) && choice-- === 0) return n;
  }
  return null;
}

export function restartRandom(session) {
  session.visited = new Set([session.current]);
}

// Matching numbers come from the current search, independent of general visits.
export function nextSearchRandom(session, matches, random = Math.random) {
  const remaining = matches.filter(number => !session.search.visited.has(number));
  if (!remaining.length) return null;
  return remaining[Math.floor(random() * remaining.length)] ?? null;
}

export function restartSearchRandom(session, matches) {
  session.search.visited = new Set(matches.includes(session.current) ? [session.current] : []);
}

export function crumbFromURL(value, total) {
  if (value === null) return null;
  if (!/^[1-9]\d*$/.test(value)) return NaN;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= total ? number : NaN;
}

function trimURL(text) {
  let result = text.replace(/[.,;:!?]+$/g, '');
  for (const [opening, closing] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    const count = char => [...result].filter(value => value === char).length;
    while (result.endsWith(closing) && count(closing) > count(opening)) result = result.slice(0, -1);
  }
  return result.replace(/[.,;:!?]+$/g, '');
}

// Return text and link tokens. Text is always inserted as text nodes, never HTML.
export function linkTokens(original, total, lineBreaks = true) {
  const text = lineBreaks ? original.replaceAll(' / ', '\n') : original;
  const matches = [];
  const urlPattern = /\b(?:https?:\/\/|www\.)[^\s<>"'“”‘’‹›]+|\b(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+(?:[a-z]{2,63}|xn--[a-z\d-]+)(?::\d+)?(?:[/?#][^\s<>"'“”‘’‹›]*)?/gi;
  for (const match of text.matchAll(urlPattern)) {
    const label = trimURL(match[0]);
    const before = text[match.index - 1] || '';
    if (!label || /[\w@/]/.test(before)) continue;
    const explicit = /^(?:https?:\/\/|www\.)/i.test(label);
    try {
      const url = new URL(/^https?:\/\//i.test(label) ? label : `https://${label}`);
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname.includes('.')) continue;
      if (!explicit && !topLevelDomains.has(url.hostname.split('.').at(-1))) continue;
      matches.push({ start: match.index, end: match.index + label.length, type: 'url', text: label, href: url.href });
    } catch { /* A malformed address remains ordinary text. */ }
  }
  const referencePattern = /\bcrumbs?\s+\d+(?:(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|to)\s+|\s*[–—-]\s*)\d+)*/gi;
  for (const reference of text.matchAll(referencePattern)) {
    for (const digits of reference[0].matchAll(/\d+/g)) {
      const number = Number(digits[0]);
      const start = reference.index + digits.index;
      if (number < 1 || number > total || matches.some(item => start >= item.start && start < item.end)) continue;
      matches.push({ start, end: start + digits[0].length, type: 'crumb', text: digits[0], number });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  const tokens = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.start > cursor) tokens.push({ type: 'text', text: text.slice(cursor, match.start) });
    tokens.push(match);
    cursor = match.end;
  }
  if (cursor < text.length) tokens.push({ type: 'text', text: text.slice(cursor) });
  return tokens;
}
