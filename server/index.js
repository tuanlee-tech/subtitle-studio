import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import {PROJECT_DIR, STORAGE_DIR, checkCommand, checkPython, resolvePython} from './env.js';
import {createJob, getJob, subscribe} from './jobs.js';
import {probeVideo} from './probe.js';
import {humanizeError, runJob, runRender, runTranscribe, videoDir} from './pipeline.js';
import {appendStepLog, readLogs, writeStepLog} from './steplog.js';
import {validateSrt} from '../lib/srt.mjs';
import {cuesFromSrt, fontSizeForWidth, loadSubtitleFont, maxWidthForWidth} from '../lib/cues.mjs';
import {FONT_FILE_RE} from '../lib/look.mjs';
import {FONT_EXT, ID_RE, MAX_FONT_BYTES, fontPath, listFonts, removeFont, saveFont} from './fonts.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({limit: '2mb'}));

const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);
/** Slice size for resumable uploads: small enough to retry cheaply, big enough to be fast. */
const SLICE_BYTES = 5 * 1024 * 1024;
const PUBLIC_DIR = path.join(PROJECT_DIR, 'public');
fs.mkdirSync(PUBLIC_DIR, {recursive: true});
fs.mkdirSync(STORAGE_DIR, {recursive: true});

const readMeta = (dir) => {
  const file = path.join(dir, 'meta.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

const getDir = (req, res) => {
  const dir = videoDir(req.params.id);
  if (!fs.existsSync(path.join(dir, 'meta.json'))) {
    res.status(404).json({error: 'Không tìm thấy video này. Hãy tải video lên lại.'});
    return null;
  }
  return dir;
};

// ---------------------------------------------------------------- health ----

app.get('/api/health', (_req, res) => {
  const python = checkPython();
  res.json({
    ok: python.ok,
    python,
    node: process.version,
    // Tùy chọn — lib/probe.mjs đọc metadata bằng @remotion/media-parser,
    // ffprobe chỉ là đường fallback.
    ffprobe: checkCommand('ffprobe'),
    resolvePython: resolvePython(),
    remotionBrowser: process.env.REMOTION_BROWSER ?? null,
  });
});

// ---------------------------------------------------------------- upload ----

app.post('/api/uploads', (req, res) => {
  const name = path.basename(String(req.query.name ?? 'video.mp4'));
  const ext = path.extname(name).toLowerCase();
  if (!VIDEO_EXT.has(ext)) {
    return res.status(400).json({error: 'Định dạng video không được hỗ trợ (mp4, mov, mkv, webm, m4v).'});
  }

  // Resumable uploads: the client pushes 5 MB slices and repeats the last one
  // after a dropped connection, so every request says where it continues.
  const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? '0'), 10) || 0);
  const total = Math.max(0, Number.parseInt(String(req.query.total ?? '0'), 10) || 0);
  const askedId = String(req.query.id ?? '');
  const id = ID_RE.test(askedId) ? askedId : crypto.randomUUID();
  const dir = videoDir(id);
  const filePath = path.join(dir, `input${ext}`);
  const existing = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;

  if (existing < offset) {
    // The client believes we have more than we do — tell it where to resume.
    return res
      .status(409)
      .json({error: 'Tiến độ tải lên không khớp, gửi lại từ phần đã nhận.', received: existing});
  }
  try {
    fs.mkdirSync(dir, {recursive: true});
    if (existing > offset) {
      // A slice was cut mid-flight: drop everything past the promised offset.
      fs.truncateSync(filePath, offset);
    }
  } catch (err) {
    return res.status(500).json({error: humanizeError(err)});
  }

  const out = fs.createWriteStream(filePath, {flags: offset > 0 ? 'a' : 'w'});
  let bytes = 0;
  req.on('data', (chunk) => {
    bytes += chunk.length;
  });
  req.pipe(out);

  out.on('finish', async () => {
    try {
      const received = offset + bytes;
      if (bytes === 0) {
        if (total && received < total) {
          // Nothing new arrived (a glitched request): retry without losing state.
          return res.status(400).json({error: 'Không nhận được dữ liệu cho lượt này.', received});
        }
        throw new Error('Tệp video rỗng hoặc quá trình tải lên bị gián đoạn.');
      }
      if (total && received < total) {
        // A middle slice: keep the file and let the client continue where it left off.
        return res.json({id, received, done: false});
      }
      if (total && received > total) {
        throw new Error('Dung lượng nhận được vượt quá kích thước tệp gốc.');
      }
      const meta = await probeVideo(filePath);
      const payload = {
        id,
        name,
        size: received,
        url: `/api/videos/${id}/file`,
        createdAt: Date.now(),
        done: true,
        ...meta,
      };
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(payload, null, 2));
      // The client states its slice size so the trail reflects the real batching.
      const sliceBytes = Math.min(
        64 * 1024 * 1024,
        Math.max(64 * 1024, Number.parseInt(String(req.query.slice ?? ''), 10) || SLICE_BYTES),
      );
      const slices = total ? Math.ceil(total / sliceBytes) : 1;
      writeStepLog(dir, 'upload', [
        '── tải video lên ──',
        `tệp        : ${name}`,
        `kích thước : ${(received / 1024 / 1024).toFixed(2)} MB${total ? ` · ${slices} lượt × ${(sliceBytes / 1024 / 1024).toFixed(0)}MB` : ''}`,
        `ffprobe    : ${checkCommand('ffprobe') ? 'có' : 'không (dùng media-parser)'}`,
        `định dạng  : ${payload.formatName} · ${payload.width}x${payload.height} @ ${payload.fps}fps · ${payload.durationSec}s`,
        `âm thanh   : ${payload.hasAudio ? 'có' : 'KHÔNG có — bước tạo SRT sẽ thất bại'}`,
        `mã video   : ${id}`,
      ]);
      res.json(payload);
    } catch (err) {
      fs.rmSync(dir, {recursive: true, force: true});
      res.status(400).json({error: humanizeError(err)});
    }
  });
  out.on('error', (err) => {
    // Keep what arrived: a retry can continue from the last complete slice.
    res.status(500).json({error: humanizeError(err)});
  });
  req.on('error', () => out.destroy(new Error('Tải lên bị gián đoạn.')));
});

