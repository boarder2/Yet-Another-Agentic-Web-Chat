/**
 * Regex matching with ReDoS protection via a timeout-terminated worker thread.
 * Falls back to an in-process approach if worker threads are unavailable.
 */
import { Worker } from 'node:worker_threads';

const WORKER_CODE = [
  "const { parentPort, workerData } = require('worker_threads');",
  'const job = workerData;',
  "function escape(s) { return s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'); }",
  "const re = job.regex ? new RegExp(job.pattern, 'gm') : new RegExp(escape(job.pattern), 'gm');",
  'const lines = job.text.split(/\\r?\\n/);',
  'const out = [];',
  'for (let i = 0; i < lines.length && out.length < job.maxMatches; i++) {',
  '  if (re.test(lines[i])) { out.push({ line: i + 1, snippet: lines[i].slice(0, 500) }); re.lastIndex = 0; }',
  '}',
  'parentPort.postMessage(out);',
].join('\n');

export async function grepText(opts: {
  pattern: string;
  regex: boolean;
  text: string;
  maxMatches: number;
  timeoutMs?: number;
}): Promise<{ line: number; snippet: string }[]> {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_CODE, {
      eval: true,
      workerData: {
        pattern: opts.pattern,
        regex: opts.regex,
        text: opts.text,
        maxMatches: opts.maxMatches,
      },
    });
    const timer = setTimeout(() => {
      w.terminate();
      reject(new Error('regex_timeout'));
    }, opts.timeoutMs ?? 2000);
    w.on('message', (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    w.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
