import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export const PROJECT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STORAGE_DIR = path.join(PROJECT_DIR, 'storage');

const isWin = process.platform === 'win32';

/** Locates the interpreter that has faster-whisper installed (project venv first). */
export const resolvePython = () => {
  if (process.env.PYTHON) return process.env.PYTHON;
  const candidates = [
    path.join(PROJECT_DIR, '.venv', 'Scripts', 'python.exe'),
    path.join(PROJECT_DIR, 'venv', 'Scripts', 'python.exe'),
    path.join(PROJECT_DIR, '.venv', 'bin', 'python'),
    path.join(PROJECT_DIR, 'venv', 'bin', 'python'),
  ];
  const existing = candidates.find((p) => fs.existsSync(p));
  if (existing) return existing;
  return isWin ? 'python' : 'python3';
};

export const checkPython = () => {
  const python = resolvePython();
  const res = spawnSync(python, ['-c', 'import faster_whisper, sys; print(sys.version.split()[0])'], {
    encoding: 'utf8',
    timeout: 20000,
  });
  return {
    ok: res.status === 0,
    python,
    version: res.status === 0 ? res.stdout.trim() : null,
    error: res.status === 0 ? null : (res.stderr || res.error?.message || 'Không tìm thấy Python').trim(),
  };
};

export const checkCommand = (cmd, args = ['-version']) => {
  const res = spawnSync(cmd, args, {encoding: 'utf8', timeout: 15000, shell: isWin});
  return res.status === 0 || res.status === 1;
};
