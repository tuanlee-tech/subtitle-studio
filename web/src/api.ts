import type {FontEntry, JobState, VideoMeta} from './types';

export type JobHandlers = {
  onProgress: (p: {phase: string; percent: number; message: string}) => void;
  onLog?: (lines: string[]) => void;
  onDone: (result: Record<string, unknown>) => void;
  onError: (message: string) => void;
};

const readError = async (res: Response) => {
  try {
    const data = await res.json();
    if (Array.isArray(data.errors) && data.errors.length) return data.errors[0].message;
    return data.error ?? 'Có lỗi xảy ra, vui lòng thử lại.';
  } catch {
    return `Không kết nối được máy chủ (HTTP ${res.status}).`;
  }
};

/**
 * Upload slice size — matches the server's `SLICE_BYTES` (5 MB). QA can shrink
 * it (`sessionStorage['subtitle-studio:slice']`) to exercise multi-slice uploads
 * with small files; production never sets it.
 */
const SLICE_BYTES = (() => {
  try {
    const override = Number(window.sessionStorage.getItem('subtitle-studio:slice'));
    if (Number.isFinite(override) && override >= 64 * 1024) return Math.floor(override);
  } catch {
    /* storage blocked — fall through to the default */
  }
  return 5 * 1024 * 1024;
})();
const SLICE_RETRIES = 3;

type SliceAck = {id?: string; received?: number; done?: boolean; error?: string};

const sendSlice = (url: string, blob: Blob, onLoaded: (bytes: number) => void) =>
  new Promise<SliceAck>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onLoaded(e.loaded);
    };
    xhr.onerror = () => reject(new Error('Không tải được video lên máy chủ.'));
    xhr.onabort = () => reject(new Error('Đã hủy tải video.'));
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* fall through */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) return resolve(data as SliceAck);
      const message =
        data && typeof data === 'object' && 'error' in data
          ? String((data as {error: string}).error)
          : `Tải video thất bại (HTTP ${xhr.status}).`;
      const failure = new Error(message) as Error & {received?: number};
      if (data && typeof data === 'object' && 'received' in data) {
        failure.received = Number((data as {received: unknown}).received);
      }
      reject(failure);
    };
    xhr.send(blob);
  });

/**
 * Uploads the raw file in 5 MB slices: a lost connection costs one slice
 * instead of the whole upload (the browser resumes from the last byte the
 * server confirmed).
 */
export const uploadVideo = async (
  file: File,
  onPercent: (pct: number) => void,
): Promise<VideoMeta> => {
  const total = file.size;
  if (!total) throw new Error('Tệp video rỗng.');

  let id = '';
  let offset = 0;
  let attempt = 0;
  let done: SliceAck | null = null;

  while (offset < total) {
    const end = Math.min(offset + SLICE_BYTES, total);
    const query = new URLSearchParams({
      name: file.name,
      offset: String(offset),
      total: String(total),
      slice: String(SLICE_BYTES),
      ...(id ? {id} : {}),
    });
    try {
      const ack = await sendSlice(
        `/api/uploads?${query.toString()}`,
        file.slice(offset, end),
        (loaded) =>
          onPercent(Math.round(((offset + Math.min(loaded, end - offset)) / total) * 100)),
      );
      if (ack.id) id = ack.id;
      const received = typeof ack.received === 'number' ? ack.received : end;
      if (received <= offset) throw new Error('Máy chủ không nhận thêm được dữ liệu.');
      offset = received;
      attempt = 0;
      done = ack;
    } catch (err) {
      const failure = err as Error & {received?: number};
      if (typeof failure.received === 'number' && failure.received < offset) {
        // The server lost the tail we thought it had — rewind to what it kept.
        offset = failure.received;
        attempt = 0;
        continue;
      }
      if (attempt++ < SLICE_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        continue;
      }
      throw failure;
    }
  }

  onPercent(100);
  if (!done) throw new Error('Không nhận được thông tin video từ máy chủ.');
  return {...done, id: (done as {id?: string}).id ?? '', size: total} as VideoMeta;
};

