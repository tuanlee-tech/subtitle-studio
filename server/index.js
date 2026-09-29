import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import {PROJECT_DIR, STORAGE_DIR, checkCommand, checkPython, resolvePython} from './env.js';
import {createJob, getJob, subscribe} from './jobs.js';
import {probeVideo} from './probe.js';
import {humanizeError, runJob, runRender, runTranscribe, videoDir} from './pipeline.js';
import {validateSrt} from '../lib/srt.mjs';
import {FONT_FILE_RE} from '../lib/look.mjs';
import {FONT_EXT, ID_RE, MAX_FONT_BYTES, fontPath, listFonts, removeFont, saveFont} from './fonts.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({limit: '2mb'}));

const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);
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

  const id = crypto.randomUUID();
  const dir = videoDir(id);
  fs.mkdirSync(dir, {recursive: true});
  const filePath = path.join(dir, `input${ext}`);

  const out = fs.createWriteStream(filePath);
  let bytes = 0;
  req.on('data', (chunk) => {
    bytes += chunk.length;
  });
  req.pipe(out);

  out.on('finish', async () => {
    try {
      if (bytes === 0) throw new Error('Tệp video rỗng hoặc quá trình tải lên bị gián đoạn.');
      const meta = await probeVideo(filePath);
      const payload = {
        id,
        name,
        size: bytes,
        url: `/api/videos/${id}/file`,
        createdAt: Date.now(),
        ...meta,
      };
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(payload, null, 2));
      res.json(payload);
    } catch (err) {
      fs.rmSync(dir, {recursive: true, force: true});
      res.status(400).json({error: humanizeError(err)});
    }
  });
  out.on('error', (err) => {
    fs.rmSync(dir, {recursive: true, force: true});
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

app.post('/api/videos/:id/srt', (req, res) => {
  const dir = getDir(req, res);
  if (!dir) return;
  const content = String(req.body?.content ?? '');
  const {valid, errors} = validateSrt(content);
  if (!valid) return res.status(422).json({errors});
  fs.writeFileSync(path.join(dir, 'video.srt'), content, 'utf8');
  res.json({ok: true, message: 'Đã lưu nội dung phụ đề.'});
});

// ------------------------------------------------------------------ jobs ----

app.post('/api/videos/:id/jobs/transcribe', (req, res) => {
  const dir = getDir(req, res);
  if (!dir) return;
  const meta = readMeta(dir);
  const videoPath = fs.readdirSync(dir).find((f) => f.startsWith('input.'));
  if (!meta || !videoPath) return res.status(404).json({error: 'Không tìm thấy video.'});

  const job = createJob('transcribe');
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

  const job = createJob('render');
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
