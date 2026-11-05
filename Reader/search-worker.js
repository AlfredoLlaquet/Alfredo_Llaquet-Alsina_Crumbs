import { parseSynonyms, searchCorpus } from './search.js?v=3';

let corpus = [];
let groups = [];
let synonymError = null;

self.onmessage = event => {
  const data = event.data;
  if (data?.type === 'initialize') {
    corpus = data.corpus;
    try {
      groups = parseSynonyms(data.synonymsText);
      synonymError = null;
    } catch (error) {
      // A damaged synonym file does not disable independent regex searches.
      groups = [];
      synonymError = error;
    }
    self.postMessage({ type: 'ready' });
    return;
  }
  if (data?.type !== 'search') return;
  try {
    if (data.mode === 'text' && synonymError) throw synonymError;
    self.postMessage({ type: 'result', id: data.id, result: searchCorpus(corpus, data.query, data.mode, groups) });
  } catch (error) {
    self.postMessage({ type: 'error', id: data.id, code: error.code || 'SEARCH_UNAVAILABLE', detail: error.detail || '' });
  }
};
