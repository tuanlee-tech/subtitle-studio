import {useRef, useState} from 'react';
import type {ChangeEvent} from 'react';
import {CheckCircle, FileArrowUp, Gear, Info, UploadSimple} from '@phosphor-icons/react';
import {StepPanel} from '../components/StepPanel';
import {ProgressPanel} from '../components/Progress';
import {importSrtFile, openStep, startTranscribe} from '../actions';
import {useWorkflow} from '../store';
import {languageLabel} from '../utils';

export const StepTranscribe = () => {
  const state = useWorkflow();
  const running = state.job.status === 'running';
  const failed = state.job.status === 'error' || state.statuses.transcribe === 'error';
  const done = state.statuses.transcribe === 'completed';
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      await importSrtFile(file);
    } finally {
      setImporting(false);
    }
  };

  return (
    <StepPanel
      step="transcribe"
      icon={<Gear size={22} weight="bold" />}
      title="Tạo SRT"
      desc="Nhận diện lời nói và tạo file phụ đề SRT cho video của bạn"
      onBack={() => openStep('language')}
      primary={
        done
          ? {label: 'Xem lại SRT', onClick: () => openStep('review')}
          : {label: failed ? 'Thử lại' : 'Tạo SRT', onClick: () => void startTranscribe(), loading: running}
      }
    >
      <ProgressPanel
        percent={state.job.percent}
        message={state.job.message}
        running={running}
        error={failed ? state.job.error : null}
        done={done}
      />

      <div className="callout callout--info">
        <span className="callout__icon">
          <Info size={17} weight="fill" />
        </span>
        <div>
          <strong>Đang xử lý:</strong>
          <ul>
            <li>Ngôn ngữ video gốc: {languageLabel(state.sourceLang)}</li>
            <li>Ngôn ngữ đầu ra: {languageLabel(state.targetLang)}</li>
            <li>Video đầu vào: {state.video?.name ?? '—'}</li>
          </ul>
        </div>
      </div>

      {!done && (
        <div className="card" style={{marginTop: 16}}>
          <div className="card__head">
            <div className="card__icon">
              <FileArrowUp size={18} weight="bold" />
            </div>
            <div>
              <h3 className="card__title">Đã có file SRT từ phiên trước?</h3>
              <p className="card__desc">
                Phiên làm việc trước bị ngắt sau khi tạo xong SRT? Tải file .srt lên để tiếp tục ngay, không cần chờ
                hệ thống nhận diện lại từ đầu.
              </p>
            </div>
          </div>
          <input ref={fileRef} type="file" accept=".srt,text/plain" hidden onChange={onPick} />
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => fileRef.current?.click()}
            disabled={running || importing}
          >
            <UploadSimple size={16} />
            {importing ? 'Đang kiểm tra file...' : 'Chọn file .srt'}
          </button>
        </div>
      )}

      {done && (
        <div className="callout callout--success">
          <span className="callout__icon">
            <CheckCircle size={17} weight="fill" />
          </span>
          <div>
            <strong>Đã tạo xong {state.cueCount} phụ đề.</strong>
            Bây giờ bạn có thể xem lại và chỉnh sửa nội dung SRT.
          </div>
        </div>
      )}
    </StepPanel>
  );
};
