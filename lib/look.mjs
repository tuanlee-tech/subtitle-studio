/**
 * Subtitle look: color, font, effect — shared by the dashboard (preview),
 * the API server (sanitising what the client sends) and the Remotion render.
 */

export const DEFAULT_LOOK = Object.freeze({
  color: '#ffffff',
  font: 'baloo',
  fontWeight: 800,
  effect: 'neon',
});

export const FONTS = [
  {id: 'baloo', name: 'Baloo 2', desc: 'bo tròn', stack: '"Baloo 2 Sub", "Baloo 2", sans-serif'},
  {id: 'segoe', name: 'Segoe UI', desc: 'hiện đại', stack: '"Segoe UI", system-ui, -apple-system, sans-serif'},
  {id: 'arial', name: 'Arial', desc: 'cổ điển', stack: 'Arial, Helvetica, sans-serif'},
  {id: 'verdana', name: 'Verdana', desc: 'rộng, dễ đọc', stack: 'Verdana, Geneva, sans-serif'},
  {id: 'tahoma', name: 'Tahoma', desc: 'gọn gàng', stack: 'Tahoma, Geneva, sans-serif'},
  {id: 'trebuchet', name: 'Trebuchet MS', desc: 'mềm mại', stack: '"Trebuchet MS", Tahoma, sans-serif'},
  {id: 'georgia', name: 'Georgia', desc: 'serif', stack: 'Georgia, "Times New Roman", serif'},
  {id: 'impact', name: 'Impact', desc: 'tiêu đề mạnh', stack: 'Impact, "Arial Black", sans-serif'},
];

export const EFFECTS = [
  {id: 'neon', label: 'Neon đỏ'},
  {id: 'shadow', label: 'Đổ bóng'},
  {id: 'outline', label: 'Viền đen'},
  {id: 'none', label: 'Không hiệu ứng'},
];

export const COLORS = [
  {hex: '#ffffff', label: 'Trắng'},
  {hex: '#fde047', label: 'Vàng'},
  {hex: '#a3e635', label: 'Xanh lá'},
  {hex: '#38bdf8', label: 'Xanh dương'},
  {hex: '#f472b6', label: 'Hồng'},
  {hex: '#fb923c', label: 'Cam'},
  {hex: '#f87171', label: 'Đỏ'},
  {hex: '#111827', label: 'Đen'},
];

