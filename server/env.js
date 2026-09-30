import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export const PROJECT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STORAGE_DIR = path.join(PROJECT_DIR, 'storage');

const isWin = process.platform === 'win32';

/** Locates the interpreter that has the pipeline packages installed (project venv first). */
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

/**
 * Every distribution `scripts/*.py` imports (transcribe: faster-whisper/ctranslate2 via
 * faster-whisper, transformers+torch for the PhoASR text pass; translate: transformers +
 * sentencepiece). Checked through importlib.metadata so the probe stays fast — importing
 * torch alone costs seconds.
 */
export const REQUIRED_PACKAGES = ['faster-whisper', 'transformers', 'torch', 'sentencepiece'];

const CHECK_CODE = [
  'import importlib.metadata as md, sys',
  `pkgs = ${JSON.stringify(REQUIRED_PACKAGES)}`,
  'missing = []',
  'for p in pkgs:',
  '    try:',
  '        md.version(p)',
  '    except Exception:',
  '        missing.append(p)',
  'print(sys.version.split()[0])',
  'print(" ".join(missing))',
].join('\n');

export const checkPython = () => {
  const python = resolvePython();
  const res = spawnSync(python, ['-c', CHECK_CODE], {
    encoding: 'utf8',
    timeout: 20000,
  });
  const failed = res.status !== 0;
  const lines = String(res.stdout ?? '').trim().split('\n');
  const missing = failed ? [] : (lines[1] ?? '').split(/\s+/).filter(Boolean);
  return {
    ok: !failed && missing.length === 0,
    python,
    version: failed ? null : (lines[0] ?? null),
    missing,
    error: failed ? (res.stderr || res.error?.message || 'Không tìm thấy Python').trim() : null,
  };
};

export const checkCommand = (cmd, args = ['-version']) => {
  const res = spawnSync(cmd, args, {encoding: 'utf8', timeout: 15000, shell: isWin});
  return res.status === 0 || res.status === 1;
};
