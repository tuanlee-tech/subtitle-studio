#!/usr/bin/env node
/**
 * Guided-tour QA: boots headless Chrome over CDP, checks that driver.js
 * auto-runs on a fresh profile, walks a few steps and shoots each stage.
 *
 *   1. npm run dev          (in another terminal)
 *   2. node scripts/qa-guide.mjs
 *
 * Screenshots land in .work/qa/guide-*.png.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {getBrowserExecutable} from '../lib/render.mjs';

const project = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(project, '.work', 'qa');
const PORT = Number(process.env.QA_PORT ?? 9355);
const APP_URL = process.env.QA_URL ?? 'http://localhost:5173/';
const API = process.env.API_URL ?? 'http://localhost:4174';

const chromePath = getBrowserExecutable();
if (!chromePath) throw new Error('Không tìm thấy Chrome để chụp màn hình (đặt REMOTION_BROWSER = đường dẫn Chrome).');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const uploadSample = async () => {
  const file = path.join(project, process.env.QA_VIDEO ?? 'video.mp4');
  const res = await fetch(`${API}/api/uploads?name=${path.basename(file)}`, {
    method: 'POST',
    headers: {'Content-Type': 'video/mp4'},
    body: fs.readFileSync(file),
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  return res.json();
};

const main = async () => {
  fs.mkdirSync(OUT_DIR, {recursive: true});
  const profile = path.join(project, '.work', 'qa-guide-profile');
  fs.rmSync(profile, {recursive: true, force: true});
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
        targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const {resolve, reject} = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, {resolve, reject});
        ws.send(JSON.stringify({id: msgId, method, params}));
      });

    const evaluate = async (expression) => {
      const res = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
      }
      return res.result?.value;
    };

    const shot = async (name) => {
      const s = await send('Page.captureScreenshot', {format: 'png'});
      const file = path.join(OUT_DIR, `${name}.png`);
      try {
        fs.rmSync(file, {force: true});
      } catch {
        /* ignore a locked previous screenshot */
      }
      fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
      process.stdout.write(`  -> ${file}\n`);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', {url: APP_URL});
    await sleep(1500);
    await evaluate(`window.tick = (ms) => new Promise((r) => setTimeout(r, ms));`);

    const video = await uploadSample();
    process.stdout.write(`video id: ${video.id}\n`);

    // --- fresh profile: the tour must start on its own -------------------
    await sleep(2200);
    const auto = await evaluate(`({
      hasGuide: typeof __subtool?.startGuide === 'function',
      active: Boolean(window.__guide && __guide.isActive()),
      steps: window.__guide ? __guide.getConfig().steps.length : 0,
      seen: localStorage.getItem('subtitle-studio:guide-seen'),
    })`);
    process.stdout.write(`auto-start: ${JSON.stringify(auto)}\n`);
    await shot('guide-01-auto');

    await evaluate(`__guide.moveNext()`);
    await sleep(700);
    await evaluate(`__guide.moveNext()`);
    await sleep(700);
    const step3 = await evaluate(`({
      index: __guide.getActiveIndex(),
      title: document.querySelector('.driver-popover-title')?.textContent ?? null,
      progress: document.querySelector('.driver-popover-progress-text')?.textContent ?? null,
    })`);
    process.stdout.write(`step 3: ${JSON.stringify(step3)}\n`);
    await shot('guide-02-panel');

    const seenAfterClose = await evaluate(`(() => {
      __guide.destroy();
      return localStorage.getItem('subtitle-studio:guide-seen');
    })()`);
    process.stdout.write(`seen flag after close: ${seenAfterClose}\n`);

    // --- tour on the style step (custom look editor) ---------------------
    await evaluate(`
      (async () => {
        __subtool.resetWorkflow();
        __subtool.setState({
          video: ${JSON.stringify(video)},
          languageCommitted: true, cueCount: 11, srtSaved: true,
          look: {color: '#38bdf8', font: 'verdana', fontWeight: 700, effect: 'shadow'},
          statuses: {upload:'completed',language:'completed',transcribe:'completed',review:'completed',save:'completed',style:'active',render:'pending'},
          step: 'style',
        });
        await new Promise((r) => setTimeout(r, 500));
        __subtool.resetGuideSeen();
        __subtool.startGuide();
        return true;
      })()
    `);
    await sleep(700);
    const styleSteps = await evaluate(`__guide.getConfig().steps.map((s) => s.element)`);
    process.stdout.write(`style tour: ${JSON.stringify(styleSteps)}\n`);
    const styleIndex = styleSteps.findIndex((el) => String(el).includes('look-editor'));
    await evaluate(`__guide.drive(${styleIndex})`);
    await sleep(700);
    const styleActive = await evaluate(`({
      index: __guide.getActiveIndex(),
      title: document.querySelector('.driver-popover-title')?.textContent ?? null,
    })`);
    process.stdout.write(`style highlight: ${JSON.stringify(styleActive)}\n`);
    await shot('guide-03-style-look-editor');

    const fontIndex = styleSteps.findIndex((el) => String(el).includes('font-upload'));
    if (fontIndex >= 0) {
      await evaluate(`__guide.drive(${fontIndex})`);
      await sleep(700);
      const fontActive = await evaluate(`({
        index: __guide.getActiveIndex(),
        title: document.querySelector('.driver-popover-title')?.textContent ?? null,
        description: document.querySelector('.driver-popover-description')?.textContent ?? null,
      })`);
      process.stdout.write(`font-upload highlight: ${JSON.stringify(fontActive)}\n`);
      await shot('guide-03b-style-font-upload');
    } else {
      process.stdout.write(`font-upload highlight: MISSING\n`);
    }

    // --- tour on the finished render step -------------------------------
    await evaluate(`__guide.destroy()`);
    await evaluate(`
      (async () => {
        __subtool.setState({
          outputUrl: '/api/videos/${video.id}/file',
          statuses: {upload:'completed',language:'completed',transcribe:'completed',review:'completed',save:'completed',style:'completed',render:'completed'},
          job: {jobId:'demo', status:'done', percent: 100, phase:'render', message:'Hoàn thành video phụ đề.', error: null},
          step: 'render',
        });
        await new Promise((r) => setTimeout(r, 500));
        __subtool.startGuide();
        return true;
      })()
    `);
    await sleep(700);
    const renderSteps = await evaluate(`__guide.getConfig().steps.map((s) => s.element)`);
    process.stdout.write(`render tour: ${JSON.stringify(renderSteps)}\n`);
    const renderIndex = renderSteps.findIndex((el) => String(el).includes('result-video'));
    await evaluate(`__guide.drive(${renderIndex})`);
    await sleep(700);
    await shot('guide-04-render-result');

    await evaluate(`__guide.destroy()`);
    const finalSeen = await evaluate(`localStorage.getItem('subtitle-studio:guide-seen')`);
    process.stdout.write(`final seen flag: ${finalSeen}\n`);

    ws.close();
  } finally {
    chrome.kill();
  }
};

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err}\n`);
  process.exit(1);
});
