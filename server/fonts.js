/**
 * Uploaded (custom) subtitle fonts: files live under public/fonts/custom so
 * the Remotion renderer can pick them up with staticFile(), the index in
 * storage/fonts.json powers the dashboard's font list.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';
import {PROJECT_DIR, STORAGE_DIR} from './env.js';
import {FONT_FILE_RE} from '../lib/look.mjs';

export const FONT_DIR = path.join(PROJECT_DIR, 'public', 'fonts', 'custom');
const INDEX_FILE = path.join(STORAGE_DIR, 'fonts.json');

export const FONT_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2']);
export const MAX_FONT_BYTES = 20 * 1024 * 1024;
export const ID_RE = /^[A-Za-z0-9-]+$/;

const readIndex = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeIndex = (list) => {
  fs.mkdirSync(path.dirname(INDEX_FILE), {recursive: true});
  fs.writeFileSync(INDEX_FILE, JSON.stringify(list, null, 2), 'utf8');
};

/** Index entries whose file still exists on disk. */
export const listFonts = () =>
  readIndex().filter((entry) => FONT_FILE_RE.test(entry?.file ?? '') && fs.existsSync(path.join(FONT_DIR, entry.file)));

/** Reads the family name out of the font binary (ttf/otf). */
const familyFromBuffer = (buffer) => {
  try {
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const font = opentype.parse(ab);
    const names = font.names ?? {};
    const source = names.windows ?? names.macintosh ?? {};
    const family = source.fontFamily?.en ?? source.preferredFamily?.en ?? source.fullName?.en;
    if (family && String(family).trim()) {
      return String(family).trim().replace(/\s+/g, ' ').slice(0, 64);
    }
  } catch {
    /* woff/woff2 cannot be parsed here — fall back to the file name */
  }
  return null;
};

const fallbackFamily = (originalName) => {
  const base = path
    .basename(originalName, path.extname(originalName))
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .trim()
    .slice(0, 64);
  return base || 'Phóm chữ tải lên';
};

export const fontPath = (file) =>
  FONT_FILE_RE.test(String(file ?? '')) ? path.join(FONT_DIR, path.basename(String(file))) : null;

export const saveFont = ({originalName, buffer}) => {
  const ext = path.extname(originalName).toLowerCase();
  const file = `${crypto.randomUUID()}${ext}`;
  fs.mkdirSync(FONT_DIR, {recursive: true});
  fs.writeFileSync(path.join(FONT_DIR, file), buffer);

  const entry = {
    id: path.basename(file, ext),
    family: familyFromBuffer(buffer) ?? fallbackFamily(originalName),
    file,
    name: path.basename(originalName),
    ext,
    size: buffer.length,
    createdAt: Date.now(),
  };

  const list = readIndex().filter((e) => e?.file !== file);
  list.unshift(entry);
  writeIndex(list);
  return entry;
};

export const removeFont = (id) => {
  const list = readIndex();
  const hit = list.find((e) => e?.id === id);
  if (!hit) return false;
  writeIndex(list.filter((e) => e?.id !== id));
  const file = fontPath(hit.file);
  if (file) fs.rmSync(file, {force: true});
  return true;
};
