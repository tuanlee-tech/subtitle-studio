/**
 * Turn a transcript (or an edited SRT) into renderable cues.
 *
 * A cue always carries `lines` — arrays of `{word, start, end}` — because the
 * subtitle style reveals words one by one as they are spoken. `text` is kept
 * for the .srt file.
 */
import {buildCues, loadSubtitleFont, stabilizeSegmentTimings, wrapCueWords} from './layout.mjs';
import {parseSrt} from './srt.mjs';

export {loadSubtitleFont};

export const fontSizeForWidth = (width) => Math.round(width * 0.072);
export const maxWidthForWidth = (width) => width * 0.86;

/** Flattens whisper word timings, repairing segments with bogus durations. */
export const collectWords = (result) => {
  const words = [];
  (result?.segments ?? []).forEach((seg, segIndex) => {
    const cleaned = (seg.words ?? []).map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    }));
    for (const w of stabilizeSegmentTimings(cleaned, seg.start, seg.end)) {
      words.push({...w, segIndex});
    }
  });
  if (words.length === 0) {
    (result?.segments ?? []).forEach((seg, segIndex) => {
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

export const cuesFromTranscript = (transcript, {font, fontSize, maxWidth, maxLines = 2} = {}) => {
  const words = collectWords(transcript);
  const cues = buildCues(words, {font, fontSize, maxWidth, maxLines});
  return {words, cues};
};

const normalizeToken = (token) =>
  token
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Maps `targetText` onto the timings of `sourceWords` with a token-level diff,
 * so a user-edited subtitle keeps the word-by-word reveal.
 * @returns {Array<{word: string, start: number, end: number}>}
 */
export const alignTextToWords = (sourceWords, targetText) => {
  const src = (sourceWords ?? [])
    .filter((w) => w && String(w.word).trim())
    .map((w) => ({norm: normalizeToken(String(w.word)), start: w.start, end: w.end}));
  const tokens = String(targetText ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const dst = tokens.map(normalizeToken);

  if (src.length === 0 || dst.length === 0) return [];

  // Levenshtein alignment with backtrace.
  const n = src.length;
  const m = dst.length;
  const dist = Array.from({length: n + 1}, (_, i) => new Uint16Array(m + 1));
  const back = Array.from({length: n + 1}, (_, i) => new Uint8Array(m + 1)); // 0 diag, 1 up, 2 left
  for (let i = 1; i <= n; i++) dist[i][0] = i;
  for (let j = 1; j <= m; j++) dist[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = src[i - 1].norm === dst[j - 1] && src[i - 1].norm !== '' ? 0 : 1;
      const diag = dist[i - 1][j - 1] + cost;
      const up = dist[i - 1][j] + 1;
      const left = dist[i][j - 1] + 1;
      if (diag <= up && diag <= left) {
        dist[i][j] = diag;
        back[i][j] = 0;
      } else if (up <= left) {
        dist[i][j] = up;
        back[i][j] = 1;
      } else {
        dist[i][j] = left;
        back[i][j] = 2;
      }
    }
  }

  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && back[i][j] === 0) {
      ops.push({type: dist[i][j] === dist[i - 1][j - 1] ? 'equal' : 'replace', si: i - 1, di: j - 1});
      i--;
      j--;
    } else if (i > 0 && (j === 0 || back[i][j] === 1)) {
      ops.push({type: 'delete', si: i - 1});
      i--;
    } else {
      ops.push({type: 'insert', di: j - 1});
      j--;
    }
  }
  ops.reverse();

  const out = [];
  for (const op of ops) {
    if (op.type === 'equal') {
      const s = src[op.si];
      out.push({word: tokens[op.di], start: s.start, end: s.end});
    } else if (op.type === 'replace') {
      // Anchor a replaced token to the source token it stands in for.
      const s = src[op.si];
      out.push({word: tokens[op.di], start: s.start, end: s.end});
    }
    // inserts/deletes: run of tokens without a source token handled below
  }

  // Tokens produced by pure inserts have no timing yet — spread them across the
  // gap between their neighbours.
  for (let k = 0; k < out.length; k++) {
    if (out[k].end > out[k].start) continue;
    const prev = out[k - 1];
    const next = out[k + 1];
    const t0 = prev ? prev.end : (next ? next.start : 0);
    const t1 = next ? next.start : t0 + 0.2;
    const run = [];
    let p = k;
    while (p < out.length && !(out[p].end > out[p].start)) {
      run.push(out[p]);
      p++;
    }
    const step = Math.max(0.02, (t1 - t0) / run.length);
    run.forEach((item, idx) => {
      item.start = t0 + idx * step;
      item.end = t0 + (idx + 1) * step;
    });
    k = p - 1;
  }

  return out;
};

const spreadWords = (tokens, start, end) => {
  const chars = tokens.reduce((sum, t) => sum + Math.max(1, t.length), 0);
  const span = Math.max(0.05, end - start);
  let cursor = start;
  return tokens.map((t) => {
    const share = span * (Math.max(1, t.length) / chars);
    const wordStart = cursor;
    const wordEnd = Math.min(end, cursor + share);
    cursor = wordEnd;
    return {word: t, start: wordStart, end: wordEnd};
  });
};

/**
 * Builds cues from SRT text (possibly edited by the user), reusing the stored
 * word timings so the reveal animation still follows the audio.
 */
export const cuesFromSrt = (srtText, {words = [], font, fontSize, maxWidth, maxLines = 2} = {}) => {
  const {cues: parsed, errors} = parseSrt(srtText);
  if (errors.length) return {cues: [], errors};

  const sorted = [...words].sort((a, b) => a.start - b.start);
  const cues = parsed.map((cue) => {
    const inRange = sorted.filter((w) => w.start >= cue.start - 0.15 && w.end <= cue.end + 0.15);
    const tokens = cue.text.split(/\s+/).filter(Boolean);
    let wordTimings;
    if (inRange.length >= 2) {
      wordTimings = alignTextToWords(inRange, cue.text);
      if (wordTimings.length !== tokens.length || wordTimings.some((w) => !(w.end > w.start))) {
        wordTimings = spreadWords(tokens, cue.start, cue.end);
      }
    } else {
      wordTimings = spreadWords(tokens, cue.start, cue.end);
    }

    const lines = wrapCueWords(
      wordTimings.map((w) => ({...w, word: w.word})),
      font,
      fontSize,
      maxWidth,
    ).map((line) =>
      line.map((w) => ({
        word: String(w.word).trim(),
        start: w.start,
        end: w.end,
      })),
    );

    return {
      startSec: cue.start,
      endSec: cue.end,
      text: cue.text,
      lines,
    };
  });

  return {cues, errors: []};
};
