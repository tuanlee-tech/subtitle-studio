import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * In-memory job registry with Server-Sent-Events fan-out.
 *
 * Events: `progress` {phase, percent, message}, `log` {lines}, `done` {result},
 * `error` {message}.
 */
const jobs = new Map();

/** Lines kept in RAM for the live <details> terminal (the file keeps everything). */
const LOG_LIMIT = 2000;
const LOG_FLUSH_MS = 200;

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const PHASE_MESSAGES = {
  prepare: 'Đang chuẩn bị xử lý video...',
  language: 'Đang nhận diện ngôn ngữ...',
  timing: 'Đang chuyển giọng nói thành văn bản...',
  text: 'Đang chuẩn hoá văn bản...',
  align: 'Đang canh chỉnh thời gian từng từ...',
  srt: 'Đang tạo file SRT...',
  translate: 'Đang dịch nội dung...',
  bundle: 'Đang chuẩn bị môi trường render...',
  render: 'Đang chèn phụ đề vào video...',
  save: 'Đang lưu phiên bản phụ đề...',
};

export const createJob = (type, opts = {}) => {
  const id = crypto.randomUUID();
  const job = {
    id,
    type,
    status: 'running',
    phase: 'prepare',
    percent: 0,
    message: PHASE_MESSAGES.prepare,
    result: null,
    error: null,
    createdAt: Date.now(),
    subscribers: new Set(),
    logFile: opts.logFile ?? null,
    log: [],
    logTotal: 0,
    logPending: [],
    logTimer: null,
  };
  jobs.set(id, job);
  // Append-only trail: a previous failing run stays visible next to the new one.
  if (job.logFile) {
    try {
      fs.mkdirSync(path.dirname(job.logFile), {recursive: true});
      fs.appendFileSync(job.logFile, `${stamp()} ── ${type} · lần chạy mới ──\n`, 'utf8');
    } catch {
      job.logFile = null;
    }
  }
  return job;
};

export const getJob = (id) => jobs.get(id) ?? null;

const broadcast = (job, event, data) => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of job.subscribers) {
    res.write(payload);
  }
};

/**
 * Appends one terminal line: RAM ring buffer + durable file + batched SSE.
 *
 * Python prints its normal progress to stderr too, so "came from stderr" is not
 * an error — `error` is auto-detected unless the caller states it explicitly.
 */
const ERROR_RE = /\b(Error|Exception|Traceback|LỖI|CRITICAL|FATAL|fatal|failed)\b|✕/;

export const appendLog = (job, line, error = null) => {
  if (!job) return;
  const text0 = String(line).slice(0, 4000);
  const failed = error === null ? ERROR_RE.test(text0) : Boolean(error);
  const prefix = `${stamp()} ${failed ? '✕ ' : ''}`;
  const text = prefix + text0;
  job.log.push(text);
  if (job.log.length > LOG_LIMIT) job.log.splice(0, job.log.length - LOG_LIMIT);
  job.logTotal += 1;
  if (job.logFile) {
    try {
      fs.appendFileSync(job.logFile, `${text}\n`);
    } catch {
      job.logFile = null; // a full disk must not kill the job
    }
  }
  job.logPending.push(text);
  if (!job.logTimer && job.status === 'running') {
    job.logTimer = setTimeout(() => flushLog(job), LOG_FLUSH_MS);
  }
};

/** Sends every buffered line to the SSE subscribers (also called before done/error). */
const flushLog = (job) => {
  if (job.logTimer) {
    clearTimeout(job.logTimer);
    job.logTimer = null;
  }
  if (job.logPending.length) broadcast(job, 'log', {lines: job.logPending.splice(0)});
};

export const reportPhase = (job, phase, percentOverride) => {
  job.phase = phase;
  if (typeof percentOverride === 'number') job.percent = Math.max(job.percent, percentOverride);
  job.message = PHASE_MESSAGES[phase] ?? job.message;
  appendLog(job, `▸ ${job.message} (${job.percent}%)`);
  broadcast(job, 'progress', {phase: job.phase, percent: job.percent, message: job.message});
};

export const reportPercent = (job, percent, extra = {}) => {
  job.percent = Math.min(99, Math.max(job.percent, Math.round(percent)));
  if (extra.message) job.message = extra.message;
  if (extra.phase) job.phase = extra.phase;
  broadcast(job, 'progress', {phase: job.phase, percent: job.percent, message: job.message, ...extra});
};

export const finishJob = (job, result) => {
  job.status = 'done';
  job.percent = 100;
  job.result = result;
  flushLog(job);
  broadcast(job, 'progress', {phase: 'done', percent: 100, message: job.message});
  appendLog(job, '✓ Hoàn thành.');
  flushLog(job);
  broadcast(job, 'done', {result});
  for (const res of job.subscribers) res.end();
  job.subscribers.clear();
};

export const failJob = (job, message) => {
  job.status = 'error';
  job.error = message;
  appendLog(job, `LỖI: ${message}`, true);
  flushLog(job);
  broadcast(job, 'error', {message});
  for (const res of job.subscribers) res.end();
  job.subscribers.clear();
};

/** Subscribes an SSE response to a job, replaying the current state first. */
export const subscribe = (job, res) => {
  // Replay the whole terminal so a reconnect (or a freshly opened tab) shows the full trail.
  if (job.log.length) res.write(`event: log\ndata: ${JSON.stringify({lines: job.log, replay: true})}\n\n`);
  res.write(
    `event: progress\ndata: ${JSON.stringify({
      phase: job.phase,
      percent: job.percent,
      message: job.message,
      status: job.status,
    })}\n\n`,
  );
  if (job.status === 'done') {
    res.write(`event: done\ndata: ${JSON.stringify({result: job.result})}\n\n`);
    res.end();
    return;
  }
  if (job.status === 'error') {
    res.write(`event: error\ndata: ${JSON.stringify({message: job.error})}\n\n`);
    res.end();
    return;
  }
  job.subscribers.add(res);
  res.on('close', () => job.subscribers.delete(res));
};

export {PHASE_MESSAGES};
