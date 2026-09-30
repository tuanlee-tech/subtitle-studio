import {validateSrt} from '@lib/srt.mjs';
import {normalizeLook} from '@lib/look.mjs';
import type {SubtitleLook} from '@lib/look.mjs';
import {createJob, fetchLogs, fetchSrt, fetchState, saveSrt, saveSession, uploadVideo, watchJob} from './api';
import type {VideoState} from './api';
import {appendLog, canOpen, getState, logLine, resetWorkflow, setJob, setLogs, setStep, setStatus, setState} from './store';
import type {StepId, StepStatus, WorkflowState} from './types';

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');

/** Where the current video id lives so a reload can pick the session back up. */
const LAST_VIDEO_KEY = 'subtitle-studio:video';

const rememberVideo = (id: string) => {
  try {
    window.localStorage.setItem(LAST_VIDEO_KEY, id);
  } catch {
    /* private mode — restore just won't happen */
  }
};

const forgetVideo = () => {
  try {
    window.localStorage.removeItem(LAST_VIDEO_KEY);
  } catch {
    /* nothing to forget */
  }
};

/**
 * Step 3 escape hatch: use the SRT a previous session produced instead of
 * waiting for the whole pipeline again (that session died after step 3).
 */
export const importSrtFile = async (file: File) => {
  const s = getState();
  if (!s.video) return;
  try {
    const text = await file.text();
    const {valid, errors, cues} = validateSrt(text);
    if (!valid) {
      const message = `File SRT không hợp lệ: ${errors[0]?.message ?? 'lỗi không xác định'}`;
      logLine('transcribe', `✕ ${message}`);
      setState({error: message});
      return;
    }
    const lastEnd = cues.reduce((max, c) => Math.max(max, c.end), 0);
    await saveSrt(s.video.id, text);
    setState({
      srt: text,
      srtValid: true,
      srtErrors: [],
      srtDirty: false,
      srtSaved: true,
      cueCount: cues.length,
      error: null,
    });
    setStatus('transcribe', 'completed');
    setStatus('review', 'active');
    logLine(
      'transcribe',
      `đã nạp SRT cũ: ${file.name} · ${cues.length} cue · dài ${lastEnd.toFixed(1)}s — bỏ qua bước nhận diện`,
    );
    if (s.video.durationSec && lastEnd > s.video.durationSec + 1) {
      logLine(
        'transcribe',
        `⚠ cue cuối (${lastEnd.toFixed(1)}s) vượt thời lượng video (${s.video.durationSec}s) — kiểm tra lại file`,
      );
    }
    setStep('review');
  } catch (err) {
    const message = errorMessage(err);
    logLine('transcribe', `✕ ${message}`);
    setState({error: message});
  }
};

/**
 * Reload / dropped connection: put the workflow back on the step it died at,
 * using what is already on disk instead of starting over.
 */
export const restoreSession = async () => {
  let videoId: string | null = null;
  try {
    videoId = window.localStorage.getItem(LAST_VIDEO_KEY);
  } catch {
    return;
  }
  if (!videoId) return;

  let data: VideoState;
  try {
    data = await fetchState(videoId);
  } catch {
    forgetVideo();
    return;
  }
  if (!data?.meta) {
    forgetVideo();
    return;
  }

  const {meta, session, srt, hasOutput} = data;
  const {valid, errors, cues} = validateSrt(srt);

  const statuses: Record<StepId, StepStatus> = {
    upload: 'completed',
    language: srt ? 'completed' : 'active',
    transcribe: srt ? 'completed' : 'pending',
    review: 'pending',
    save: 'pending',
    style: 'pending',
    render: 'pending',
  };
  let step: StepId = srt ? 'review' : 'language';
  let outputUrl: string | null = null;

  if (srt) statuses.review = 'active';
  if (hasOutput && srt) {
    statuses.review = 'completed';
    statuses.save = 'completed';
    statuses.style = 'completed';
    statuses.render = 'completed';
    step = 'render';
    outputUrl = `/api/videos/${meta.id}/output`;
  }

  setState({
    video: meta,
    sourceLang: session.sourceLang ?? 'auto',
    targetLang: session.targetLang ?? 'vi',
    languageCommitted: true,
    look: normalizeLook(session.look),
    srt,
    srtValid: valid,
    srtErrors: errors,
    srtDirty: false,
    srtSaved: !!srt,
    cueCount: cues.length,
    statuses,
    step,
    outputUrl,
    error: null,
  });
  logLine(
    step,
    `đã khôi phục phiên trước: ${meta.name} · ${srt ? `${cues.length} cue` : 'chưa có SRT'}`,
  );
};

/** Re-reads a step's persisted server trail (upload/save write theirs during the request). */
const refreshStepLog = async (step: StepId): Promise<boolean> => {
  const videoId = getState().video?.id;
  if (!videoId) return false;
  try {
    const all = await fetchLogs(videoId);
    const lines = all[step];
    if (lines?.length) {
      setLogs(step, lines);
      return true;
    }
  } catch {
    /* the trail is a nice-to-have */
  }
  return false;
};

/** Step 1 — upload (or replace) the source video. */
export const upload = async (file: File) => {
  resetWorkflow();
  setState({uploading: true, uploadPercent: 0, error: null});
  try {
    const video = await uploadVideo(file, (percent) => setState({uploadPercent: percent}));
    setState({video, uploading: false, uploadPercent: 100});
    rememberVideo(video.id);
    setStatus('upload', 'completed');
    setStatus('language', 'active');
    setStep('language');
    await refreshStepLog('upload');
  } catch (err) {
    const message = errorMessage(err);
    setState({uploading: false, uploadPercent: 0, error: message});
    logLine('upload', `✕ ${message}`);
    setStatus('upload', 'error');
    setStep('upload');
  }
};

/** Step 2 → 3 — lock the languages and kick off transcription. */
export const confirmLanguages = async () => {
  const s = getState();
  setState({languageCommitted: true, error: null});
  logLine(
    'language',
    `nguồn: ${s.sourceLang} · đích: ${s.targetLang} — nhận diện tự động chạy ở bước tạo SRT`,
  );
  if (s.video) {
    void saveSession(s.video.id, {sourceLang: s.sourceLang, targetLang: s.targetLang}).catch(() => undefined);
  }
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
      onLog: (lines) => appendLog('transcribe', lines),
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
    logLine('transcribe', `✕ ${message}`);
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
  if (!s.srtValid) {
    logLine('review', `✕ SRT chưa hợp lệ (${s.srtErrors.length} lỗi) — sửa xong hãy tiếp tục`);
    return;
  }
  logLine('review', `SRT hợp lệ · ${s.cueCount} cue → bước lưu`);
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
    if (!(await refreshStepLog('save'))) logLine('save', 'đã ghi video.srt trên máy chủ');
    setStatus('save', 'completed');
    setStatus('style', 'active');
    setJob({status: 'done', percent: 100, message: 'Đã lưu SRT.'});
    setStep('style');
  } catch (err) {
    const message = errorMessage(err);
    logLine('save', `✕ ${message}`);
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
  logLine(
    'style',
    `look: font=${s.look.font}${s.look.font === 'custom' ? ` (${s.look.customFont?.family ?? '?'})` : ''} · màu=${s.look.color} · weight=${s.look.fontWeight} · effect=${s.look.effect}`,
  );
  if (s.video) void saveSession(s.video.id, {look: s.look}).catch(() => undefined);
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
      onLog: (lines) => appendLog('render', lines),
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
    logLine('render', `✕ ${message}`);
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
