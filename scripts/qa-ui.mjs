#!/usr/bin/env node
/**
 * Visual QA driver: boots headless Chrome over CDP, pushes every workflow
 * step's state into the dev build and writes one screenshot per step.
 *
 *   1. npm run dev          (in another terminal)
 *   2. node scripts/qa-ui.mjs
 *
 * Screenshots land in .work/qa/.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const project = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(project, '.work', 'qa');
const PORT = Number(process.env.QA_PORT ?? 9333);
const APP_URL = process.env.QA_URL ?? 'http://localhost:5173/';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) throw new Error('Không tìm thấy Chrome để chụp màn hình.');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Uploads the sample video once so every scenario has a real file id. */
const uploadSample = async () => {
  const file = path.join(project, process.env.QA_VIDEO ?? 'video.mp4');
  const buf = fs.readFileSync(file);
  const res = await fetch(`http://localhost:4174/api/uploads?name=${path.basename(file)}`, {
    method: 'POST',
    headers: {'Content-Type': 'video/mp4'},
    body: buf,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  return res.json();
};

const SAMPLE_SRT = `1
00:00:00,190 --> 00:00:01,490
Á nhắn tiền trả lời ba
bữa thật.

2
00:00:01,510 --> 00:00:03,510
Bà kêu em, em bỏ trà
sữa đi.

3
00:00:03,530 --> 00:00:04,950
Ý sô với trời.

4
00:00:04,970 --> 00:00:07,190
Cái chị uống trà sữa mà
làm như vẫn trao vậy.

5
00:00:08,330 --> 00:00:09,870
Hồi sinh viên người ta đi
hạt`;
/** Fetches the real SRT for this video, falling back to the sample text. */
const srtExpr = (id) => `
  const fetched = (await (await fetch('/api/videos/${id}/srt')).json()).srt;
  const srt = fetched && fetched.trim() ? fetched : ${JSON.stringify(SAMPLE_SRT)};
  const cueCount = (srt.match(/^\\d+$/gm) || []).length;`;

const scenarios = (video) => [
  {
    name: '01-upload',
    setup: `__subtool.resetWorkflow(); await tick(300);`,
  },
  {
    name: '02-language',
    setup: `
      __subtool.resetWorkflow();
      __subtool.setState({video: ${JSON.stringify(video)}, uploadPercent: 100, languageCommitted: true,
        statuses: {upload:'completed',language:'active',transcribe:'pending',review:'pending',save:'pending',style:'pending',render:'pending'},
        step: 'language'});
      await tick(400);`,
  },
  {
    name: '03-transcribe',
    setup: `
      __subtool.resetWorkflow();
      __subtool.setState({video: ${JSON.stringify(video)}, languageCommitted: true, sourceLang: 'auto', targetLang: 'vi',
        statuses: {upload:'completed',language:'completed',transcribe:'processing',review:'active',save:'pending',style:'pending',render:'pending'},
        job: {jobId:'demo', status:'running', percent: 55, phase:'text', message:'Đang chuẩn hoá văn bản...', error: null},
        step: 'transcribe'});
      await tick(400);`,
  },
  {
    name: '04-review',
    setup: `
      ${srtExpr(video.id)}
      __subtool.resetWorkflow();
      __subtool.setState({video: ${JSON.stringify(video)}, languageCommitted: true, srt,
        cueCount, srtValid: true, srtErrors: [], srtSaved: false,
        statuses: {upload:'completed',language:'completed',transcribe:'completed',review:'active',save:'pending',style:'pending',render:'pending'},
        step: 'review'});
      await tick(400);`,
  },
  {
    name: '05-save',
    setup: `
      ${srtExpr(video.id)}
      __subtool.resetWorkflow();
      __subtool.setState({video: ${JSON.stringify(video)}, languageCommitted: true, srt, cueCount,
        srtValid: true, srtErrors: [], srtSaved: false,
        statuses: {upload:'completed',language:'completed',transcribe:'completed',review:'completed',save:'active',style:'pending',render:'pending'},
        step: 'save'});
      await tick(400);`,
  },
  {
    name: '06-style',
    setup: `
      __subtool.resetWorkflow();
      __subtool.setState({video: ${JSON.stringify(video)}, languageCommitted: true, cueCount: 11, srtSaved: true,
        look: {color:'#ffffff', font:'baloo', fontWeight:800, effect:'neon'},
        statuses: {upload:'completed',language:'completed',transcribe:'completed',review:'completed',save:'completed',style:'active',render:'pending'},
        step: 'style'});
      await tick(400);`,
  },
  {
    name: '06b-style-custom',
    setup: `
      __subtool.resetWorkflow();
      __subtool.setState({video: ${JSON.stringify(video)}, languageCommitted: true, cueCount: 11, srtSaved: true,
        look: {color:'#38bdf8', font:'verdana', fontWeight:700, effect:'shadow'},
        statuses: {upload:'completed',language:'completed',transcribe:'completed',review:'completed',save:'completed',style:'active',render:'pending'},
        step: 'style'});
      await tick(400);`,
  },
  {
    name: '06c-style-clicked',
    setup: `
      __subtool.resetWorkflow();
      __subtool.setState({video: ${JSON.stringify(video)}, languageCommitted: true, cueCount: 11, srtSaved: true,
        look: {color:'#ffffff', font:'baloo', fontWeight:800, effect:'neon'},
        statuses: {upload:'completed',language:'completed',transcribe:'completed',review:'completed',save:'completed',style:'active',render:'pending'},
        step: 'style'});
      await tick(400);
      const pick = (sel, text) => [...document.querySelectorAll(sel)].find((el) => el.textContent.includes(text));
      const font = pick('.font-opt', 'Impact');
      const red = document.querySelector('.swatch[title="Đỏ"]');
      const chip = pick('.chip-btn', 'Viền đen');
      if (!font || !red || !chip) {
        return JSON.stringify({
          step: __subtool.getState().step,
          fonts: [...document.querySelectorAll('.font-opt')].map((e) => e.textContent.slice(0, 14)),
          swatches: [...document.querySelectorAll('.swatch')].map((e) => e.getAttribute('title')),
          chips: [...document.querySelectorAll('.chip-btn')].map((e) => e.textContent),
        });
      }
      font.click();
      red.click();
      chip.click();
      await tick(400);
      return 'clicked';`,
  },
  {
    name: '06d-style-font-upload',
    setup: `
      __subtool.resetWorkflow();
      __subtool.setState({video: ${JSON.stringify(video)}, languageCommitted: true, cueCount: 11, srtSaved: true,
        look: {color:'#ffffff', font:'baloo', fontWeight:800, effect:'neon'},
        statuses: {upload:'completed',language:'completed',transcribe:'completed',review:'completed',save:'completed',style:'active',render:'pending'},
        step: 'style'});
      await tick(500);
      return 'ready';`,
    files: {selector: '.font-upload input[type="file"]', paths: [path.join(project, '.work', 'georgia.ttf')]},
    postWait: 2500,
    after: `
      window.__guide && window.__guide.destroy();
      const preview = document.querySelector('.look-preview .sub-preview');
      document.querySelector('.custom-fonts')?.scrollIntoView({block: 'center'});
      await tick(500);
      const chips = [...document.querySelectorAll('.font-chip')].map((c) => c.textContent.trim());
      const error = document.querySelector('.custom-fonts__error')?.textContent ?? null;
      return JSON.stringify({
        look: __subtool.getState().look,
        chips,
        error,
        previewFamily: preview ? getComputedStyle(preview).fontFamily : null,
      });`,
    cleanupByName: 'georgia.ttf',
  },
  {
    name: '07-render-running',
    setup: `
      __subtool.resetWorkflow();
      __subtool.setState({video: ${JSON.stringify(video)}, languageCommitted: true, cueCount: 11, srtSaved: true,
        look: {color:'#fde047', font:'baloo', fontWeight:800, effect:'outline'},
        statuses: {upload:'completed',language:'completed',transcribe:'completed',review:'completed',save:'completed',style:'completed',render:'processing'},
        job: {jobId:'demo', status:'running', percent: 65, phase:'render', message:'Đang xử lý khung hình 374 / 584...', error: null},
        step: 'render'});
      await tick(400);`,
  },
  {
    name: '08-render-done',
    setup: `
      __subtool.resetWorkflow();
      __subtool.setState({video: ${JSON.stringify(video)}, languageCommitted: true, cueCount: 11, srtSaved: true,
        look: {color:'#ffffff', font:'baloo', fontWeight:800, effect:'neon'}, outputUrl: '/api/videos/${video.id}/file',
        statuses: {upload:'completed',language:'completed',transcribe:'completed',review:'completed',save:'completed',style:'completed',render:'completed'},
        job: {jobId:'demo', status:'done', percent: 100, phase:'render', message:'Hoàn thành video phụ đề.', error: null},
        step: 'render'});
      await tick(600);`,
  },
];

const main = async () => {
  fs.mkdirSync(OUT_DIR, {recursive: true});
  const profile = path.join(project, '.work', 'qa-chrome-profile');
  fs.mkdirSync(profile, {recursive: true});

  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--window-size=1536,1024',
      'about:blank',
    ],
    {stdio: 'ignore', windowsHide: true},
  );

  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        targets = await res.json();
        if (targets.length) break;
      } catch {
        /* retry */
      }
      await sleep(250);
    }
    if (!targets?.length) throw new Error('Chrome CDP không khởi động được.');

    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let id = 0;
    const pending = new Map();
    const events = [];
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const {resolve, reject} = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        events.push(msg);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, {resolve, reject});
        ws.send(JSON.stringify({id: msgId, method, params}));
      });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');
    await send('Page.navigate', {url: APP_URL});
    await sleep(2500);

    const video = await uploadSample();
    process.stdout.write(`video id: ${video.id}\n`);

    await send('Runtime.evaluate', {
      expression: `window.tick = (ms) => new Promise((r) => setTimeout(r, ms));`,
    });

    for (const scenario of scenarios(video)) {
      const evaluate = await send('Runtime.evaluate', {
        expression: `(async () => { window.__guide?.destroy?.(); ${scenario.setup} })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (evaluate.exceptionDetails) {
        process.stdout.write(`${scenario.name}: LỖI ${evaluate.exceptionDetails.text}\n`);
      } else if (typeof evaluate.result?.value === 'string') {
        process.stdout.write(`${scenario.name}: ${evaluate.result.value}\n`);
      }

      if (scenario.files) {
        const doc = await send('DOM.getDocument', {depth: -1});
        const {nodeId} = await send('DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector: scenario.files.selector,
        });
        if (!nodeId) {
          process.stdout.write(`${scenario.name}: input file không tìm thấy (${scenario.files.selector})\n`);
        } else {
          await send('DOM.setFileInputFiles', {files: scenario.files.paths, nodeId});
          await sleep(scenario.postWait ?? 1500);
        }
      } else {
        await sleep(700);
      }

      if (scenario.after) {
        const after = await send('Runtime.evaluate', {
          expression: `(async () => { ${scenario.after} })()`,
          awaitPromise: true,
          returnByValue: true,
        });
        if (after.exceptionDetails) {
          process.stdout.write(`${scenario.name} (after): LỖI ${after.exceptionDetails.text}\n`);
        } else if (typeof after.result?.value === 'string') {
          process.stdout.write(`${scenario.name} (after): ${after.result.value}\n`);
        }
      }

      const shot = await send('Page.captureScreenshot', {format: 'png'});
      const file = path.join(OUT_DIR, `${scenario.name}.png`);
      try {
        fs.rmSync(file, {force: true});
      } catch {
        /* ignore a locked previous screenshot */
      }
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      process.stdout.write(`${scenario.name} -> ${file}\n`);

      if (scenario.cleanupByName) {
        await send('Runtime.evaluate', {
          expression: `(async () => {
            const list = (await (await fetch('/api/fonts')).json()).fonts ?? [];
            for (const f of list.filter((f) => f.name === ${JSON.stringify(scenario.cleanupByName)})) {
              await fetch('/api/fonts/' + f.id, {method: 'DELETE'});
            }
            return 'cleaned';
          })()`,
          awaitPromise: true,
          returnByValue: true,
        });
      }
    }

    ws.close();
  } finally {
    chrome.kill();
  }
};

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err}\n`);
  process.exit(1);
});