// ------------------------------------------------------------------ fonts ----

app.get('/api/fonts', (_req, res) => {
  res.json({fonts: listFonts()});
});

app.get('/api/fonts/:file', (req, res) => {
  const file = path.basename(String(req.params.file));
  const target = FONT_FILE_RE.test(file) ? fontPath(file) : null;
  if (!target || !fs.existsSync(target)) {
    return res.status(404).json({error: 'Không tìm thấy phóm chữ này.'});
  }
  res.sendFile(target);
});

app.post('/api/fonts', (req, res) => {
  const name = path.basename(String(req.query.name ?? 'font.ttf'));
  const ext = path.extname(name).toLowerCase();
  if (!FONT_EXT.has(ext)) {
    return res.status(400).json({error: 'Định dạng phóm chữ không được hỗ trợ (ttf, otf, woff, woff2).'});
  }

  const chunks = [];
  let bytes = 0;
  let overflow = false;
  req.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_FONT_BYTES) {
      overflow = true;
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    try {
      if (overflow) return res.status(413).json({error: 'File phóm chữ quá lớn (tối đa 20MB).'});
      if (bytes === 0) return res.status(400).json({error: 'File phóm chữ rỗng hoặc tải lên bị gián đoạn.'});
      res.json(saveFont({originalName: name, buffer: Buffer.concat(chunks)}));
    } catch (err) {
      res.status(400).json({error: humanizeError(err)});
    }
  });
  req.on('error', () => {
    if (!res.headersSent) res.status(400).json({error: 'Tải phóm chữ bị gián đoạn.'});
  });
});

