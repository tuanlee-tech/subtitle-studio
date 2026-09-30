import {CheckCircle, FloppyDisk, Info} from '@phosphor-icons/react';
import {StepPanel} from '../components/StepPanel';
import {continueFromSave, openStep} from '../actions';
import {useWorkflow} from '../store';
import {formatBytes} from '../utils';

export const StepSave = () => {
  const state = useWorkflow();
  const saving = state.job.status === 'running' && state.job.phase === 'save';
  const ready = state.srtSaved && !state.srtDirty;
  const size = new Blob([state.srt]).size;
  const fileName = `${(state.video?.name ?? 'video').replace(/\.[^.]+$/, '')}.srt`;

  return (
    <StepPanel
      step="save"
      icon={<FloppyDisk size={22} weight="bold" />}
      title="Lưu SRT"
      desc="Lưu file phụ đề đã chỉnh sửa để sử dụng cho bước render video"
      onBack={() => openStep('review')}
      primary={{
        label: ready ? 'Tiếp tục' : 'Lưu SRT',
        onClick: () => void continueFromSave(),
        loading: saving,
      }}
    >
      <div className="card card--soft" data-guide="save-summary">
        <div className="info-grid">
          <div className="info-item">
            <div className="info-item__label">Tên file</div>
            <div className="info-item__value">{fileName}</div>
          </div>
          <div className="info-item">
            <div className="info-item__label">Số phụ đề</div>
            <div className="info-item__value">{state.cueCount}</div>
          </div>
          <div className="info-item">
            <div className="info-item__label">Dung lượng</div>
            <div className="info-item__value">{formatBytes(size)}</div>
          </div>
          <div className="info-item">
            <div className="info-item__label">Trạng thái</div>
            <div className="info-item__value">
              {ready ? (
                <span className="pill pill--green">
                  <CheckCircle size={14} weight="fill" /> Đã lưu
                </span>
              ) : (
                <span className="pill pill--red">Chưa lưu</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {state.job.status === 'error' && state.job.error && (
        <div className="callout callout--error">
          <span className="callout__icon">
            <Info size={17} weight="fill" />
          </span>
          <div>{state.job.error}</div>
        </div>
      )}

      <div className="callout callout--info">
        <span className="callout__icon">
          <Info size={17} weight="fill" />
        </span>
        <div>
          File SRT được lưu trên máy chủ kèm theo timing từng từ, nhờ vậy phụ đề vẫn hiện ra đúng theo lời
          nói sau khi bạn chỉnh sửa.
        </div>
      </div>
    </StepPanel>
  );
};
