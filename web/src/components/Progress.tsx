export const ProgressBar = ({percent, done}: {percent: number; done?: boolean}) => (
  <div className="progress">
    <div className="progress__track">
      <div
        className={`progress__fill ${done ? 'progress__fill--done' : ''}`}
        style={{width: `${Math.max(2, Math.min(100, percent))}%`}}
      />
    </div>
  </div>
);

export const ProgressPanel = ({
  percent,
  message,
  running,
  error,
  done,
}: {
  percent: number;
  message: string;
  running?: boolean;
  error?: string | null;
  done?: boolean;
}) => (
  <div className="card" data-guide="progress">
    <div className="progress__meta">
      <strong>{error ? 'Có lỗi xảy ra' : done ? 'Hoàn thành' : message || 'Đang xử lý...'}</strong>
      <span>{error ? '—' : `${Math.round(percent)}%`}</span>
    </div>
    <div className="progress__track">
      <div
        className={`progress__fill ${error ? '' : done || !running ? 'progress__fill--done' : ''}`}
        style={{width: `${error ? 100 : Math.max(2, Math.min(100, percent))}%`, background: error ? 'var(--red)' : undefined}}
      />
    </div>
    {error && (
      <div className="callout callout--error" style={{marginTop: 16}}>
        <span className="callout__icon">
          <span aria-hidden>✕</span>
        </span>
        <div>{error}</div>
      </div>
    )}
  </div>
);
