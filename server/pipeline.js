import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {PROJECT_DIR, STORAGE_DIR, resolvePython} from './env.js';
import {cuesFromSrt, cuesFromTranscript, fontSizeForWidth, loadSubtitleFont, maxWidthForWidth} from '../lib/cues.mjs';
import {formatSrt} from '../lib/srt.mjs';
import {DEFAULT_LOOK, normalizeLook} from '../lib/look.mjs';
import {fontPath} from './fonts.js';
import {renderSubtitledVideo, getBrowserExecutable} from '../lib/render.mjs';
import {PHASE_MESSAGES, appendLog, failJob, finishJob, reportPhase, reportPercent} from './jobs.js';

const PUBLIC_DIR = path.join(PROJECT_DIR, 'public');
const SCRIPTS_DIR = path.join(PROJECT_DIR, 'scripts');

export const videoDir = (id) => path.join(STORAGE_DIR, id);

const PHASE_PERCENT = {
  prepare: 5,
  language: 12,
  timing: 25,
  text: 55,
  align: 75,
  srt: 92,
  translate: 94,
};

/** Writes a readable "what was chosen" header into the step's terminal. */
const logHeader = (job, title, fields) => {
  appendLog(job, `── ${title} ──`);
  for (const [key, value] of Object.entries(fields)) {
    appendLog(job, `${key.padEnd(13, ' ')}: ${value}`);
  }
};

const runProcess = (cmd, args, {onLine, onPhase, onPercent} = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {cwd: PROJECT_DIR, windowsHide: true});
    let stdout = '';
    let stderr = '';
    const handle = (chunk, isErr) => {
      const text = String(chunk);
      if (isErr) stderr += text;
      else stdout += text;
      for (const line of text.split(/(\r?\n)/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('##PROG##')) {
          try {
            const {phase} = JSON.parse(trimmed.slice('##PROG##'.length));
            if (phase) onPhase?.(phase);
          } catch {
            /* ignore malformed markers */
          }
        } else if (trimmed.startsWith('##PCT##')) {
          try {
            const {percent, message} = JSON.parse(trimmed.slice('##PCT##'.length));
            if (typeof percent === 'number') onPercent?.(percent, message);
          } catch {
            /* ignore malformed markers */
          }
        } else {
          onLine?.(trimmed, isErr);
        }
      }
    };
    child.stdout.on('data', (d) => handle(d, false));
    child.stderr.on('data', (d) => handle(d, true));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve({stdout, stderr});
      else if (code === null) {
        // Killed from outside (OOM, Ctrl+C, a manual kill): the trail already
        // shows where it stopped, so do not dress progress lines up as an error.
        reject(new Error(`chương trình bị hệ điều hành dừng (${signal ?? 'tín hiệu không rõ'})`));
      } else {
        reject(new Error(tail(stderr) || tail(stdout) || `${path.basename(cmd)} thoát với mã ${code}`));
      }
    });
  });

const tail = (text) =>
  String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-4)
    .join(' — ')
    .slice(0, 400);

