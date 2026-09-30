import type {SubtitleLook} from '@lib/look.mjs';

export type StepId =
  | 'upload'
  | 'language'
  | 'transcribe'
  | 'review'
  | 'save'
  | 'style'
  | 'render';

export type StepStatus = 'pending' | 'active' | 'processing' | 'completed' | 'error';

export type VideoMeta = {
  id: string;
  name: string;
  size: number;
  url: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  hasAudio: boolean;
  formatName: string;
  createdAt?: number;
};

export type SrtError = {index: number | null; message: string};

/** A font file uploaded from the dashboard (step 6). */
export type FontEntry = {
  id: string;
  family: string;
  file: string;
  name: string;
  ext: string;
  size: number;
  createdAt: number;
};

export type JobState = {
  jobId: string | null;
  status: 'idle' | 'running' | 'done' | 'error';
  percent: number;
  phase: string;
  message: string;
  error: string | null;
};

export type {SubtitleLook};

export type WorkflowState = {
  step: StepId;
  statuses: Record<StepId, StepStatus>;
  video: VideoMeta | null;
  uploading: boolean;
  uploadPercent: number;
  sourceLang: string;
  targetLang: string;
  languageCommitted: boolean;
  srt: string;
  srtDirty: boolean;
  srtValid: boolean;
  srtErrors: SrtError[];
  srtSaved: boolean;
  cueCount: number;
  detectedLanguage: string | null;
  look: SubtitleLook;
  job: JobState;
  outputUrl: string | null;
  error: string | null;
  /** Per-step terminal trail shown in the `<details>` panels. */
  logs: Record<StepId, string[]>;
};

export const STEP_ORDER: StepId[] = [
  'upload',
  'language',
  'transcribe',
  'review',
  'save',
  'style',
  'render',
];
