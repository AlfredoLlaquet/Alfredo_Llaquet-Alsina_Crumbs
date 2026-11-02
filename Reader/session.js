import { MAX_CRUMB_NUMBER, SESSION_VERSION, restoreSession, snapshot } from './core.js?v=2';

export const SESSION_HEADER = `CRUMB-READER/${SESSION_VERSION}\n`;
export const MAX_SESSION_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DECODED_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function variable(number, target) {
  do {
    const next = number % 128;
    number = Math.floor(number / 128);
    target.push(next | (number ? 128 : 0));
  } while (number);
}

function packSetCandidates(numbers) {
  const deltas = [0];
  variable(numbers.length, deltas);
  let previous = 0;
  for (const number of numbers) {
    variable(number - previous, deltas);
    previous = number;
  }
  const groups = [];
  for (const number of numbers) {
    const group = groups.at(-1);
    if (group && number === group[1] + 1) group[1] = number;
    else groups.push([number, number]);
  }
  const ranges = [1];
  variable(groups.length, ranges);
  previous = 0;
  for (const [start, end] of groups) {
    variable(start - previous, ranges);
    variable(end - start, ranges);
    previous = end;
  }
  const last = numbers.at(-1) || 0;
  const prefix = [2];
  variable(last, prefix);
  const bits = new Uint8Array(prefix.length + Math.ceil(last / 8));
  bits.set(prefix);
  for (const number of numbers) bits[prefix.length + ((number - 1) >> 3)] |= 1 << ((number - 1) & 7);
  return [Uint8Array.from(deltas), Uint8Array.from(ranges), bits];
}

function packBinaryCandidates(data) {
  const result = [];
  for (const number of [data.current, Number(data.random), data.historyIndex, data.textSize, data.history.length]) variable(number, result);
  let previous = 0;
  for (const number of data.history) {
    const difference = number - previous;
    variable(difference >= 0 ? difference * 2 : -difference * 2 - 1, result);
    previous = number;
  }
  const candidates = [];
  const visited = packSetCandidates(data.visited);
  const favorites = packSetCandidates(data.favorites);
  for (const visits of visited) {
    for (const marks of favorites) {
      const bytes = new Uint8Array(result.length + visits.length + marks.length + 1);
      bytes.set(result);
      bytes.set(visits, result.length);
      bytes.set(marks, result.length + visits.length);
      bytes[bytes.length - 1] = Number(data.autoSave);
      candidates.push(bytes);
    }
  }
  return candidates;
}

function unpackBinary(bytes, version) {
  let cursor = 0;
  const invalid = () => { throw new Error('The session file is damaged.'); };
  const next = () => {
    let value = 0;
    let multiplier = 1;
    for (let count = 0; count < 5; count++) {
      if (cursor >= bytes.length) invalid();
      const byte = bytes[cursor++];
      value += (byte & 127) * multiplier;
      if (!(byte & 128)) return value;
      multiplier *= 128;
    }
    invalid();
  };
  const readSet = () => {
    const kind = next();
    const count = next();
    if (count > MAX_CRUMB_NUMBER) invalid();
    const numbers = [];
    let previous = 0;
    if (kind === 0) {
      for (let i = 0; i < count; i++) {
        previous += next();
        if (previous > MAX_CRUMB_NUMBER) invalid();
        numbers.push(previous);
      }
    } else if (kind === 1) {
      for (let i = 0; i < count; i++) {
        const start = previous + next();
        const end = start + next();
        if (start <= previous || end > MAX_CRUMB_NUMBER) invalid();
        for (let n = start; n <= end; n++) numbers.push(n);
        previous = end;
      }
    } else if (kind === 2) {
      const length = Math.ceil(count / 8);
      if (cursor + length > bytes.length) invalid();
      for (let n = 1; n <= count; n++) {
        if (bytes[cursor + ((n - 1) >> 3)] & (1 << ((n - 1) & 7))) numbers.push(n);
      }
      cursor += length;
    } else invalid();
    return numbers;
  };
  const [current, random, historyIndex, textSize, count] = [next(), next(), next(), next(), next()];
  if (count < 1 || count > 100 || random > 1) invalid();
  const history = [];
  let previous = 0;
  for (let i = 0; i < count; i++) {
    const zigzag = next();
    previous += zigzag % 2 ? -(zigzag + 1) / 2 : zigzag / 2;
    history.push(previous);
  }
  const visited = readSet();
  const favorites = readSet();
  const autoSave = version === 1 ? 0 : next();
  if (autoSave > 1) invalid();
  if (cursor !== bytes.length) invalid();
  return { version, current, random: Boolean(random), historyIndex, textSize, history, visited, favorites, autoSave: Boolean(autoSave) };
}

