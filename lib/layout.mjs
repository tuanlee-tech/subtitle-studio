/**
 * Layout helpers: turn word-level transcript data into subtitle cues that
 * respect the visual style (max 2 lines, bottom-centred, rounded bold font).
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import opentype from 'opentype.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_PATH = path.join(__dirname, '..', 'public', 'fonts', 'Baloo2-Variable.ttf');

const fontCache = new Map();

const parseFontFile = async (filePath) => {
  const buf = await import('node:fs').then((fs) => fs.readFileSync(filePath));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return opentype.parse(ab);
};

/**
 * Loads a font for width measurements. Pass an uploaded font's path to wrap
 * lines with that font's real metrics; a file we cannot parse (or missing)
 * quietly falls back to the default Baloo 2 instead of failing the render.
 */
export const loadSubtitleFont = (fontPath = FONT_PATH) => {
  const key = fontPath || FONT_PATH;
  if (!fontCache.has(key)) {
    fontCache.set(
      key,
      parseFontFile(key).catch((err) => {
        if (key === FONT_PATH) throw err;
        return loadSubtitleFont();
      }),
    );
  }
  return fontCache.get(key);
};

/**
 * Measures the rendered width (px) of `text` at weight 800.
 *
 * opentype.js does not advance-widths variable axes, so we measure the
 * outlined bounding box at wght=800 and add letter-spacing plus a safety
 * margin to stay inside the CSS `max-width` container.
 */
export const measureWidth = (font, text, fontSize, letterSpacingEm = 0.01) => {
  if (!text) return 0;
  const box = font.getPath(text, 0, 0, fontSize, {variation: {wght: 800}}).getBoundingBox();
  const ink = Number.isFinite(box.x2 - box.x1) ? box.x2 - box.x1 : 0;
  const advanceEstimate = font.getAdvanceWidth(text, fontSize);
  const base = Math.max(ink, advanceEstimate);
  const spacing = fontSize * letterSpacingEm * text.length;
  return (base + spacing) * 1.05;
};

/**
 * Greedily wraps `words` into lines no wider than `maxWidth`.
 * @returns {string[]} lines
 */
