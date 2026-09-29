import crypto from 'node:crypto';

/**
 * In-memory job registry with Server-Sent-Events fan-out.
 *
 * Events: `progress` {phase, percent, message}, `done` {result}, `error` {message}.
 */
const jobs = new Map();

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

export const createJob = (type) => {
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
  };
  jobs.set(id, job);
  return job;
};

export const getJob = (id) => jobs.get(id) ?? null;

const broadcast = (job, event, data) => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of job.subscribers) {
    res.write(payload);
  }
};

export const reportPhase = (job, phase, percentOverride) => {
  job.phase = phase;
  if (typeof percentOverride === 'number') job.percent = Math.max(job.percent, percentOverride);
  job.message = PHASE_MESSAGES[phase] ?? job.message;
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
  broadcast(job, 'progress', {phase: 'done', percent: 100, message: job.message});
  broadcast(job, 'done', {result});
  for (const res of job.subscribers) res.end();
  job.subscribers.clear();
};

export const failJob = (job, message) => {
  job.status = 'error';
  job.error = message;
  broadcast(job, 'error', {message});
  for (const res of job.subscribers) res.end();
  job.subscribers.clear();
};

/** Subscribes an SSE response to a job, replaying the current state first. */
export const subscribe = (job, res) => {
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