const FONT_FORMAT: Record<string, string> = {ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2'};

export const fontFileUrl = (file: string) => `/api/fonts/${encodeURIComponent(file)}`;

/** Injects @font-face rules so uploaded fonts render in the previews. */
export const applyFontFaces = (fonts: FontEntry[]) => {
  const css = fonts
    .map((font) => {
      const format = FONT_FORMAT[font.ext.replace('.', '')] ?? 'truetype';
      const family = font.family.replace(/["\\]/g, '');
      return `@font-face{font-family:"${family}";src:url("${fontFileUrl(font.file)}") format("${format}");font-display:swap;}`;
    })
    .join('\n');
  let tag = document.getElementById('custom-font-faces') as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement('style');
    tag.id = 'custom-font-faces';
    document.head.appendChild(tag);
  }
  tag.textContent = css;
};

export const listFonts = async (): Promise<FontEntry[]> => {
  const res = await fetch('/api/fonts');
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as {fonts: FontEntry[]};
  return Array.isArray(data.fonts) ? data.fonts : [];
};

/** Uploads a raw font file (ttf/otf/woff/woff2) and returns its entry. */
export const uploadFont = (file: File): Promise<FontEntry> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/fonts?name=${encodeURIComponent(file.name)}`);
    xhr.responseType = 'text';
    xhr.onerror = () => reject(new Error('Không tải được phóm chữ lên máy chủ.'));
    xhr.onabort = () => reject(new Error('Đã hủy tải phóm chữ.'));
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* fall through */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) return resolve(data as FontEntry);
      const message =
        data && typeof data === 'object' && 'error' in data
          ? String((data as {error: string}).error)
          : `Tải phóm chữ thất bại (HTTP ${xhr.status}).`;
      reject(new Error(message));
    };
    xhr.send(file);
  });

export const deleteFont = async (id: string) => {
  const res = await fetch(`/api/fonts/${encodeURIComponent(id)}`, {method: 'DELETE'});
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ok: boolean; message: string}>;
};

export const fetchSrt = async (videoId: string) => {
  const res = await fetch(`/api/videos/${videoId}/srt`);
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as {srt: string};
  return data.srt;
};

/** Per-step terminal trails persisted on disk (upload/transcribe/render/save/...). */
export const fetchLogs = async (videoId: string): Promise<Record<string, string[]>> => {
  const res = await fetch(`/api/videos/${videoId}/logs`);
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as {logs?: Record<string, string>};
  const out: Record<string, string[]> = {};
  for (const [step, text] of Object.entries(data.logs ?? {})) {
    out[step] = String(text).split(/\r?\n/).filter(Boolean);
  }
  return out;
};

export const saveSrt = async (videoId: string, content: string) => {
  const res = await fetch(`/api/videos/${videoId}/srt`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({content}),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ok: boolean; message: string}>;
};

/** Everything a reload needs to rebuild the workflow (meta + SRT + choices). */
export type VideoState = {
  meta: VideoMeta;
  session: {sourceLang?: string; targetLang?: string; look?: unknown};
  srt: string;
  hasOutput: boolean;
};

export const fetchState = async (videoId: string): Promise<VideoState> => {
  const res = await fetch(`/api/videos/${videoId}/state`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<VideoState>;
};

/** Persists the choices (languages, look) so a reload can restore them. */
export const saveSession = async (videoId: string, patch: Record<string, unknown>) => {
  const res = await fetch(`/api/videos/${videoId}/session`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ok: boolean}>;
};

export const createJob = async (
  videoId: string,
  kind: 'transcribe' | 'render',
  body: Record<string, unknown>,
) => {
  const res = await fetch(`/api/videos/${videoId}/jobs/${kind}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as {jobId: string};
  return data.jobId;
};

/** Subscribes to a job's SSE stream; returns a cleanup function. */
export const watchJob = (jobId: string, handlers: JobHandlers) => {
  const source = new EventSource(`/api/jobs/${jobId}/events`);

  source.addEventListener('progress', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as Partial<JobState>;
      handlers.onProgress({
        phase: data.phase ?? 'run',
        percent: data.percent ?? 0,
        message: data.message ?? '',
      });
    } catch {
      /* ignore malformed frames */
    }
  });
  source.addEventListener('log', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as {lines?: string[]};
      if (Array.isArray(data.lines) && data.lines.length) handlers.onLog?.(data.lines);
    } catch {
      /* ignore malformed frames */
    }
  });
  source.addEventListener('done', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as {result: Record<string, unknown>};
      handlers.onDone(data.result ?? {});
    } catch {
      handlers.onDone({});
    }
    source.close();
  });
  source.addEventListener('error', (event) => {
    const data = (event as MessageEvent).data;
    let message = 'Tiến trình bị gián đoạn.';
    if (data) {
      try {
        message = (JSON.parse(data) as {message: string}).message ?? message;
      } catch {
        /* keep default */
      }
    }
    handlers.onError(message);
    source.close();
  });

  return () => source.close();
};
