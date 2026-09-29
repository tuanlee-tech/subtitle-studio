#!/usr/bin/env node
/**
 * sub-tool — video → transcript (Whisper) → .srt → burned-in subtitles (Remotion)
 *
 * Usage:
 *   node cli.mjs <video> [options]
 *
 * Options:
 *   --lang <code>     Skip language detection/prompt (e.g. vi, en)
 *   --model <name>    Whisper model (default: medium)
 *   --out <path>      Output video path (default: <input>_subbed.mp4)
 *   --srt <path>      Output SRT path (default: <input>.srt)
 *   --crf <n>         x264 CRF (default: 18)
 *   --concurrency <n> Render concurrency (default: 4)
 *   --max-lines <n>   Max subtitle lines per cue (default: 2)
 *   --yes             Accept detected language without asking
 *   --keep-work       Keep the temporary work directory
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import {fileURLToPath} from 'node:url';
import {Command} from 'commander';
import {buildCues, loadSubtitleFont, stabilizeSegmentTimings} from './lib/layout.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = __dirname;
const PUBLIC_DIR = path.join(PROJECT_DIR, 'public');
const WORK_DIR = path.join(PROJECT_DIR, '.work');
const PYTHON = process.env.PYTHON ?? 'python3';

const log = (msg) => console.log(msg);
const die = (msg) => {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
};

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, {stdio: 'inherit', ...opts});
  if (res.error) die(`failed to start ${cmd}: ${res.error.message}`);
  if (res.status !== 0) die(`${cmd} exited with code ${res.status}`);
};

const runCapture = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, {encoding: 'utf8', ...opts});
  if (res.error) die(`failed to start ${cmd}: ${res.error.message}`);
  if (res.status !== 0) {
    console.error(res.stderr ?? '');
    die(`${cmd} exited with code ${res.status}`);
  }
  return res.stdout;
};

// ---------- SRT ----------

const formatTimestamp = (sec) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rest).padStart(3, '0')}`;
};

const writeSrt = (cues, outPath) => {
  const body = cues
    .map(
      (cue, i) =>
        `${i + 1}\n${formatTimestamp(cue.startSec)} --> ${formatTimestamp(cue.endSec)}\n${cue.text}\n`,
    )
    .join('\n');
  fs.writeFileSync(outPath, body, 'utf8');
};

// ---------- Language detection ----------

const detectLanguage = (video, model) => {
  log('Detecting language (first 30 seconds)...');
  const out = runCapture(PYTHON, [
    path.join(PROJECT_DIR, 'scripts', 'detect_language.py'),
    video,
    '--model',
    model,
  ]);
  const line = out.trim().split('\n').pop();
  try {
    return JSON.parse(line);
  } catch {
    die(`could not parse language detection output: ${line}`);
  }
};

const askLanguage = async (detected, yes) => {
  if (yes) {
    log(`Using detected language: ${detected.code} (${detected.name})`);
    return detected.code;
  }
  if (!process.stdin.isTTY) {
    log(`No TTY — using detected language: ${detected.code} (${detected.name})`);
    return detected.code;
  }
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  log('');
  log(`Detected language: ${detected.code} (${detected.name})`);
  log(`Confidence: ${(detected.probability * 100).toFixed(1)}%`);
  for (const alt of detected.alternatives ?? []) {
    log(`  also possible: ${alt.code} ${(alt.probability * 100).toFixed(1)}%`);
  }
  const answer = (await rl.question('Use this language? [Y/n/code] ')).trim().toLowerCase();
  rl.close();
  if (answer === '' || answer === 'y' || answer === 'yes') return detected.code;
  if (answer === 'n' || answer === 'no') {
    die('aborted — rerun with --lang <code> to choose a language');
  }
  return answer;
};

// ---------- Transcription ----------

const transcribe = (video, lang, model, outPath) => {
  log(`Transcribing with Whisper (${model}${lang ? `, language=${lang}` : ''})...`);
  const args = [
    path.join(PROJECT_DIR, 'scripts', 'transcribe.py'),
    video,
    '--model',
    model,
    '--out',
    outPath,
  ];
  if (lang) args.push('--language', lang);
  run(PYTHON, args);
  if (!fs.existsSync(outPath)) die(`transcription output missing: ${outPath}`);
  return JSON.parse(fs.readFileSync(outPath, 'utf8'));
};

const collectWords = (result) => {
  const words = [];
  (result.segments ?? []).forEach((seg, segIndex) => {
    const cleaned = (seg.words ?? []).map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    }));
    for (const w of stabilizeSegmentTimings(cleaned, seg.start, seg.end)) {
      // segIndex lets buildCues cut a cue at detected phrase boundaries.
      words.push({...w, segIndex});
    }
  });
  if (words.length === 0) {
    // Fallback: no word timings — split the text of each segment evenly.
    (result.segments ?? []).forEach((seg, segIndex) => {
      const tokens = (seg.text ?? '').trim().split(/\s+/).filter(Boolean);
      if (!tokens.length) return;
      const slice = (seg.end - seg.start) / tokens.length;
      tokens.forEach((t, i) => {
        words.push({
          word: t,
          start: seg.start + i * slice,
          end: seg.start + (i + 1) * slice,
          segIndex,
        });
      });
    });
  }
  return words;
};

// ---------- Video metadata ----------

const probeVideo = (video) => {
  const out = runCapture(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', video],
    {maxBuffer: 16 * 1024 * 1024},
  );
  const info = JSON.parse(out);
  const v = (info.streams ?? []).find((s) => s.codec_type === 'video');
  if (!v) die('no video stream found');
  const [num, den] = (v.avg_frame_rate ?? v.r_frame_rate ?? '30/1').split('/').map(Number);
  const fps = den ? num / den : 30;
  const durationSec = Number(info.format?.duration ?? 0);
  if (!durationSec) die('could not determine video duration');
  const hasAudio = (info.streams ?? []).some((s) => s.codec_type === 'audio');
  return {
    width: v.width,
    height: v.height,
    fps: Math.round(fps * 1000) / 1000,
    durationSec,
    hasAudio,
  };
};

// ---------- Main ----------

const program = new Command();
program
  .name('sub-tool')
  .description('video → transcript → .srt → burned subtitles via Remotion')
  .argument('<video>', 'input video file')
  .option('--lang <code>', 'language code (skips detection/prompt)')
  .option('--model <name>', 'whisper model', 'medium')
  .option('--out <path>', 'output video path')
  .option('--srt <path>', 'output srt path')
  .option('--crf <n>', 'x264 CRF', '18')
  .option('--concurrency <n>', 'render concurrency', '4')
  .option('--max-lines <n>', 'max subtitle lines per cue', '2')
  .option('--yes', 'accept detected language without prompting')
  .option('--keep-work', 'keep temporary work directory')
  .parse(process.argv);

const opts = program.opts();
const video = path.resolve(program.args[0]);
if (!fs.existsSync(video)) die(`input not found: ${video}`);
if (!fs.existsSync(path.join(PUBLIC_DIR, 'fonts', 'Baloo2-Variable.ttf'))) {
  die('missing public/fonts/Baloo2-Variable.ttf');
}

const ext = path.extname(video).toLowerCase();
if (!['.mp4', '.mov', '.mkv', '.webm', '.m4v'].includes(ext)) {
  log(`warning: unusual video extension "${ext}"`);
}

const base = video.replace(/\.[^.]+$/, '');
const outVideo = path.resolve(opts.out ?? `${base}_subbed.mp4`);
const outSrt = path.resolve(opts.srt ?? `${base}.srt`);
if (outVideo === video) die('output path must differ from input');

log(`Input:   ${video}`);
const meta = probeVideo(video);
log(
  `Video:   ${meta.width}x${meta.height} @ ${meta.fps}fps, ${meta.durationSec.toFixed(2)}s, audio: ${meta.hasAudio ? 'yes' : 'NO'}`,
);

// 1. Language
let lang = opts.lang;
if (!lang) {
  const detected = detectLanguage(video, opts.model);
  lang = await askLanguage(detected, opts.yes);
}
log(`Language: ${lang}`);

// 2. Transcribe → word timings
fs.mkdirSync(WORK_DIR, {recursive: true});
const transcriptPath = path.join(WORK_DIR, 'transcript.json');
const transcript = transcribe(video, lang, opts.model, transcriptPath);

// 3. Layout: pack words into cues of at most --max-lines lines
const font = await loadSubtitleFont();
const fontSize = Math.round(meta.width * 0.072);
const maxWidth = meta.width * 0.86;
const words = collectWords(transcript);
const cues = buildCues(words, {
  font,
  fontSize,
  maxWidth,
  maxLines: Number(opts.maxLines),
}).filter((c) => c.startSec < meta.durationSec);
if (cues.length === 0) die('no subtitle cues produced (silent video?)');
log(`Words:   ${words.length}`);
log(`Cues:    ${cues.length} (fontSize ${fontSize}px, max ${opts.maxLines} lines, maxWidth ${Math.round(maxWidth)}px)`);

writeSrt(cues, outSrt);
log(`SRT:     ${outSrt}`);

// 4. Stage video into public/ for Remotion staticFile()
const stagedName = `input_${Date.now()}${ext}`;
const stagedPath = path.join(PUBLIC_DIR, stagedName);
fs.copyFileSync(video, stagedPath);

// 5. Props for Remotion
const props = {
  videoFile: stagedName,
  cues,
  meta: {
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    durationSec: meta.durationSec,
  },
};
const propsPath = path.join(WORK_DIR, 'props.json');
fs.writeFileSync(propsPath, JSON.stringify(props));

// 6. Render
log('Rendering with Remotion...');
try {
  run(
    'npx',
    [
      'remotion',
      'render',
      'src/index.ts',
      'SubtitledVideo',
      outVideo,
      `--props=${propsPath}`,
      `--crf=${opts.crf}`,
      `--concurrency=${opts.concurrency}`,
      '--codec=h264',
      '--audio-codec=aac',
      '--image-format=jpeg',
      '--overwrite',
      `--browser-executable=${process.env.REMOTION_BROWSER ?? '/usr/bin/google-chrome'}`,
    ],
    {cwd: PROJECT_DIR},
  );
} finally {
  fs.rmSync(stagedPath, {force: true});
  if (!opts.keepWork) fs.rmSync(WORK_DIR, {recursive: true, force: true});
}

log('');
log('Done.');
log(`  Video: ${outVideo}`);
log(`  SRT:   ${outSrt}`);
