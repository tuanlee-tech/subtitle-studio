import fs from 'node:fs';
import path from 'node:path';

/**
 * Per-step terminal trail for the `<details>` panels in the UI.
 *
 * Job steps (transcribe/render) write through `jobs.js` while they run; the
 * steps that resolve inside a single HTTP request (upload, save, style) write
 * here so a reload still shows what happened and why.
 */
const MAX_FILE_BYTES = 512 * 1024;

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const logsDir = (dir) => path.join(dir, 'logs');

export const appendStepLog = (dir, step, lines) => {
  const file = path.join(logsDir(dir), `${step}.log`);
  try {
    fs.mkdirSync(logsDir(dir), {recursive: true});
    fs.appendFileSync(file, lines.map((l) => `${stamp()} ${l}`).join('\n') + '\n');
  } catch {
    /* logging must never break a request */
  }
};

/** Truncates the step's trail and starts a new one (used when a step restarts). */
export const writeStepLog = (dir, step, lines) => {
  const file = path.join(logsDir(dir), `${step}.log`);
  try {
    fs.mkdirSync(logsDir(dir), {recursive: true});
    fs.writeFileSync(file, lines.map((l) => `${stamp()} ${l}`).join('\n') + '\n');
  } catch {
    /* logging must never break a request */
  }
};

/** Reads every step trail of a video, newest content kept within MAX_FILE_BYTES. */
export const readLogs = (dir) => {
  const out = {};
  const source = logsDir(dir);
  if (!fs.existsSync(source)) return out;
  for (const name of fs.readdirSync(source)) {
    if (!name.endsWith('.log')) continue;
    try {
      const raw = fs.readFileSync(path.join(source, name), 'utf8');
      let text = raw.length > MAX_FILE_BYTES ? raw.slice(-MAX_FILE_BYTES) : raw;
      if (text.length < raw.length) {
        // the head of the tail is a partial line — drop it
        const nl = text.indexOf('\n');
        if (nl >= 0) text = text.slice(nl + 1);
      }
      out[name.slice(0, -4)] = text;
    } catch {
      /* skip unreadable trail */
    }
  }
  return out;
};
