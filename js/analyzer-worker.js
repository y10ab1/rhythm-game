import { analyzeAudio } from './analyzer.js';

self.onmessage = async (e) => {
  const { samples, sr, opts } = e.data;
  try {
    const result = await analyzeAudio(samples, sr, p => self.postMessage({ progress: p }), opts || {});
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};
