import { analyzeAudio } from './analyzer.js';

self.onmessage = async (e) => {
  const { samples, sr } = e.data;
  try {
    const result = await analyzeAudio(samples, sr, p => self.postMessage({ progress: p }));
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};
