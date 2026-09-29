#!/usr/bin/env node
/**
 * Starts the API server and the Vite dev server together for
 * `npm install && npm run dev`.
 */
import path from 'node:path';
import process from 'node:process';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.join(root, '..');

const apiPort = process.env.PORT ?? '4174';
const webPort = process.env.WEB_PORT ?? '5173';

const children = [];

const start = (command, args, env = {}) => {
  const child = spawn(command, args, {
    cwd: project,
    stdio: 'inherit',
    env: {...process.env, ...env},
    windowsHide: true,
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) shutdown(code);
  });
  children.push(child);
  return child;
};

const shutdown = (code = 0) => {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start(process.execPath, [path.join(project, 'server', 'index.js')], {PORT: apiPort});
start(
  process.execPath,
  [path.join(project, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'web/vite.config.ts'],
  {PORT: apiPort, WEB_PORT: webPort},
);

process.stdout.write(
  `\n  Subtitle Studio\n  - API  : http://localhost:${apiPort}\n  - Web  : http://localhost:${webPort}  (mở URL này)\n\n`,
);