export const PRESETS = [
  {
    id: 'neon',
    label: 'Chữ neon đỏ',
    desc: 'Viền phát sáng đỏ, nổi bật trên mọi khung hình',
    look: {color: '#ffffff', font: 'baloo', fontWeight: 800, effect: 'neon'},
  },
  {
    id: 'plain',
    label: 'Trắng tối giản',
    desc: 'Màu trắng, đổ bóng nhẹ, dễ đọc',
    look: {color: '#ffffff', font: 'segoe', fontWeight: 700, effect: 'shadow'},
  },
  {
    id: 'yellow',
    label: 'Vàng cổ điển',
    desc: 'Màu vàng viền đen phong cách truyền hình',
    look: {color: '#fde047', font: 'baloo', fontWeight: 800, effect: 'outline'},
  },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Font file names we accept from the upload endpoint / the client. */
export const FONT_FILE_RE = /^[A-Za-z0-9._-]+\.(ttf|otf|woff|woff2)$/;

export const isFontFile = (name) => FONT_FILE_RE.test(String(name ?? ''));

/** Strips quotes/backslashes so a family name is safe inside a CSS stack. */
const cssQuote = (value) => String(value).replace(/["\\]/g, '');

export const fontStack = (font, customFont = null) => {
  if (font === 'custom' && customFont?.family && isFontFile(customFont.file)) {
    return `"${cssQuote(customFont.family)}", sans-serif`;
  }
  return FONTS.find((f) => f.id === font)?.stack ?? FONTS[0].stack;
};

export const fontLabel = (font, customFont = null) => {
  if (font === 'custom' && customFont?.family) return customFont.family;
  return FONTS.find((f) => f.id === font)?.name ?? font;
};

export const effectLabel = (effect) => EFFECTS.find((e) => e.id === effect)?.label ?? effect;

export const weightForFont = (font) => (font === 'baloo' || font === 'impact' ? 800 : 700);

export const colorLabel = (hex) => {
  const found = COLORS.find((c) => c.hex.toLowerCase() === String(hex).toLowerCase());
  if (found) return found.label;
  return String(hex).replace('#', '').toUpperCase();
};

/** Keeps a custom font only when both family and file name are sane. */
const readCustomFont = (raw) => {
  const cf = raw && typeof raw === 'object' ? raw : null;
  if (!cf) return null;
  const family = String(cf.family ?? '').trim().slice(0, 64);
  const file = String(cf.file ?? '');
  if (!family || !isFontFile(file)) return null;
  return {family, file};
};

/** Coerces whatever the client sent into a look we are happy to render. */
export const normalizeLook = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const customFont = readCustomFont(input.customFont);
  const color = HEX.test(String(input.color ?? '')) ? input.color : DEFAULT_LOOK.color;
  const font =
    input.font === 'custom' && customFont
      ? 'custom'
      : FONTS.some((f) => f.id === input.font)
        ? input.font
        : DEFAULT_LOOK.font;
  const effect = EFFECTS.some((e) => e.id === input.effect) ? input.effect : DEFAULT_LOOK.effect;
  const fontWeight = [400, 500, 600, 700, 800].includes(Number(input.fontWeight))
    ? Number(input.fontWeight)
    : weightForFont(font);
  return customFont
    ? {color, font, fontWeight, effect, customFont}
    : {color, font, fontWeight, effect};
};

/** Returns the matching preset id, or "custom" when the look was hand-tuned. */
export const presetIdOf = (look) => {
  const normalized = normalizeLook(look);
  const hit = PRESETS.find(
    (p) =>
      p.look.color.toLowerCase() === normalized.color.toLowerCase() &&
      p.look.font === normalized.font &&
      p.look.effect === normalized.effect,
  );
  return hit ? hit.id : 'custom';
};

export const presetLabel = (look) => {
  const id = presetIdOf(look);
  return PRESETS.find((p) => p.id === id)?.label ?? 'Tùy chỉnh';
};

export const lookSummary = (look) => {
  const n = normalizeLook(look);
  return `${fontLabel(n.font, n.customFont)} · ${colorLabel(n.color)} · ${effectLabel(n.effect)}`;
};

/** Text glow / shadow, scaled by the renderer's glow factor. */
export const effectTextShadow = (effect, glow = 8) => {
  switch (effect) {
    case 'neon':
      return [
        `0 0 ${glow * 0.6}px rgba(255,255,255,0.95)`,
        `0 0 ${glow * 1.6}px rgba(255,64,110,0.95)`,
        `0 0 ${glow * 3.2}px rgba(255,32,80,0.9)`,
        `0 0 ${glow * 6}px rgba(255,0,64,0.75)`,
        `0 0 ${glow * 10}px rgba(220,0,60,0.55)`,
        `0 2px ${glow * 0.8}px rgba(0,0,0,0.7)`,
      ].join(', ');
    case 'shadow':
      return '0 2px 6px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,0.75)';
    case 'outline':
      return '0 2px 4px rgba(0,0,0,0.55)';
    default:
      return 'none';
  }
};

/** Stroke (outline of the glyphs), scaled by the renderer's glow factor. */
export const effectStroke = (effect, glow = 8) => {
  if (effect === 'outline') return `${Math.max(1.5, glow * 0.3)}px rgba(0,0,0,0.85)`;
  if (effect === 'neon') return `${Math.max(1, glow * 0.18)}px rgba(255,255,255,0.35)`;
  return null;
};

/** Inline style used by the dashboard previews (small glow scale). */
export const previewStyle = (look) => {
  const n = normalizeLook(look);
  const style = {
    color: n.color,
    fontFamily: fontStack(n.font, n.customFont),
    fontWeight: n.fontWeight,
    textShadow: effectTextShadow(n.effect, 7),
  };
  const stroke = effectStroke(n.effect, 7);
  if (stroke) style.WebkitTextStroke = stroke;
  return style;
};
