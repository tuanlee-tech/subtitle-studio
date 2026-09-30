#!/usr/bin/env node
/**
 * Kiểm tra / chuẩn bị môi trường dev — lệnh cài duy nhất sau khi clone.
 *   npm run setup            : npm install + .venv + requirements.txt + tải model AI + checklist
 *   npm run setup -- --skip-model : bỏ bước tải model (~3GB), tải lazy lần đầu bấm Transcribe
 *   npm run doctor           : chỉ in checklist, không cài gì
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {PROJECT_DIR, checkCommand, checkPython, resolvePython} from '../server/env.js';
import {getBrowserExecutable} from '../lib/render.mjs';

const CHECK_ONLY = process.argv.includes('--check');
const SKIP_MODEL = process.argv.includes('--skip-model');
const isWin = process.platform === 'win32';
const VENV_DIR = path.join(PROJECT_DIR, '.venv');
const VENV_PYTHON = path.join(VENV_DIR, isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');
const REQUIREMENTS = path.join(PROJECT_DIR, 'requirements.txt');

const OK = '[OK]';
const BAD = '[!!]';
const WARN = '[--]';

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, {cwd: PROJECT_DIR, encoding: 'utf8', windowsHide: true, ...opts});

const die = (msg) => {
  console.error(`\n${BAD} ${msg}\n`);
  process.exit(1);
};

/** A venv counts as usable only when its own pip answers (Ubuntu ships no ensurepip). */
const venvHealthy = () => {
  if (!fs.existsSync(VENV_PYTHON)) return false;
  return run(VENV_PYTHON, ['-m', 'pip', '--version'], {encoding: 'utf8'}).status === 0;
};

const venvHelp = (base) => {
  const minor = String(base?.version ?? '3.12').split('.')[1] ?? '3.12';
  return isWin
    ? 'Tạo .venv thất bại - cài lại Python 3.10-3.12 (tick "Add python.exe to PATH") rồi chạy lại `npm run setup`.'
    : [
        'Không tạo được .venv có pip. Chọn một trong hai:',
        `   1) sudo apt install python3-${minor}-venv   (Ubuntu/Debian) · sudo dnf install python3-${minor}-venv (Fedora)`,
        '   2) cho phép máy tải https://bootstrap.pypa.io/get-pip.py rồi chạy lại `npm run setup`',
      ].join('\n');
};

/** pip install bootstrap for interpreters without ensurepip (Ubuntu/Debian minimal images). */
const bootstrapPip = () => {
  const target = path.join(PROJECT_DIR, '.work', 'get-pip.py');
  fs.mkdirSync(path.dirname(target), {recursive: true});
  console.log('-> Tải get-pip.py để bổ sung pip cho .venv ...');
  const url = 'https://bootstrap.pypa.io/get-pip.py';
  const dl = run(
    VENV_PYTHON,
    ['-c', `import urllib.request; urllib.request.urlretrieve(${JSON.stringify(url)}, ${JSON.stringify(target)})`],
    {timeout: 120000},
  );
  if (dl.status !== 0 || !fs.existsSync(target)) return false;
  return run(VENV_PYTHON, [target], {stdio: 'inherit', timeout: 10 * 60 * 1000}).status === 0;
};

/** Creates .venv from scratch, falling back to --without-pip + get-pip when ensurepip is missing. */
const createVenv = (base) => {
  const launcher = base.args ?? [];
  fs.rmSync(VENV_DIR, {recursive: true, force: true});
  console.log(`-> Tạo .venv bằng Python ${base.version} ...`);
  if (run(base.cmd, [...launcher, '-m', 'venv', VENV_DIR], {stdio: 'inherit'}).status === 0 && venvHealthy()) {
    return true;
  }

  console.log('-> Thiếu ensurepip (python3-venv) — tạo .venv không kèm pip rồi tự nạp pip ...');
  fs.rmSync(VENV_DIR, {recursive: true, force: true});
  if (run(base.cmd, [...launcher, '-m', 'venv', '--without-pip', VENV_DIR], {stdio: 'inherit'}).status !== 0) {
    return false;
  }
  return fs.existsSync(VENV_PYTHON) && bootstrapPip() && venvHealthy();
};