export const wrapIntoLines = (words, {font, fontSize, maxWidth, maxLines = Infinity}) => {
  const lines = [];
  let current = '';
  for (const raw of words) {
    const word = raw.trim();
    if (!word) continue;
    const candidate = current ? `${current} ${word}` : word;
    if (!current || measureWidth(font, candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
};

/**
 * Whisper occasionally assigns a huge slice of a segment to one word (the
 * last word tends to swallow the remainder of the segment). When a word's
 * reported duration is implausible for its length we rebuild the whole
 * segment's timings proportionally to character count, which keeps text on
 * screen for the full segment instead of one word hanging for 10 seconds.
 *
 * @param {Array<{word: string, start: number, end: number}>} words
 * @returns {Array<{word: string, start: number, end: number}>}
 */
export const stabilizeSegmentTimings = (words, segStart, segEnd) => {
  if (!words || words.length < 2) return words ?? [];
  const chars = (w) => Math.max(1, w.word.trim().length);
  const totalChars = words.reduce((sum, w) => sum + chars(w), 0);
  const span = Math.max(0.01, segEnd - segStart);
  const expected = (w) => (span * chars(w)) / totalChars;

  const hasAnomaly = words.some(
    (w) => w.end - w.start > Math.max(1.5, expected(w) * 4),
  );
  if (!hasAnomaly) return words;

  let cursor = segStart;
  return words.map((w) => {
    const start = Math.min(cursor, segEnd);
    const end = Math.min(start + expected(w), segEnd);
    cursor = end;
    return {...w, start, end};
  });
};

const DEFAULTS = {
  maxLines: 2,
  /** Force a new cue when the silence between words exceeds this (seconds). */
  maxGapSec: 0.7,
  /** Trailing hold so short cues don't flicker. */
  tailPadSec: 0.12,
  /** Hard cap on how long one cue may stay on screen. */
  maxCueSec: 6,
};

/** Greedy-wrap words into lines no wider than maxWidth. */
const wrapWords = (words, font, fontSize, maxWidth) => {
  const lines = [];
  let cur = [];
  for (const w of words) {
    const candidate = [...cur, w];
    const text = candidate.map((x) => x.word.trim()).join(' ');
    if (cur.length === 0 || measureWidth(font, text, fontSize) <= maxWidth) {
      cur = candidate;
      continue;
    }
    lines.push(cur);
    cur = [w];
  }
  if (cur.length) lines.push(cur);
  return lines;
};

/** Split `words` into `k` contiguous groups of roughly equal ink width. */
const splitBalanced = (words, k, font, fontSize) => {
  const widths = words.map((w) => measureWidth(font, w.word.trim(), fontSize));
  const total = widths.reduce((a, b) => a + b, 0);
  const target = total / k;
  const groups = [];
  let cur = [];
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    acc += widths[i];
    const groupsLeft = k - groups.length - 1;
    const wordsLeft = words.length - i - 1;
    // Keep at least one word for each remaining group.
    if (groupsLeft > 0 && wordsLeft >= groupsLeft && acc >= target) {
      groups.push(cur);
      cur = [];
      acc = 0;
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
};

/**
 * Pack one chunk (words between two hard boundaries) into cues.
 *
 * Tries `k = 1, 2, 3...` balanced word-groups and keeps the smallest `k`
 * where every group fits in `maxLines` lines and stays under `maxCueSec`.
 * Balancing by ink width (instead of filling cues greedily) is what avoids
 * a one-word leftover cue such as a stray "sữa" flashing for 0.16s.
 */
const fitChunk = (chunk, {font, fontSize, maxWidth, maxLines, maxCueSec}) => {
  for (let k = 1; k <= chunk.length; k++) {
    const groups = splitBalanced(chunk, k, font, fontSize);
    const wrapped = groups.map((g) => ({
      words: g,
      lines: wrapWords(g, font, fontSize, maxWidth),
    }));
    const fits = wrapped.every(
      ({words, lines}) =>
        lines.length <= maxLines &&
        words[words.length - 1].end - words[0].start <= maxCueSec,
    );
    if (fits) return wrapped;
  }
  // Last resort: one word per cue.
  return chunk.map((w) => ({words: [w], lines: wrapWords([w], font, fontSize, maxWidth)}));
};

/**
 * Builds subtitle cues from Whisper word timings.
 *
 * Words are packed into cues of at most `maxLines` rendered lines; each cue
 * spans from its first word to its last word (+ tail pad), and a cue is cut
 * whenever there is a long silence or the word belongs to a different
 * transcript segment (`segIndex`) than the previous word.
 *
 * @param {Array<{word: string, start: number, end: number, segIndex?: number}>} words
 */
export const buildCues = (words, {font, fontSize, maxWidth, ...options} = {}) => {
  const opts = {...DEFAULTS, ...options};
  if (!font) throw new Error('buildCues requires a loaded font');
  const clean = (words ?? []).filter((w) => w && w.word && w.word.trim());
  if (clean.length === 0) return [];

  // 1. Cut the stream into chunks at hard boundaries (long silence or a new
  //    transcript segment). A cue never straddles one.
  const chunks = [];
  let chunk = [];
  for (const w of clean) {
    const prev = chunk[chunk.length - 1];
    const segChanged =
      prev &&
      typeof w.segIndex === 'number' &&
      typeof prev.segIndex === 'number' &&
      w.segIndex !== prev.segIndex;
    const longGap = prev && w.start - prev.end > opts.maxGapSec;
    if (prev && (segChanged || longGap)) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(w);
  }
  if (chunk.length) chunks.push(chunk);

  // 2. Pack each chunk into as few cues as possible, balanced by ink width.
  const cues = [];
  for (const c of chunks) {
    const packed = fitChunk(c, {
      font,
      fontSize,
      maxWidth,
      maxLines: opts.maxLines,
      maxCueSec: opts.maxCueSec,
    });
    for (const {words: cueWords, lines} of packed) {
      // `lines` keeps the word objects (with their timings) so the renderer can
      // reveal words one by one as they are spoken.
      const wordLines = lines.map((line) =>
        line.map((w) => ({word: w.word.trim(), start: w.start, end: w.end})),
      );
      cues.push({
        startSec: cueWords[0].start,
        endSec: cueWords[cueWords.length - 1].end,
        text: wordLines.map((line) => line.map((w) => w.word).join(' ')).join('\n'),
        lines: wordLines,
      });
    }
  }

  return cues.map((cue, i) => {
    const next = cues[i + 1];
    const cap = next ? next.startSec - 0.02 : Infinity;
    // Hold long enough to be readable (0.4s) but never into the next cue.
    const desired = Math.max(cue.endSec + opts.tailPadSec, cue.startSec + 0.4);
    const endSec = Number.isFinite(cap)
      ? Math.max(Math.min(desired, cap), Math.min(cue.startSec + 0.05, cap))
      : desired;
    return {...cue, endSec: Math.max(endSec, cue.startSec + 0.01)};
  });
};

export {wrapWords as wrapCueWords};

