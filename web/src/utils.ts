export const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
};

export const formatDuration = (sec: number) => {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
};

export const formatResolution = (w: number, h: number) => `${w} × ${h}`;

export const languageLabel = (code: string) =>
  ({
    auto: 'Tự động nhận diện',
    vi: 'Tiếng Việt',
    en: 'English',
    ja: '日本語',
    ko: '한국어',
    zh: '中文',
    fr: 'Français',
    de: 'Deutsch',
    es: 'Español',
  })[code] ?? code;

export const languageFlag = (code: string) =>
  ({vi: '🇻🇳', en: '🇺🇸', ja: '🇯🇵', ko: '🇰🇷', zh: '🇨🇳', fr: '🇫🇷', de: '🇩🇪', es: '🇪🇸'})[
    code
  ] ?? '';