/** `args` covers launcher-style entries such as `py -3.12`. */
const pyVersion = (cmd, args = []) => {
  const res = run(cmd, [...args, '-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'], {timeout: 20000});
  if (res.status !== 0) return null;
  const m = (res.stdout || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return {text: m[0], ok: major === 3 && minor >= 10 && minor <= 12};
};

const findPython = () => {
  const candidates = [];
  if (process.env.PYTHON) candidates.push({cmd: process.env.PYTHON, args: []});
  if (isWin) {
    candidates.push(
      {cmd: 'py', args: ['-3.12']},
      {cmd: 'py', args: ['-3.11']},
      {cmd: 'py', args: ['-3.10']},
      {cmd: 'python', args: []},
    );
  } else {
    candidates.push({cmd: 'python3', args: []}, {cmd: 'python', args: []});
  }
  let wrongVersion = null;
  for (const candidate of candidates) {
    const v = pyVersion(candidate.cmd, candidate.args);
    if (v?.ok) return {...candidate, version: v.text};
    if (v && !wrongVersion) wrongVersion = {...candidate, version: v.text};
  }
  return wrongVersion ? {...wrongVersion, wrong: true} : null;
};

const checkNode = () => {
  const major = Number(process.versions.node.split('.')[0]);
  return {ok: major >= 20, text: `v${process.versions.node}`, hint: 'Cài Node.js >= 20 từ https://nodejs.org'};
};

const rows = [];
const add = (icon, name, value, hint) => rows.push({icon, name, value, hint});

const printRows = () => {
  console.log('');
  for (const r of rows) {
    console.log(`  ${r.icon} ${r.name.padEnd(20)} ${r.value}`);
    if (r.hint) console.log(`       -> ${r.hint}`);
  }
  console.log('');
};

const main = () => {
  console.log('\n=== Kiểm tra môi trường - Subtitle Studio ===\n');

  const node = checkNode();
  if (!node.ok) {
    add(BAD, 'Node.js', node.text, node.hint);
    printRows();
    die('Node.js quá cũ, dùng không được.');
  }

  if (!fs.existsSync(path.join(PROJECT_DIR, 'node_modules'))) {
    if (CHECK_ONLY) {
      add(BAD, 'node_modules', 'chưa có', 'chạy: npm install');
    } else {
      console.log('-> Chưa có node_modules, chạy npm install ...');
      const res = run('npm', ['install'], {stdio: 'inherit', shell: isWin});
      if (res.status !== 0) die('npm install thất bại - xem lỗi ở trên.');
    }
  }

  const before = checkPython();
  if (!before.ok && !CHECK_ONLY) {
    const base = findPython();
    if (!base) die('Không tìm thấy Python 3.10-3.12. Cài từ https://www.python.org/downloads/ (tick "Add python.exe to PATH").');
    if (base.wrong) die(`Python tìm thấy ${base.version} không nằm trong 3.10-3.12. Cài bản 3.10, 3.11 hoặc 3.12.`);
    if (!venvHealthy() && !createVenv(base)) die(venvHelp(base));
  }

  if (!CHECK_ONLY) {
    if (!fs.existsSync(VENV_PYTHON)) die(`.venv chưa sẵn sàng (thiếu ${VENV_PYTHON}).`);
    if (before.ok) {
      console.log('-> Python packages đã cài đầy đủ, bỏ qua pip install.');
    } else {
      console.log('-> Cài Python packages theo requirements.txt (lần đầu mất vài phút) ...');
      const res = run(VENV_PYTHON, ['-m', 'pip', 'install', '-r', REQUIREMENTS], {
        stdio: 'inherit',
        timeout: 30 * 60 * 1000,
      });
      if (res.status !== 0) die('pip install thất bại - xem lỗi ở trên.');
    }

    if (SKIP_MODEL) {
      console.log('-> Bỏ qua tải model (--skip-model) — model sẽ tự tải lần đầu bấm Transcribe.');
    } else {
      console.log('-> Tải sẵn model AI (~3GB, một lần; mạng yếu nên mất vài chục phút) ...');
      const res = run(VENV_PYTHON, [path.join(PROJECT_DIR, 'scripts', 'prefetch-models.py')], {
        stdio: 'inherit',
        timeout: 60 * 60 * 1000,
      });
      if (res.status !== 0) {
        console.log(`\n${WARN} Tải model thất bại — app vẫn dùng được, model sẽ tự tải lần đầu bấm Transcribe.\n`);
      }
    }
  }

  const py = checkPython();
  add(node.ok ? OK : BAD, 'Node.js', node.text, node.ok ? null : node.hint);
  if (py.ok) {
    add(OK, 'Python (.venv)', `${py.version} - ${resolvePython()}`, null);
  } else if (py.missing?.length) {
    add(BAD, 'Python (.venv)', `thiếu ${py.missing.join(', ')}`, 'chạy: npm run setup');
  } else {
    const firstError = (py.error || '').split('\n')[0];
    add(BAD, 'Python (.venv)', 'không dùng được', CHECK_ONLY ? `chạy: npm run setup (${firstError})` : firstError);
  }
  const ffprobe = checkCommand('ffprobe');
  add(
    ffprobe ? OK : WARN,
    'ffprobe',
    ffprobe ? 'có' : 'không (dùng media-parser)',
    ffprobe ? null : 'tùy chọn — chỉ là fallback khi media-parser đọc không được',
  );
  const browser = getBrowserExecutable();
  add(browser ? OK : WARN, 'Browser (render)', browser ? path.basename(browser) : 'không thấy', browser ? null : 'Remotion sẽ tự tải headless shell khi render');
  const modelReady = fs.existsSync(path.join(PROJECT_DIR, 'models', 'BuzzASR-vietnamese', 'model.bin'));
  add(modelReady ? OK : WARN, 'Model AI', modelReady ? 'sẵn sàng' : 'chưa có', modelReady ? null : 'lần đầu bấm Transcribe sẽ tải ~3GB (cần mạng)');
  const modules = fs.existsSync(path.join(PROJECT_DIR, 'node_modules'));
  add(modules ? OK : BAD, 'node_modules', modules ? 'có' : 'không', modules ? null : 'chạy: npm install');

  printRows();

  const ready = py.ok && node.ok;
  if (ready) {
    console.log('Sẵn sàng. Chạy tiếp:\n   npm run dev                 -> http://localhost:5173\n   npm run build && npm start  -> http://localhost:4174\n');
  } else {
    console.log('Còn thiếu điều kiện bắt buộc (dấu [!!]) - xem gợi ý mỗi dòng.\n');
  }
  process.exit(ready ? 0 : 1);
};

main();
