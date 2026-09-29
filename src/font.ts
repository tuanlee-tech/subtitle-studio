import {continueRender, delayRender, staticFile} from 'remotion';

export const FONT_FAMILY = 'Baloo 2 Sub';

let started = false;

/**
 * Loads the rounded Baloo 2 variable font (supports Vietnamese diacritics)
 * from public/fonts. Must be called once at module scope so that Remotion
 * waits for the font before capturing frames.
 */
export const loadFont = () => {
  if (started || typeof document === 'undefined') {
    return;
  }
  started = true;
  const handle = delayRender('Loading subtitle font');
  const face = new FontFace(
    FONT_FAMILY,
    `url(${staticFile('fonts/Baloo2-Variable.ttf')}) format('truetype')`,
    {weight: '400 800', style: 'normal', display: 'block'},
  );
  face
    .load()
    .then((loaded) => {
      document.fonts.add(loaded);
      continueRender(handle);
    })
    .catch((err) => {
      console.error('Font load failed', err);
      continueRender(handle);
    });
};

const FORMAT: Record<string, string> = {
  ttf: 'truetype',
  otf: 'opentype',
  woff: 'woff',
  woff2: 'woff2',
};

const startedCustom = new Set<string>();

/** Loads a font the user uploaded (public/fonts/custom) for the render. */
export const loadCustomFont = (family: string, file: string) => {
  if (!family || !file || typeof document === 'undefined' || startedCustom.has(file)) {
    return;
  }
  startedCustom.add(file);
  const handle = delayRender(`Loading custom font: ${family}`);
  const format = FORMAT[file.split('.').pop()?.toLowerCase() ?? 'ttf'] ?? 'truetype';
  const face = new FontFace(
    family,
    `url(${staticFile(`fonts/custom/${file}`)}) format('${format}')`,
    {weight: '100 900', style: 'normal', display: 'block'},
  );
  face
    .load()
    .then((loaded) => {
      document.fonts.add(loaded);
      continueRender(handle);
    })
    .catch((err) => {
      console.error('Custom font load failed', err);
      continueRender(handle);
    });
};