/** Step 3: speech -> transcript -> SRT (+ word timings for the reveal). */
export const runTranscribe = async ({job, videoPath, dir, meta, sourceLang = 'auto', targetLang = 'vi'}) => {
  reportPhase(job, 'prepare', 5);
  logHeader(job, 'Tạo SRT (transcribe)', {
    'video': meta.name,
    'kích thước': `${meta.width}x${meta.height} @ ${meta.fps}fps · ${meta.durationSec}s`,
    'ngôn ngữ': `${sourceLang} → ${targetLang}`,
    'python': resolvePython(),
    'model text': process.env.SUBTOOL_MODEL ?? '(mặc định: PhoASR)',
    'timing model': process.env.SUBTOOL_TIMING_MODEL ?? '(mặc định: BuzzASR/vietnamese)',
    'node': process.version,
    'lệnh': `transcribe.py ${path.basename(videoPath)} --language ${sourceLang}`,
  });

  const transcriptPath = path.join(dir, 'transcript.json');
  const args = [
    path.join(SCRIPTS_DIR, 'transcribe.py'),
    videoPath,
    '--out',
    transcriptPath,
    '--language',
    sourceLang || 'auto',
  ];
  if (process.env.SUBTOOL_MODEL) args.push('--model', process.env.SUBTOOL_MODEL);
  if (process.env.SUBTOOL_TIMING_MODEL) args.push('--timing-model', process.env.SUBTOOL_TIMING_MODEL);

  await runProcess(resolvePython(), args, {
    onPhase: (phase) => reportPhase(job, phase, PHASE_PERCENT[phase]),
    onPercent: (percent, message) => reportPercent(job, percent, {phase: job.phase, message}),
    onLine: (line) => {
      appendLog(job, line);
      if (!/^(Warning|\[transformers\]|converting)/.test(line)) {
        // keep the terminal trail available when debugging a run
        process.stdout.write(`[transcribe] ${line}\n`);
      }
    },
  });

  if (!fs.existsSync(transcriptPath)) throw new Error('Không tạo được file transcript.');

  let transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  const detectedLang = transcript.language || 'vi';
  appendLog(job, `phát hiện ngôn ngữ: ${detectedLang} · ${transcript.segments?.length ?? 0} đoạn`);

  if (targetLang && targetLang !== detectedLang) {
    reportPhase(job, 'translate', 94);
    appendLog(job, `dịch ${detectedLang} → ${targetLang}`);
    const translatedPath = path.join(dir, 'transcript.translated.json');
    await runProcess(resolvePython(), [
      path.join(SCRIPTS_DIR, 'translate.py'),
      '--in',
      transcriptPath,
      '--out',
      translatedPath,
      '--src',
      detectedLang,
      '--tgt',
      targetLang,
    ], {
      onLine: (line) => appendLog(job, line),
    });
    if (fs.existsSync(translatedPath)) transcript = JSON.parse(fs.readFileSync(translatedPath, 'utf8'));
  }

  reportPhase(job, 'srt', 96);
  const font = await loadSubtitleFont();
  const fontSize = fontSizeForWidth(meta.width);
  const maxWidth = maxWidthForWidth(meta.width);
  const {cues, words} = cuesFromTranscript(transcript, {font, fontSize, maxWidth, maxLines: 2});
  if (!cues.length) {
    throw new Error('Không tìm thấy lời nói trong video. Hãy kiểm tra lại âm thanh của video.');
  }

  const srt = formatSrt(cues);
  fs.writeFileSync(path.join(dir, 'video.srt'), srt, 'utf8');
  fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify({words, cues}), 'utf8');
  fs.writeFileSync(
    path.join(dir, 'transcript.final.json'),
    JSON.stringify({language: transcript.language, text: transcript.text, segments: transcript.segments}),
    'utf8',
  );

  appendLog(job, `kết quả: ${cues.length} cue · ${words.length} từ có timing · video.srt`);

  finishJob(job, {
    srt,
    language: targetLang || transcript.language,
    detectedLanguage: transcript.language,
    cueCount: cues.length,
    wordCount: words.length,
  });
};

/**
 * Custom fonts are files on disk: when the uploaded file has been deleted we
 * quietly fall back to the default font so the render never breaks.
 */
export const resolveRenderLook = (rawLook) => {
  const look = normalizeLook(rawLook);
  if (look.font !== 'custom') return look;
  const file = fontPath(look.customFont?.file);
  if (file && fs.existsSync(file)) return look;
  return normalizeLook({...look, font: DEFAULT_LOOK.font, customFont: null});
};