app.delete('/api/fonts/:id', (req, res) => {
  const id = String(req.params.id);
  if (!ID_RE.test(id)) return res.status(400).json({error: 'Mã phóm chữ không hợp lệ.'});
  if (!removeFont(id)) return res.status(404).json({error: 'Không tìm thấy phóm chữ này.'});
  res.json({ok: true, message: 'Đã xóa phóm chữ.'});
});

// ---------------------------------------------------------------- videos ----

app.get('/api/videos/:id', (req, res) => {
  const dir = getDir(req, res);
  if (!dir) return;
  res.json(readMeta(dir));
});

app.get('/api/videos/:id/file', (req, res) => {
  const dir = videoDir(req.params.id);
  const file = fs.readdirSync(dir).find((f) => f.startsWith('input.'));
  if (!file) return res.status(404).end();
  res.sendFile(path.join(dir, file));
});

app.get('/api/videos/:id/output', (req, res) => {
  const file = path.join(videoDir(req.params.id), 'output.mp4');
  if (!fs.existsSync(file)) return res.status(404).json({error: 'Video chưa được render.'});
  if (req.query.download) {
    return res.download(file, 'video_subbed.mp4');
  }
  res.sendFile(file);
});

app.get('/api/videos/:id/srt', (req, res) => {
  const dir = getDir(req, res);
  if (!dir) return;
  const file = path.join(dir, 'video.srt');
  res.json({srt: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''});
});

