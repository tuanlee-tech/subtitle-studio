import type {SubtitleLook} from '../lib/look.mjs';

export type Word = {
  word: string;
  start: number;
  end: number;
};

export type Cue = {
  startSec: number;
  endSec: number;
  text: string;
  /** Word groups, one per visual line. Drives the word-by-word reveal. */
  lines?: Word[][];
};

export type SubProps = {
  /** File name inside the Remotion public directory (e.g. "input.mp4") */
  videoFile: string;
  cues: Cue[];
  meta: {
    width: number;
    height: number;
    fps: number;
    durationSec: number;
  };
  /** Color / font / effect of the burned-in subtitles. */
  look?: SubtitleLook;
};
