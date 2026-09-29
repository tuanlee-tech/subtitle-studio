import {CheckCircle, Gear, Info} from '@phosphor-icons/react';
import {StepPanel} from '../components/StepPanel';
import {ProgressPanel} from '../components/Progress';
import {openStep, startTranscribe} from '../actions';
import {useWorkflow} from '../store';
import {languageLabel} from '../utils';

export const StepTranscribe = () => {
  const state = useWorkflow();
  const running = state.job.status === 'running';
  const failed = state.job.status === 'error' || state.statuses.transcribe === 'error';
  const done = state.statuses.transcribe === 'completed';

  return (
    <StepPanel
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