/** Steps 6-7: burn the committed SRT into the video. */
export const runRender = async ({job, videoPath, dir, meta, look, crf = 18, concurrency = 4}) => {
  const srtPath = path.join(dir, 'video.srt');
  if (!fs.existsSync(srtPath)) throw new Error('Chưa có file SRT. Hãy tạo và lưu phụ đề trước.');

  reportPhase(job, 'prepare', 2);
  const srt = fs.readFileSync(srtPath, 'utf8');
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'words.json'), 'utf8'));

  const resolvedLook = resolveRenderLook(look);
  logHeader(job, 'Render phụ đề (render)', {
    'video': meta.name,
    'kích thước': `${meta.width}x${meta.height} @ ${meta.fps}fps · ${meta.durationSec}s`,
    'crf': crf,
    'đồng thời': `${concurrency} luồng`,
    'font': resolvedLook.font === 'custom' ? resolvedLook.customFont?.family ?? 'custom' : resolvedLook.font,
    'màu': `${resolvedLook.color} · hiệu ứng ${resolvedLook.effect} · weight ${resolvedLook.fontWeight}`,
    'chromium': getBrowserExecutable() ?? '(chrome mặc định của Remotion)',
    'node': process.version,
  });
  const font = await loadSubtitleFont(
    resolvedLook.font === 'custom' ? fontPath(resolvedLook.customFont.file) : null,
  );
  const fontSize = fontSizeForWidth(meta.width);
  const maxWidth = maxWidthForWidth(meta.width);
  const {cues, errors} = cuesFromSrt(srt, {
    words: stored.words ?? [],
    font,
    fontSize,
    maxWidth,
    maxLines: 2,
  });
  if (errors.length) throw new Error(errors[0].message);
  if (!cues.length) throw new Error('Nội dung phụ đề đang trống.');
  appendLog(job, `SRT: ${cues.length} cue · ${stored.words?.length ?? 0} từ có timing`);
  const totalFrames = Math.max(1, Math.round(meta.durationSec * meta.fps));
  appendLog(job, `khung hình: ${totalFrames}`);
  let lastLogged = 0;

  const ext = path.extname(videoPath) || '.mp4';
  const stagedName = `input_${Date.now()}${ext}`;
  const stagedPath = path.join(PUBLIC_DIR, stagedName);
  fs.mkdirSync(PUBLIC_DIR, {recursive: true});
  fs.copyFileSync(videoPath, stagedPath);

  const outPath = path.join(dir, 'output.mp4');
  const inputProps = {
    videoFile: stagedName,
    cues,
    meta: {width: meta.width, height: meta.height, fps: meta.fps, durationSec: meta.durationSec},
    look: resolvedLook,
  };

  try {
    reportPhase(job, 'bundle', 3);
    appendLog(job, 'đóng gói Remotion (chỉ khi mã nguồn/font đổi, còn lại dùng cache)...');
    await renderSubtitledVideo({
      inputProps,
      outPath,
      crf,
      concurrency,
      onBundleReady: (cached) =>
        appendLog(
          job,
          cached
            ? 'bundle: dùng cache có sẵn — bỏ qua bước đóng gói'
            : 'bundle: đóng gói mới (lần đầu sau khi mã nguồn/font thay đổi)',
        ),
      onBundleProgress: (bundlePercent) =>
        reportPercent(job, 3 + (Number(bundlePercent) / 100) * 4, {
          phase: 'bundle',
          message: 'Đang chuẩn bị môi trường render...',
        }),
      onProgress: ({progress, renderedFrames, totalFrames}) => {
        const percent = 5 + progress * 93;
        const decile = Math.floor(percent / 10) * 10;
        if (decile > lastLogged) {
          lastLogged = decile;
          appendLog(job, `render ${decile}% · ${renderedFrames}/${totalFrames} khung hình`);
        }
        reportPercent(job, percent, {
          phase: 'render',
          message: `Đang xử lý khung hình ${renderedFrames} / ${totalFrames}...`,
        });
      },
    });
    appendLog(job, `đã ghi output.mp4 (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB)`);
  } finally {
    fs.rmSync(stagedPath, {force: true});
  }

  finishJob(job, {outputUrl: `/api/videos/${path.basename(dir)}/output`, file: 'video_subbed.mp4'});
};

/** Wraps a pipeline function so failures become job errors instead of crashes. */
export const runJob = (job, fn) => {
  Promise.resolve()
    .then(fn)
    .catch((err) => {
      const message = humanizeError(err);
      process.stderr.write(`[job ${job.type}] ${message}\n`);
      failJob(job, message);
    });
};

export const humanizeError = (err) => {
  const raw = String(err?.message ?? err ?? 'Lỗi không xác định').trim();
  if (/No module named 'faster_whisper'|No module named 'transformers'/.test(raw)) {
    return 'Thiếu thư viện Python. Hãy chạy `python -m pip install faster-whisper transformers` trong môi trường của project.';
  }
  if (/ENOENT|cannot find|not found/i.test(raw) && /ffprobe/i.test(raw)) {
    return 'Không tìm thấy ffprobe. Hãy cài đặt ffmpeg và thêm vào PATH.';
  }
  if (/CUDA|out of memory/i.test(raw)) return 'Bộ nhớ không đủ để xử lý video. Hãy thử lại với video ngắn hơn.';
  return raw.slice(0, 400);
};

export {PHASE_MESSAGES};
