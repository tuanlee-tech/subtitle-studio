#!/usr/bin/env node
/**
 * Kiểm tra / chuẩn bị môi trường dev.
 *   npm run setup   : tạo .venv (nếu thiếu) + cài requirements.txt + in checklist
 *   npm run doctor  : chỉ in checklist, không cài gì
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {PROJECT_DIR, checkCommand, checkPython, resolvePython} from '../server/env.js';
import {getBrowserExecutable} from '../lib/render.mjs';

const CHECK_ONLY = process.argv.includes('--check');
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

const pyVersion = (cmd) => {
  const res = run(cmd, ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'], {timeout: 20000});
  if (res.status !== 0) return null;
  const m = (res.stdout || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return {text: m[0], ok: major === 3 && minor >= 10 && minor <= 12};
};

const findPython = () => {
  const candidates = [];
  if (process.env.PYTHON) candidates.push([process.env.PYTHON]);
  if (isWin) {
    candidates.push(['py', '-3.12'], ['py', '-3.11'], ['py', '-3.10'], ['python']);
  } else {
    candidates.push(['python3'], ['python']);
  }
  let wrongVersion = null;
  for (const cmd of candidates) {
    const v = pyVersion(cmd);
    if (v?.ok) return {cmd, version: v.text};
    if (v && !wrongVersion) wrongVersion = {cmd, version: v.text};
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
    console.log(`-> Tạo .venv bằng Python ${base.version} ...`);
    const res = run(base.cmd, ['-m', 'venv', VENV_DIR], {stdio: 'inherit'});
    if (res.status !== 0) die('Tạo .venv thất bại - xem lỗi ở trên.');
  }

  if (!CHECK_ONLY) {
    if (!fs.existsSync(VENV_PYTHON)) die(`.venv chưa sẵn sàng (thiếu ${VENV_PYTHON}).`);
    console.log('-> Cài Python packages theo requirements.txt (lần đầu mất vài phút) ...');
    const res = run(VENV_PYTHON, ['-m', 'pip', 'install', '-r', REQUIREMENTS], {
      stdio: 'inherit',
      timeout: 30 * 60 * 1000,
    });
    if (res.status !== 0) die('pip install thất bại - xem lỗi ở trên.');
  }

  const py = checkPython();
  add(node.ok ? OK : BAD, 'Node.js', node.text, node.ok ? null : node.hint);
  if (py.ok) {
    add(OK, 'Python (.venv)', `${py.version} - ${resolvePython()}`, null);
  } else {
    const firstError = (py.error || '').split('\n')[0];
    add(BAD, 'Python (.venv)', 'không dùng được', CHECK_ONLY ? `chạy: npm run setup (${firstError})` : firstError);
  }
  const ffprobe = checkCommand('ffprobe');
  add(ffprobe ? OK : WARN, 'ffprobe', ffprobe ? 'có' : 'không', 'bước Upload video (bản portable không cần)');
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
