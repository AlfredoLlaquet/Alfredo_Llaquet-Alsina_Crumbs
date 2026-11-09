// Run with Node.js: node --test Reader/tests/visited.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession, snapshot, fingerprint, restoreSession, recordVisit, visit,
  moveInHistory, restartRandom, nextRandom, restartSearchRandom, nextSearchRandom,
  visitedNumbers, HISTORY_LIMIT, SESSION_VERSION,
} from '../core.js';
import { encodeSession, decodeSession, MAX_SESSION_FILE_BYTES } from '../session.js';

const now = new Date(2026, 10, 9, 12).getTime();
const yesterday = new Date(2026, 10, 8).getTime();
const corpus = Array.from({ length: 140 }, (_, index) => ({ number: index + 1, title: `Title ${index + 1}` }));

test('all visits survive history trimming and a new Random round', () => {
  const session = createSession(1, now);
  for (let n = 2; n <= 140; n++) visit(session, n, now + n);
  assert.equal(session.history.length, HISTORY_LIMIT);
  assert.equal(session.lastVisits.size, 140);
  const dates = [...session.lastVisits];
  restartRandom(session);
  assert.deepEqual([...session.visited], [140]);
  assert.deepEqual([...session.lastVisits], dates);
  assert.equal(nextRandom(session, 140, () => 0), 1);
  visit(session, 1, now + 1000);
  assert.equal(session.lastVisits.size, 140);
  assert.equal(session.lastVisits.get(1), now + 1000);
});

test('repeat selections and history navigation refresh dates without duplicate history', () => {
  const session = createSession(1, now);
  visit(session, 2, now + 1);
  assert.equal(visit(session, 2, now + 2), false);
  assert.deepEqual(session.history, [1, 2]);
  assert.equal(session.lastVisits.get(2), now + 2);
  assert.equal(moveInHistory(session, 0, now + 3), true);
  assert.equal(session.current, 1);
  assert.equal(session.lastVisits.get(1), now + 3);
  assert.equal(moveInHistory(session, -1, now + 4), false);
  assert.equal(session.lastVisits.get(1), now + 3);
});

test('all four orders, date ties, empty titles, and number/title filtering', () => {
  const session = createSession(1, now + 30);
  visit(session, 2, now + 10);
  visit(session, 3, now + 10);
  const source = [{ title: 'Blue sky' }, { title: '' }, { title: 'BLUE moon' }];
  const expected = { 'number-asc': [1, 2, 3], 'number-desc': [3, 2, 1], 'visit-asc': [2, 3, 1], 'visit-desc': [1, 2, 3] };
  for (const [order, numbers] of Object.entries(expected)) {
    session.visitedOrder = order;
    assert.deepEqual(visitedNumbers(session, source), numbers);
  }
  assert.deepEqual(visitedNumbers(session, source, ' blue '), [1, 3]);
  assert.deepEqual(visitedNumbers(session, source, '2'), [2]);
  assert.deepEqual(visitedNumbers(session, source, 'no match'), []);
  const before = fingerprint(session);
  session.visitedOrder = 'number-desc';
  assert.notEqual(fingerprint(session), before);
});

test('old browser sessions migrate known visits to yesterday exactly once', () => {
  for (const version of [1, 2, 3]) {
    const data = { version, current: 3, random: false, visited: [3], favorites: [], history: [1, 3], historyIndex: 1, textSize: 1, autoSave: true,
      search: { query: 'pie', mode: 'text', active: true, visited: [2, 3] } };
    const session = restoreSession(data, 3, now);
    const known = version < 3 ? [1, 3] : [1, 2, 3];
    assert.deepEqual([...session.lastVisits.keys()].sort(), known);
    for (const date of session.lastVisits.values()) assert.equal(date, yesterday);
    assert.equal(session.visitedOrder, 'number-asc');
    assert.equal(session.autoSave, version !== 1);
    recordVisit(session, session.current, now);
    assert.equal(session.lastVisits.get(3), now);
    const saved = snapshot(session);
    assert.equal(saved.version, SESSION_VERSION);
    assert.deepEqual(snapshot(restoreSession(saved, 3, now + 86400000)), saved);
  }
});

test('legacy dates follow the local calendar across a daylight-saving transition', () => {
  const data = { version: 1, current: 1, random: false, visited: [1], favorites: [], history: [1], historyIndex: 0, textSize: 1 };
  const spring = new Date(2026, 2, 30, 12).getTime();
  const session = restoreSession(data, 1, spring);
  assert.equal(session.lastVisits.get(1), new Date(2026, 2, 29).getTime());
});

