/**
 * SRT parsing / validation / formatting shared by the CLI, the API server and
 * the dashboard. Validation messages are in Vietnamese because they are shown
 * to the user as-is.
 */

const TIMESTAMP = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/;

export const formatTimestamp = (sec) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  const p = (n, len = 2) => String(n).padStart(len, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(rest, 3)}`;
};

export const parseTimestamp = (raw) => {
  const m = TIMESTAMP.exec(String(raw ?? '').trim());
  if (!m) return null;
  const [, h, min, s, ms] = m.map(Number);
  return h * 3600 + min * 60 + s + ms / 1000;
};

/**
 * Parses SRT text into cues.
 * @returns {{cues: Array<{index:number,start:number,end:number,text:string}>, errors: Array<{index:number|null,message:string}>}}
 */
export const parseSrt = (raw) => {
  const errors = [];
  const text = String(raw ?? '').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  if (!text.trim()) {
    return {cues: [], errors: [{index: null, message: 'Nội dung phụ đề đang trống.'}]};
  }

  const blocks = text.split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l.trim() === ''));
    if (!lines.some((l) => l.trim() !== '')) continue;

    let cursor = 0;
    let index = null;
    if (/^\d+$/.test(lines[0].trim())) {
      index = Number(lines[0].trim());
      cursor = 1;
    }

    const timingLine = (lines[cursor] ?? '').trim();
    const parts = timingLine.split('-->');
    if (parts.length !== 2 || !TIMESTAMP.test(parts[0].trim()) || !TIMESTAMP.test(parts[1].trim())) {
      errors.push({
        index: index ?? cues.length + 1,
        message: `Phụ đề ${index ?? cues.length + 1} có định dạng thời gian không hợp lệ.`,
      });
      continue;
    }

    const start = parseTimestamp(parts[0]);
    const end = parseTimestamp(parts[1]);
    if (start === null || end === null) {
      errors.push({
        index: index ?? cues.length + 1,
        message: `Phụ đề ${index ?? cues.length + 1} có định dạng thời gian không hợp lệ.`,
      });
      continue;
    }
    if (end <= start) {
      errors.push({
        index: index ?? cues.length + 1,
        message: `Phụ đề ${index ?? cues.length + 1}: thời gian kết thúc phải lớn hơn thời gian bắt đầu.`,
      });
      continue;
    }

    const body = lines.slice(cursor + 1).join('\n').trim();
    if (!body) {
      errors.push({
        index: index ?? cues.length + 1,
        message: `Phụ đề ${index ?? cues.length + 1} chưa có nội dung.`,
      });
      continue;
    }

    cues.push({index: index ?? cues.length + 1, start, end, text: body});
  }

  if (cues.length === 0 && errors.length === 0) {
    errors.push({index: null, message: 'Không tìm thấy phụ đề nào trong nội dung.'});
  }
  return {cues, errors};
};

/** Validates without throwing; returns `{valid, errors, cues}`. */
export const validateSrt = (raw) => {
  const {cues, errors} = parseSrt(raw);
  return {valid: errors.length === 0, errors, cues};
};

export const formatSrt = (cues) =>
  cues
    .map((cue, i) => `${i + 1}\n${formatTimestamp(cue.startSec ?? cue.start)} --> ${formatTimestamp(cue.endSec ?? cue.end)}\n${cue.text}\n`)
    .join('\n');
