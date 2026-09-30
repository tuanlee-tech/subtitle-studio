import {useSyncExternalStore} from 'react';
import {DEFAULT_LOOK} from '@lib/look.mjs';
import type {JobState, StepId, StepStatus, WorkflowState} from './types';
import {STEP_ORDER} from './types';

const idleJob: JobState = {
  jobId: null,
  status: 'idle',
  percent: 0,
  phase: 'idle',
  message: '',
  error: null,
};

const initial: WorkflowState = {
  step: 'upload',
  statuses: {
    upload: 'active',
    language: 'pending',
    transcribe: 'pending',
    review: 'pending',
    save: 'pending',
    style: 'pending',
    render: 'pending',
  },
  video: null,
  uploading: false,
  uploadPercent: 0,
  sourceLang: 'auto',
  targetLang: 'vi',
  languageCommitted: false,
  srt: '',
  srtDirty: false,
  srtValid: false,
  srtErrors: [],
  srtSaved: false,
  cueCount: 0,
  detectedLanguage: null,
  look: {...DEFAULT_LOOK},
  job: idleJob,
  outputUrl: null,
  error: null,
  logs: Object.fromEntries(STEP_ORDER.map((s) => [s, [] as string[]])) as Record<StepId, string[]>,
};

let state: WorkflowState = initial;
const listeners = new Set<() => void>();

export const getState = () => state;

const emit = () => listeners.forEach((l) => l());

export const setState = (patch: Partial<WorkflowState> | ((s: WorkflowState) => Partial<WorkflowState>)) => {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = {...state, ...next};
  emit();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useWorkflow = () => useSyncExternalStore(subscribe, getState, getState);

/** Resets every step back to its initial condition (used when a new file is uploaded). */
export const resetWorkflow = () => {
  state = {...initial, statuses: {...initial.statuses}, job: {...idleJob}};
  emit();
};

export const setStep = (step: StepId) =>
  setState((s) => ({
    step,
    statuses: {...s.statuses, [step]: s.statuses[step] === 'pending' ? 'active' : s.statuses[step]},
    error: null,
  }));

export const setStatus = (step: StepId, status: StepStatus) =>
  setState((s) => ({statuses: {...s.statuses, [step]: status}}));

export const setJob = (patch: Partial<JobState>) =>
  setState((s) => ({job: {...s.job, ...patch}}));

/** Per-step terminal trail, capped like the server's in-memory buffer. */
const LOG_LIMIT = 2000;

export const appendLog = (step: StepId, lines: string[]) => {
  if (!lines.length) return;
  setState((s) => {
    const next = [...(s.logs[step] ?? []), ...lines];
    return {logs: {...s.logs, [step]: next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next}};
  });
};

export const setLogs = (step: StepId, lines: string[]) =>
  setState((s) => ({
    logs: {...s.logs, [step]: lines.length > LOG_LIMIT ? lines.slice(lines.length - LOG_LIMIT) : lines},
  }));

/** Client-side event written in the same `HH:MM:SS text` shape as the server trail. */
export const logLine = (step: StepId, text: string) => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  appendLog(step, [`${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${text}`]);
};

/** Furthest step the user may open given what has been completed so far. */
export const maxReachable = (s: WorkflowState): number => {
  let max = 0;
  STEP_ORDER.forEach((id, i) => {
    if (i === 0) return;
    const prev = s.statuses[STEP_ORDER[i - 1]];
    if (prev === 'completed' || prev === 'processing') max = Math.max(max, i);
  });
  return max;
};

export const canOpen = (s: WorkflowState, step: StepId) =>
  STEP_ORDER.indexOf(step) <= maxReachable(s) || s.statuses[step] === 'completed';
