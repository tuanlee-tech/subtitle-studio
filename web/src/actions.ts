import {validateSrt} from '@lib/srt.mjs';
import type {SubtitleLook} from '@lib/look.mjs';
import {createJob, fetchSrt, saveSrt, uploadVideo, watchJob} from './api';
import {canOpen, getState, resetWorkflow, setJob, setStep, setStatus, setState} from './store';
import type {StepId, WorkflowState} from './types';

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');

/** Step 1 — upload (or replace) the source video. */
export const upload = async (file: File) => {
  resetWorkflow();
  setState({uploading: true, uploadPercent: 0, error: null});
  try {
    const video = await uploadVideo(file, (percent) => setState({uploadPercent: percent}));
    setState({video, uploading: false, uploadPercent: 100});
    setStatus('upload', 'completed');
    setStatus('language', 'active');
    setStep('language');
  } catch (err) {
    setState({uploading: false, uploadPercent: 0, error: errorMessage(err)});
    setStatus('upload', 'error');
    setStep('upload');
  }
};

/** Step 2 → 3 — lock the languages and kick off transcription. */
export const confirmLanguages = async () => {
  setState({languageCommitted: true, error: null});
  setStatus('language', 'completed');
  setStatus('transcribe', 'active');
  setStep('transcribe');
  await startTranscribe();
};

/** Step 3 — speech to SRT (server job). */
export const startTranscribe = async () => {
  const s = getState();
  if (!s.video || s.job.status === 'running') return;
  setStatus('transcribe', 'processing');
  setState({error: null, detectedLanguage: null});
  setJob({status: 'running', percent: 2, phase: 'prepare', message: 'Đang chuẩn bị xử lý video...', error: null});

  try {
    const jobId = await createJob(s.video.id, 'transcribe', {
      sourceLang: s.sourceLang,
      targetLang: s.targetLang,
    });
    setJob({jobId});
    watchJob(jobId, {
      onProgress: (p) => setJob({status: 'running', percent: p.percent, phase: p.phase, message: p.message}),
      onDone: (result) => {
        const srt = String(result.srt ?? '');
        const validation = validateSrt(srt);
        setState({
          srt,
          srtValid: validation.valid,
          srtErrors: validation.errors,
          srtDirty: false,
          srtSaved: false,
          cueCount: Number(result.cueCount ?? validation.cues.length),
          detectedLanguage: (result.detectedLanguage as string | null) ?? null,
        });
        setStatus('transcribe', 'completed');
        setStatus('review', 'active');
        setJob({status: 'done', percent: 100, message: 'Hoàn thành tạo SRT.'});
        setStep('review');
      },
      onError: (message) => {
        setStatus('transcribe', 'error');
        setJob({status: 'error', error: message});
        setState({error: message});
      },
    });
  } catch (err) {
    const message = errorMessage(err);
    setStatus('transcribe', 'error');
    setJob({status: 'error', error: message});
    setState({error: message});
  }
};

/** Step 4 — live validation while the user edits the SRT text. */
export const updateSrt = (value: string) => {
  const {valid, errors, cues} = validateSrt(value);
  setState({
    srt: value,
    srtValid: valid,
    srtErrors: errors,
    cueCount: cues.length,
    srtDirty: true,
    srtSaved: false,
  });
};

export const reloadSrt = async () => {
  const s = getState();
  if (!s.video) return;
  try {
    const srt = await fetchSrt(s.video.id);
    const {valid, errors, cues} = validateSrt(srt);
    setState({srt, srtValid: valid, srtErrors: errors, srtDirty: false, cueCount: cues.length});
  } catch (err) {
    setState({error: errorMessage(err)});
  }
};

export const confirmReview = () => {
  const s = getState();
  if (!s.srtValid) return;
  setStatus('review', 'completed');
  setStatus('save', 'active');
  setStep('save');
};

/** Step 5 — persist the edited SRT on the server, or skip ahead when it is saved already. */
export const continueFromSave = async () => {
  const s = getState();
  if (s.srtSaved && !s.srtDirty) {
    setStatus('style', 'active');
    setStep('style');
    return;
  }
  await saveCurrentSrt();
};

export const saveCurrentSrt = async () => {
  const s = getState();
  if (!s.video || !s.srtValid) return;
  setJob({status: 'running', percent: 60, phase: 'save', message: 'Đang lưu file SRT...'});
  try {
    await saveSrt(s.video.id, s.srt);
    setState({srtSaved: true, srtDirty: false});
    setStatus('save', 'completed');
    setStatus('style', 'active');
    setJob({status: 'done', percent: 100, message: 'Đã lưu SRT.'});
    setStep('style');
  } catch (err) {
    const message = errorMessage(err);
    setStatus('save', 'error');
    setJob({status: 'error', error: message});
    setState({error: message});
  }
};

/** Step 6 — tune the subtitle look (color / font / effect), then move to rendering. */
export const chooseLook = (look: SubtitleLook) => setState({look});

/** Applies only the given fields, reading the latest look (never a stale one). */
export const patchLook = (patch: Partial<SubtitleLook>) =>
  setState((s) => ({look: {...s.look, ...patch}}));

export const confirmStyle = () => {
  const s = getState();
  setStatus('style', 'completed');
  setStatus('render', 'active');
  setStep('render');
};

/** Step 7 — burn the SRT into the video (server job) and preview the result. */
export const startRender = async () => {
  const s = getState();
  if (!s.video || s.job.status === 'running') return;
  setStatus('render', 'processing');
  setState({outputUrl: null, error: null});
  setJob({status: 'running', percent: 2, phase: 'prepare', message: 'Đang chuẩn bị render...', error: null});

  try {
    const jobId = await createJob(s.video.id, 'render', {look: s.look, crf: 18, concurrency: 4});
    setJob({jobId});
    watchJob(jobId, {
      onProgress: (p) => setJob({status: 'running', percent: p.percent, phase: p.phase, message: p.message}),
      onDone: (result) => {
        const outputUrl = String(result.outputUrl ?? `/api/videos/${s.video?.id}/output`);
        setState({outputUrl});
        setStatus('render', 'completed');
        setJob({status: 'done', percent: 100, message: 'Hoàn thành video phụ đề.'});
      },
      onError: (message) => {
        setStatus('render', 'error');
        setJob({status: 'error', error: message});
        setState({error: message});
      },
    });
  } catch (err) {
    const message = errorMessage(err);
    setStatus('render', 'error');
    setJob({status: 'error', error: message});
    setState({error: message});
  }
};

/** Sidebar navigation with the same gating the workflow uses. */
export const openStep = (step: StepId) => {
  const s: WorkflowState = getState();
  if (!canOpen(s, step)) return;
  if (s.job.status === 'running') return;
  setStep(step);
};