function checksum(bytes) {
  let value = 0x811c9dc5;
  for (const byte of bytes) value = Math.imul(value ^ byte, 0x01000193) >>> 0;
  return value;
}

async function transform(bytes, name, decompress = false) {
  const Constructor = decompress ? globalThis.DecompressionStream : globalThis.CompressionStream;
  if (!Constructor) throw new Error('This browser cannot open this compressed session. Use an up-to-date browser.');
  const stream = new Blob([bytes]).stream().pipeThrough(new Constructor(name));
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_DECODED_BYTES) {
      await reader.cancel();
      throw new Error('The session file is too large.');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function encodeSession(value) {
  const data = snapshot(restoreSession(value.visited instanceof Set ? snapshot(value) : value));
  const compact = [data.current, Number(data.random), data.historyIndex, data.textSize, data.history, data.visited, data.favorites, Number(data.autoSave)];
  const representations = [encoder.encode(JSON.stringify(compact)), ...packBinaryCandidates(data)];
  const candidates = [];
  for (let encoding = 0; encoding < representations.length; encoding++) {
    const bytes = representations[encoding];
    const format = encoding === 0 ? 0 : 1;
    candidates.push({ encoding: format, compression: 0, bytes });
    // Keep a smaller uncompressed representation when compression adds overhead.
    for (const [compression, name] of [[1, 'deflate'], [2, 'gzip']]) {
      try { candidates.push({ encoding: format, compression, bytes: await transform(bytes, name) }); }
      catch { /* Compact binary remains available without Compression Streams. */ }
    }
  }
  candidates.sort((a, b) => a.bytes.length - b.bytes.length);
  const chosen = candidates[0];
  const file = new Uint8Array(9 + chosen.bytes.length);
  file.set([67, 82, SESSION_VERSION, chosen.encoding, chosen.compression]);
  file.set(chosen.bytes, 9);
  new DataView(file.buffer).setUint32(5, checksum(chosen.bytes));
  let binary = '';
  for (let index = 0; index < file.length; index += 8192) binary += String.fromCharCode(...file.subarray(index, index + 8192));
  return SESSION_HEADER + btoa(binary) + '\n';
}

export async function decodeSession(text, total) {
  if (text.length > MAX_SESSION_FILE_BYTES) throw new Error('The session file is too large.');
  const normalized = text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const header = /^CRUMB-READER\/([12])\n/.exec(normalized);
  if (!header) throw new Error('Choose a supported text file saved by the Crumb Reader.');
  const version = Number(header[1]);
  const base64 = normalized.slice(header[0].length).replace(/\s+/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('The session file is damaged.');
  const file = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  if (file.length < 10 || file[0] !== 67 || file[1] !== 82 || file[2] !== version || file[3] > 1 || file[4] > 2) throw new Error('The session file has an unsupported format.');
  let bytes = file.subarray(9);
  if (new DataView(file.buffer).getUint32(5) !== checksum(bytes)) throw new Error('The session file is damaged or incomplete.');
  if (file[4]) bytes = await transform(bytes, file[4] === 1 ? 'deflate' : 'gzip', true);
  let data;
  if (file[3] === 0) {
    const parsed = JSON.parse(decoder.decode(bytes));
    if (!Array.isArray(parsed) || parsed.length !== (version === 1 ? 7 : 8) || ![0, 1].includes(parsed[1]) ||
        (version === 2 && ![0, 1].includes(parsed[7]))) throw new Error('The session file is damaged.');
    const [current, random, historyIndex, textSize, history, visited, favorites, autoSave = 0] = parsed;
    data = { version, current, random: Boolean(random), historyIndex, textSize, history, visited, favorites, autoSave: Boolean(autoSave) };
  } else data = unpackBinary(bytes, version);
  return restoreSession(data, total);
}