app.post('/api/videos/:id/srt', async (req, res) => {
  const dir = getDir(req, res);
  if (!dir) return;
  const content = String(req.body?.content ?? '');
  const {valid, errors, cues} = validateSrt(content);
  if (!valid) {
    appendStepLog(dir, 'save', [`lưu thất bại: ${errors.map((e) => `#${e.index ?? '-'} ${e.message}`).join(' · ')}`]);
    return res.status(422).json({errors});
  }
  fs.writeFileSync(path.join(dir, 'video.srt'), content, 'utf8');
  appendStepLog(dir, 'save', [
    '── lưu SRT ──',
    `đã ghi video.srt · ${Buffer.byteLength(content, 'utf8')} bytes · ${cues.length} cue`,
  ]);

  // Render needs `words.json`. An SRT uploaded from a previous session may have
  // no word timings at all: keep the stored ones when they exist, otherwise let
  // cuesFromSrt spread each cue's words evenly across its own duration.
  const wordsFile = path.join(dir, 'words.json');
  if (!fs.existsSync(wordsFile)) {
    try {
      const meta = readMeta(dir);
      const font = await loadSubtitleFont();
      const built = cuesFromSrt(content, {
        words: [],
        font,
        fontSize: fontSizeForWidth(meta.width),
        maxWidth: maxWidthForWidth(meta.width),
        maxLines: 2,
      });
      if (built.errors.length) throw new Error(built.errors[0].message);
      fs.writeFileSync(wordsFile, JSON.stringify({words: [], cues: built.cues}), 'utf8');
      appendStepLog(dir, 'save', [
        `tự sinh words.json (${built.cues.length} cue, không có timing từ thật) — hiệu ứng reveal chia đều theo thời lượng`,
      ]);
    } catch (err) {
      appendStepLog(dir, 'save', [`✕ không sinh được words.json: ${humanizeError(err)}`]);
    }
  }

  res.json({ok: true, message: 'Đã lưu nội dung phụ đề.'});
});

/**
 * Everything a reload needs to put the user back where they were: video meta,
 * the current SRT, the language/look choices and whether an output exists.
 */
app.get('/api/videos/:id/state', (req, res) => {
  const dir = getDir(req, res);
  if (!dir) return;
  const sessionFile = path.join(dir, 'session.json');
  const session = fs.existsSync(sessionFile) ? JSON.parse(fs.readFileSync(sessionFile, 'utf8')) : {};
  const srtFile = path.join(dir, 'video.srt');
  res.json({
    meta: readMeta(dir),
    session,
    srt: fs.existsSync(srtFile) ? fs.readFileSync(srtFile, 'utf8') : '',
    hasOutput: fs.existsSync(path.join(dir, 'output.mp4')),
    createdAt: Date.now(),
  });
});

const SESSION_KEYS = ['sourceLang', 'targetLang', 'look'];

app.post('/api/videos/:id/session', (req, res) => {
  const dir = getDir(req, res);
  if (!dir) return;
  const file = path.join(dir, 'session.json');
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const body = req.body ?? {};
  const patch = {};
  for (const key of SESSION_KEYS) if (key in body) patch[key] = body[key];
  const next = {...prev, ...patch, updatedAt: Date.now()};
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  if (patch.sourceLang !== undefined || patch.targetLang !== undefined) {
    appendStepLog(dir, 'language', [
      `phiên: nguồn ${next.sourceLang ?? '?'} → đích ${next.targetLang ?? '?'} (đã lưu để khôi phục sau khi tải lại trang)`,
    ]);
  }
  if (patch.look) {
    appendStepLog(dir, 'style', [
      `look đã lưu: font=${patch.look.font} · màu=${patch.look.color} · weight=${patch.look.fontWeight} · effect=${patch.look.effect}`,
    ]);
  }
  res.json({ok: true, session: next});
});

app.get('/api/videos/:id/logs', (req, res) => {
  const dir = getDir(req, res);
  if (!dir) return;
  res.json({logs: readLogs(dir)});
});

// ------------------------------------------------------------------ jobs ----

app.post('/api/videos/:id/jobs/transcribe', (req, res) => {
  const dir = getDir(req, res);
  if (!dir) return;
  const meta = readMeta(dir);
  const videoPath = fs.readdirSync(dir).find((f) => f.startsWith('input.'));
  if (!meta || !videoPath) return res.status(404).json({error: 'Không tìm thấy video.'});

  const job = createJob('transcribe', {logFile: path.join(dir, 'logs', 'transcribe.log')});
  runJob(job, () =>
    runTranscribe({
      job,
      videoPath: path.join(dir, videoPath),
      dir,
      meta,
      sourceLang: String(req.body?.sourceLang ?? 'auto'),
      targetLang: String(req.body?.targetLang ?? 'vi'),
    }),
  );
  res.json({jobId: job.id});
});

app.post('/api/videos/:id/jobs/render', (req, res) => {
  const dir = getDir(req, res);
  if (!dir) return;
  const meta = readMeta(dir);
  const videoPath = fs.readdirSync(dir).find((f) => f.startsWith('input.'));
  if (!meta || !videoPath) return res.status(404).json({error: 'Không tìm thấy video.'});

  const job = createJob('render', {logFile: path.join(dir, 'logs', 'render.log')});
  runJob(job, () =>
    runRender({
      job,
      videoPath: path.join(dir, videoPath),
      dir,
      meta,
      look: req.body?.look ?? null,
      crf: Number(req.body?.crf ?? 18),
      concurrency: Number(req.body?.concurrency ?? 4),
    }),
  );
  res.json({jobId: job.id});
});

app.get('/api/jobs/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({error: 'Không tìm thấy tiến trình.'});
  res.json({
    id: job.id,
    type: job.type,
    status: job.status,
    phase: job.phase,
    percent: job.percent,
    message: job.message,
    error: job.error,
    result: job.result,
  });
});

app.get('/api/jobs/:jobId/events', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({error: 'Không tìm thấy tiến trình.'});
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':ok\n\n');
  subscribe(job, res);
  const heartbeat = setInterval(() => res.write(':ping\n\n'), 15000);
  res.on('close', () => clearInterval(heartbeat));
});

// ------------------------------------------------------------ static SPA ----

app.use('/api', (_req, res) => {
  res.status(404).json({error: 'Không tìm thấy API này.'});
});

const DIST = path.join(PROJECT_DIR, 'web', 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

app.use((err, _req, res, _next) => {
  res.status(500).json({error: humanizeError(err)});
});

const PORT = Number(process.env.PORT ?? 4174);
const server = http.createServer(app);
server.listen(PORT, () => {
  process.stdout.write(`API server đang chạy tại http://localhost:${PORT}\n`);
});

export {app, server};
