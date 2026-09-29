import type {FontEntry, JobState, VideoMeta} from './types';

export type JobHandlers = {
  onProgress: (p: {phase: string; percent: number; message: string}) => void;
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

/** Uploads the raw file with progress (XHR, because fetch has no upload progress). */
export const uploadVideo = (file: File, onPercent: (pct: number) => void) =>
  new Promise<VideoMeta>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/uploads?name=${encodeURIComponent(file.name)}`);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPercent(Math.round((e.loaded / e.total) * 100));
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
      if (xhr.status >= 200 && xhr.status < 300 && data) return resolve(data as VideoMeta);
      const message =
        data && typeof data === 'object' && 'error' in data
          ? String((data as {error: string}).error)
          : `Tải video thất bại (HTTP ${xhr.status}).`;
      reject(new Error(message));
    };
    xhr.send(file);
  });

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

export const saveSrt = async (videoId: string, content: string) => {
  const res = await fetch(`/api/videos/${videoId}/srt`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({content}),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ok: boolean; message: string}>;
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
