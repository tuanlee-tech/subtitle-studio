import {useEffect, useRef, useState} from 'react';
import {CheckSquare, Copy, Trash, TerminalWindow} from '@phosphor-icons/react';
import {fetchLogs} from '../api';
import {setLogs, getState, useWorkflow} from '../store';
import type {StepId} from '../types';

const ERR_RE = /^\d{2}:\d{2}:\d{2}\s*✕/;

/** Video/step pairs already hydrated from disk — the server trail must not clobber live lines. */
const seeded = new Set<string>();

type Props = {
  step: StepId;
  /** Open the panel right away (used when the step failed, so the cause is visible). */
  autoOpen?: boolean;
};

/**
 * The `<details>` terminal every step carries: shows which options were chosen
 * (models, python, languages, look) and the raw error trail when a step fails.
 */
export const Terminal = ({step, autoOpen}: Props) => {
  const state = useWorkflow();
  const lines = state.logs[step] ?? [];
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const videoId = state.video?.id ?? null;
  const key = videoId ? `${videoId}:${step}` : '';

  // Hydrate from the persisted trail once per video/step (never over live job lines).
  useEffect(() => {
    if (!videoId || seeded.has(key) || state.job.status === 'running') return;
    seeded.add(key);
    fetchLogs(videoId)
      .then((all) => {
        const current = (getState().logs[step] ?? []).length;
        const fresh = all[step];
        if (!current && fresh?.length) setLogs(step, fresh);
      })
      .catch(() => {
        /* a missing trail is not an error */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, videoId]);

  // A failed step opens itself so the user reads the cause without hunting for it.
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [open, lines]);

  const errorCount = lines.filter((l) => ERR_RE.test(l)).length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — nothing to report */
    }
  };

  return (
    <details className="term" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="term__summary">
        <TerminalWindow size={15} weight="bold" />
        <span>Terminal</span>
        <span className="term__count">{lines.length} dòng</span>
        {errorCount > 0 && <span className="term__errors">✕ {errorCount} lỗi</span>}
        {!state.video && <span className="term__hint">chưa có video</span>}
      </summary>
      <div className="term__bar">
        <button type="button" className="btn btn--ghost btn--tiny" onClick={copy} disabled={!lines.length}>
          {copied ? <CheckSquare size={13} weight="bold" /> : <Copy size={13} />}
          {copied ? 'Đã sao chép' : 'Sao chép'}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--tiny"
          onClick={() => setLogs(step, [])}
          disabled={!lines.length}
        >
          <Trash size={13} />
          Xóa
        </button>
      </div>
      <div className="term__body" ref={bodyRef} data-guide="terminal">
        {lines.length ? (
          lines.map((line, i) => (
            <div key={i} className={`term__line${ERR_RE.test(line) ? ' term__line--err' : ''}`}>
              {line}
            </div>
          ))
        ) : (
          <div className="term__line term__line--muted">— chưa có hoạt động nào được ghi ở bước này —</div>
        )}
      </div>
    </details>
  );
};
