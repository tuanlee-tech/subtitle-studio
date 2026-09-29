declare module '@lib/srt.mjs' {
  export type SrtCue = {index: number; start: number; end: number; text: string};
  export type SrtParseResult = {
    cues: SrtCue[];
    errors: Array<{index: number | null; message: string}>;
  };
  export const parseSrt: (raw: string) => SrtParseResult;
  export const validateSrt: (raw: string) => {
    valid: boolean;
    errors: Array<{index: number | null; message: string}>;
    cues: SrtCue[];
  };
  export const formatSrt: (
    cues: Array<{startSec?: number; endSec?: number; start?: number; end?: number; text: string}>,
  ) => string;
  export const formatTimestamp: (sec: number) => string;
  export const parseTimestamp: (raw: string) => number | null;
}

declare module '@lib/look.mjs' {
  export type LookEffect = 'neon' | 'shadow' | 'outline' | 'none';

  export type LookFont =
    | 'baloo'
    | 'segoe'
    | 'arial'
    | 'verdana'
    | 'tahoma'
    | 'trebuchet'
    | 'georgia'
    | 'impact';

  export type SubtitleLook = {
    color: string;
    font: LookFont | 'custom';
    fontWeight: number;
    effect: LookEffect;
    customFont?: CustomFont;
  };

  export type CustomFont = {family: string; file: string};

  export type LookFontOption = {id: LookFont; name: string; desc: string; stack: string};
  export type LookEffectOption = {id: LookEffect; label: string};
  export type LookColorOption = {hex: string; label: string};
  export type LookPreset = {id: string; label: string; desc: string; look: SubtitleLook};

  export type LookPreviewStyle = {
    color: string;
    fontFamily: string;
    fontWeight: number;
    textShadow: string;
    WebkitTextStroke?: string;
  };

  export const DEFAULT_LOOK: SubtitleLook;
  export const FONT_FILE_RE: RegExp;
  export const isFontFile: (name: string) => boolean;
  export const FONTS: LookFontOption[];
  export const EFFECTS: LookEffectOption[];
  export const COLORS: LookColorOption[];
  export const PRESETS: LookPreset[];

  export const fontStack: (font: string, customFont?: CustomFont | null) => string;
  export const fontLabel: (font: string, customFont?: CustomFont | null) => string;
  export const effectLabel: (effect: string) => string;
  export const weightForFont: (font: string) => number;
  export const colorLabel: (hex: string) => string;
  export const normalizeLook: (raw: unknown) => SubtitleLook;
  export const presetIdOf: (look: unknown) => string;
  export const presetLabel: (look: unknown) => string;
  export const lookSummary: (look: unknown) => string;
  export const effectTextShadow: (effect: string, glow?: number) => string;
  export const effectStroke: (effect: string, glow?: number) => string | null;
  export const previewStyle: (look: unknown) => LookPreviewStyle;
}
