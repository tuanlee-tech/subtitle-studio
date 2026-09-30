/**
 * Programmatic Remotion render with progress reporting (the CLI does not expose
 * usable progress over stdout, the dashboard needs a real percentage).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.join(__dirname, '..');

/**
 * Browser locations per platform (REMOTION_BROWSER wins). Shared by the render
 * pipeline and the QA scripts so every entry point agrees on one search list.
 */
export const browserCandidates = () => {
  const fromEnv = process.env.REMOTION_BROWSER;
  const list =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          path.join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/opt/google/chrome/google-chrome',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium',
          ];
  return [fromEnv, ...list].filter(Boolean);
};

/** Returns the first real browser on this machine, or null (Remotion then downloads one). */
export const getBrowserExecutable = () => {
  const hit = browserCandidates().find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
  return hit ?? null;
};

/** Where the reusable bundle lives — a fresh copy is built only when it goes stale. */
const BUNDLE_DIR = path.join(PROJECT_DIR, 'node_modules', '.cache', 'subtitle-studio-bundle');
const BUNDLE_LOCK = `${BUNDLE_DIR}.lock`;
const STAMP_FILE = path.join(BUNDLE_DIR, 'stamp.txt');
/** Source videos staged into `public/` right before a render (one per render). */
const STAGED_VIDEO = /^input_\d+\.\w+$/;
const LOCK_STALE_MS = 15 * 60 * 1000;
const LOCK_WAIT_MS = 5 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fingerprint of everything the bundle inlines: Remotion sources plus `public/`
 * (fonts, favicon). Staged `input_<ts>.*` videos are skipped — a new source
 * video is topped up into the served bundle instead of forcing a rebuild.
 */
const bundleStamp = () => {
  const roots = [path.join(PROJECT_DIR, 'src'), path.join(PROJECT_DIR, 'public')];
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (dir === roots[1] && STAGED_VIDEO.test(entry.name)) continue;
      else files.push(full);
    }
  };
  for (const root of roots) if (fs.existsSync(root)) walk(root);
  const parts = files.sort().map((file) => {
    try {
      const stat = fs.statSync(file);
      return `${path.relative(PROJECT_DIR, file)}:${stat.size}:${Math.round(stat.mtimeMs)}`;
    } catch {
      return `${path.relative(PROJECT_DIR, file)}:?`;
    }
  });
  let version = '';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'package.json'), 'utf8'));
    version = pkg.dependencies?.remotion ?? pkg.devDependencies?.remotion ?? '';
  } catch {
    /* unreadable package.json → the stamp still covers the sources */
  }
  return `${version}\n${parts.join('\n')}`;
};

/** True when the cached bundle was built from exactly these sources. */
const bundleIsFresh = (stamp) => {
  try {
    return (
      fs.existsSync(path.join(BUNDLE_DIR, 'index.html')) &&
      fs.readFileSync(STAMP_FILE, 'utf8') === stamp
    );
  } catch {
    return false;
  }
};

/**
 * Guards the shared cache directory: two renders started at once must not write
 * the same bundle. Returns 'held' (caller may bundle into BUNDLE_DIR), 'waited'
 * (someone else finished it meanwhile) or 'no-lock' (use a temp dir, no cache).
 */
const acquireBundleLock = async () => {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(BUNDLE_LOCK);
      return 'held';
    } catch (err) {
      if (err?.code !== 'EEXIST') return 'no-lock';
      try {
        if (Date.now() - fs.statSync(BUNDLE_LOCK).mtimeMs > LOCK_STALE_MS) {
          // A crashed process must not block rendering forever.
          fs.rmSync(BUNDLE_LOCK, {recursive: true, force: true});
          continue;
        }
      } catch {
        continue; // the lock vanished between mkdir and stat — retry
      }
      if (Date.now() > deadline) return 'no-lock';
      await sleep(300);
    }
  }
};

/**
 * Bundles the Remotion project, reusing `BUNDLE_DIR` while the sources are
 * unchanged. Bundling used to cost 10-30 s on *every* render; now only the
 * first render after a code/font change pays it.
 */
const createServeUrl = async (onProgress) => {
  const stamp = bundleStamp();
  if (bundleIsFresh(stamp)) {
    onProgress?.(100);
    return {serveUrl: BUNDLE_DIR, cached: true};
  }

  const lock = await acquireBundleLock();
  try {
    // Another render may have built it while we waited for the lock.
    if (lock === 'held' && bundleIsFresh(stamp)) {
      onProgress?.(100);
      return {serveUrl: BUNDLE_DIR, cached: true};
    }
    const {bundle} = await import('@remotion/bundler');
    const serveUrl = await bundle({
      entryPoint: path.join(PROJECT_DIR, 'src', 'index.ts'),
      onProgress,
      ...(lock === 'held' ? {outDir: BUNDLE_DIR} : {}),
    });
    if (lock === 'held') {
      try {
        fs.writeFileSync(STAMP_FILE, stamp);
      } catch (err) {
        console.warn(`không ghi được stamp bundle (${err?.message ?? err})`);
      }
    }
    return {serveUrl, cached: false};
  } finally {
    if (lock === 'held') fs.rmSync(BUNDLE_LOCK, {recursive: true, force: true});
  }
};

/**
 * Keeps the served `public/` in sync: the bundle copies it at build time, so a
 * re-used bundle needs the freshly staged source video copied in (and the
 * previous one removed, so the cache directory does not grow forever).
 */
const syncBundlePublic = (serveUrl, videoFile) => {
  const served = path.join(serveUrl, 'public');
  if (!fs.existsSync(served)) return;
  for (const name of fs.readdirSync(served)) {
    if (STAGED_VIDEO.test(name) && name !== videoFile) {
      fs.rmSync(path.join(served, name), {force: true});
    }
  }
  if (!videoFile) return;
  const source = path.join(PROJECT_DIR, 'public', videoFile);
  const target = path.join(served, videoFile);
  if (!fs.existsSync(source) || path.resolve(source) === path.resolve(target)) return;
  try {
    if (fs.statSync(target).size === fs.statSync(source).size) return;
    fs.copyFileSync(source, target);
  } catch {
    try {
      fs.copyFileSync(source, target); // target may not exist yet
    } catch (err) {
      console.warn(`không copy được ${videoFile} vào bundle (${err?.message ?? err})`);
    }
  }
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
  onBundleReady,
  crf = 18,
  concurrency = 4,
  codec = 'h264',
  audioCodec = 'aac',
}) => {
  const {selectComposition, renderMedia} = await import('@remotion/renderer');
  const {serveUrl, cached} = await createServeUrl((percent) => onBundleProgress?.(percent));
  onBundleReady?.(cached);
  syncBundlePublic(serveUrl, inputProps?.videoFile);
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

  return {outPath, durationInFrames: composition.durationInFrames, bundleCached: cached};
};