// Fixed files cover both historical representations, including the v3 search payload.
const legacyFiles = [
  [1, 'Q1IBAABy4APMWzMsMCwxLDIsWzEsM10sWzEsM10sWzFdXQ=='],
  [1, 'Q1IBAQCkFZF4AwABAgICBAACAQIAAQE='],
  [2, 'Q1ICAACZ9BClWzMsMCwxLDIsWzEsM10sWzEsM10sWzFdLDFd'],
  [2, 'Q1ICAQDG9AF7AwABAgICBAACAQIAAQEB'],
  [3, 'Q1IDAAB5d+jBWzMsMSwyLFsxLDNdLFsxLDNdLFsxXSwxLCJwaWUiLDAsMSxbM11d'],
  [3, 'Q1IDAQAzK+FzAwECAgIEAAIBAgABAQEAAQNwaWUAAQM='],
];
test('versions 1, 2, and 3 portable JSON and binary files remain readable', async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  today.setDate(today.getDate() - 1);
  for (const [version, payload] of legacyFiles) {
    const session = await decodeSession(`CRUMB-READER/${version}\n${payload}\n`, 3);
    assert.equal(session.current, 3);
    assert.deepEqual(session.history, [1, 3]);
    assert.deepEqual([...session.favorites], [1]);
    assert.equal(session.autoSave, version !== 1);
    assert.equal(session.search.query, version === 3 ? 'pie' : '');
    assert.equal(session.lastVisits.get(1), today.getTime());
    assert.equal(session.lastVisits.get(3), today.getTime());
  }
});

test('session validation rejects lost, duplicate, invalid, or out-of-corpus visit data', () => {
  const valid = snapshot(createSession(1, now));
  for (const change of [
    { lastVisits: [] }, { lastVisits: [[1, now], [1, now]] },
    { lastVisits: [[1, -1]] }, { lastVisits: [[1, NaN]] },
    { lastVisits: [[1, 8640000000000001]] }, { visitedOrder: 'unexpected' },
    { lastVisits: [[1, now], [4, now]] },
  ]) assert.throws(() => restoreSession({ ...valid, ...change }, 3));
});

test('the version 4 JSON representation preserves timestamps and ordering', async () => {
  const file = 'CRUMB-READER/4\nQ1IEAAD+IDYCWzMsMSwyLFsxLDNdLFsxLDNdLFsxXSwxLCJwaWUiLDAsMSxbM10sMyxbWzEsMTcwMDAwMDAwMDAwMF0sWzMsMTcwMDAwMDAwMTIzNF1dXQ==\n';
  const session = await decodeSession(file, 3);
  assert.equal(session.visitedOrder, 'visit-desc');
  assert.deepEqual([...session.lastVisits], [[1, 1700000000000], [3, 1700000001234]]);
  assert.equal(session.search.query, 'pie');
});

test('saving remains available without browser compression support', async () => {
  const compression = globalThis.CompressionStream;
  try {
    globalThis.CompressionStream = undefined;
    const session = createSession(1, now);
    visit(session, 2, now + 1234);
    session.visitedOrder = 'number-desc';
    const file = await encodeSession(session);
    assert.equal(Buffer.from(file.split('\n')[1], 'base64')[4], 0);
    assert.deepEqual(snapshot(await decodeSession(file, 2)), snapshot(session));
  } finally { globalThis.CompressionStream = compression; }
});

test('search rounds and the complete visit record remain independent', () => {
  const session = createSession(1, now);
  visit(session, 2, now + 1);
  session.search = { query: 'pie', mode: 'text', active: true, visited: new Set([2, 3]) };
  recordVisit(session, 3, now + 2);
  const dates = [...session.lastVisits];
  restartSearchRandom(session, [2, 3]);
  assert.deepEqual([...session.lastVisits], dates);
  assert.deepEqual([...session.search.visited], [2]);
  assert.equal(nextSearchRandom(session, [2, 3], () => 0), 3);
});

test('portable sessions retain dates, order, search, settings, and round progress', async () => {
  const session = createSession(1, now);
  visit(session, 9, now + 86400123);
  session.favorites.add(1);
  session.autoSave = true;
  session.textSize = 3;
  session.visitedOrder = 'visit-desc';
  session.search = { query: 'píe', mode: 'regex', active: true, visited: new Set([9]) };
  restartRandom(session);
  const expected = snapshot(session);
  const file = await encodeSession(session);
  assert.match(file, /^CRUMB-READER\/4\n/);
  assert.deepEqual(snapshot(await decodeSession(file, 9)), expected);
  assert.deepEqual(snapshot(session), expected, 'saving must not manufacture a fresh visit');
  await assert.rejects(() => decodeSession(file.replace('CRUMB-READER/4', 'CRUMB-READER/5'), 9));
  const bytes = Buffer.from(file.split('\n')[1], 'base64');
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(() => decodeSession(`CRUMB-READER/4\n${bytes.toString('base64')}\n`, 9));
});

test('the complete 25,092-crumb goal survives a portable round trip without a list cap', { timeout: 60000 }, async () => {
  const total = 25092;
  const session = createSession(1, now);
  for (let number = 2; number <= total; number++) visit(session, number, now + number * 1001);
  session.visitedOrder = 'visit-asc';
  session.favorites.add(1);
  session.favorites.add(total);
  restartRandom(session);
  const file = await encodeSession(session);
  assert.ok(file.length < MAX_SESSION_FILE_BYTES);
  const restored = await decodeSession(file, total);
  assert.equal(restored.lastVisits.size, total);
  assert.deepEqual(snapshot(restored), snapshot(session));
  assert.equal(restored.visited.size, 1);
});
