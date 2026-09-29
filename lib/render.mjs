/**
 * Programmatic Remotion render with progress reporting (the CLI does not expose
 * usable progress over stdout, the dashboard needs a real percentage).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.join(__dirname, '..');

export const getBrowserExecutable = () => {
  const fromEnv = process.env.REMOTION_BROWSER;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          path.join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((p) => p && fs.existsSync(p));
};

/**
 * Bundles the Remotion project. The bundle copies `public/` at build time, so
 * it must be rebuilt whenever a new source video is staged for rendering.
 */
const createServeUrl = async (onProgress) => {
  const {bundle} = await import('@remotion/bundler');
  return bundle({
    entryPoint: path.join(PROJECT_DIR, 'src', 'index.ts'),
    onProgress,
  });
};

/**
 * @param {object} options
 * @param {object} options.inputProps  props passed to the composition
 * @param {string} options.outPath     output .mp4
 * @param {(p: {progress: number, renderedFrames: number, encodedFrames: number}) => void} [options.onProgress]
 */
export const renderSubtitledVideo = async ({
  inputProps,
  outPath,
  onProgress,
  onBundleProgress,
  crf = 18,
  concurrency = 4,
  codec = 'h264',
  audioCodec = 'aac',
}) => {
  const {selectComposition, renderMedia} = await import('@remotion/renderer');
  const serveUrl = await createServeUrl((percent) => onBundleProgress?.(percent));
  const browserExecutable = getBrowserExecutable();

  const composition = await selectComposition({
    serveUrl,
    id: 'SubtitledVideo',
    inputProps,
    ...(browserExecutable ? {browserExecutable} : {}),
  });

  fs.mkdirSync(path.dirname(outPath), {recursive: true});

  await renderMedia({
    composition,
    serveUrl,
    codec,
    audioCodec,
    outputLocation: outPath,
    inputProps,
    crf: Number(crf),
    concurrency: Number(concurrency),
    imageFormat: 'jpeg',
    onProgress: (update) => {
      if (typeof update?.progress === 'number') {
        onProgress?.({
          progress: update.progress,
          renderedFrames: update.renderedFrames ?? 0,
          encodedFrames: update.encodedFrames ?? 0,
          totalFrames: update.renderedFrames && update.progress > 0
            ? Math.round(update.renderedFrames / update.progress)
            : composition.durationInFrames,
        });
      }
    },
    ...(browserExecutable ? {browserExecutable} : {}),
  });

  return {outPath, durationInFrames: composition.durationInFrames};
};
