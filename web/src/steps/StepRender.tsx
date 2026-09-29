import {ArrowsClockwise, CheckCircle, Download, FilmSlate, Info, Play} from '@phosphor-icons/react';
import {StepPanel} from '../components/StepPanel';
import {ProgressPanel} from '../components/Progress';
import {openStep, startRender} from '../actions';
import {useWorkflow} from '../store';
import {formatDuration, formatResolution} from '../utils';
import {lookSummary} from '@lib/look.mjs';

export const StepRender = () => {
  const state = useWorkflow();
  const running = state.job.status === 'running';
  const failed = state.job.status === 'error' || state.statuses.render === 'error';
  const done = Boolean(state.outputUrl);
  const downloadUrl = state.video ? `/api/videos/${state.video.id}/output?download=1` : '#';

  if (done) {
    return (
      <StepPanel
        icon={<CheckCircle size={22} weight="bold" />}
        title="Video đã hoàn thành"
        desc="Phụ đề đã được chèn vào video — xem trước và tải về máy"
        onBack={() => openStep('style')}
        primary={{label: 'Tải video', onClick: () => window.open(downloadUrl, '_blank')}}
        secondary={{label: 'Render lại', onClick: () => void startRender()}}
      >
        <video
          className="result-video"
          data-guide="result-video"
          src={state.outputUrl ?? ''}
          controls
          autoPlay={false}
        />
        <div className="result-actions">
          <a className="btn btn--primary" href={downloadUrl} download="video_subbed.mp4">
            <Download size={16} />
            Tải video phụ đề
          </a>
          <button type="button" className="btn btn--secondary" onClick={() => void startRender()}>
            <ArrowsClockwise size={16} />
            Render lại
          </button>
        </div>
        <div className="callout callout--success">
          <span className="callout__icon">
            <CheckCircle size={17} weight="fill" />
          </span>
          <div>
            <strong>Hoàn thành.</strong>
            File <code>video_subbed.mp4</code> đã sẵn sàng ({formatDuration(state.video?.durationSec ?? 0)}).
          </div>
        </div>
      </StepPanel>
    );
  }

  return (
    <StepPanel
      icon={<FilmSlate size={22} weight="bold" />}
      title="Tạo phụ đề cho video"
      desc="Chèn phụ đề vào video theo kiểu bạn đã chọn và tạo bản dựng cuối cùng"
      onBack={() => openStep('style')}
      primary={{
        label: failed ? 'Thử lại' : 'Tạo phụ đề cho video',
        onClick: () => void startRender(),
        loading: running,
      }}
    >
      <ProgressPanel
        percent={state.job.percent}
        message={state.job.message}
        running={running}
        error={failed ? state.job.error : null}
        done={false}
      />

      <div className="card card--soft panel__section" data-guide="render-summary">
        <div className="info-grid">
          <div className="info-item">
            <div className="info-item__label">Video</div>
            <div className="info-item__value">{state.video?.name ?? '—'}</div>
          </div>
          <div className="info-item">
            <div className="info-item__label">File phụ đề</div>
            <div className="info-item__value">
              {(state.video?.name ?? 'video').replace(/\.[^.]+$/, '')}.srt · {state.cueCount} phụ đề
            </div>
          </div>
          <div className="info-item">
            <div className="info-item__label">Kiểu phụ đề</div>
            <div className="info-item__value">{lookSummary(state.look)}</div>
          </div>
          <div className="info-item">
            <div className="info-item__label">Đầu ra</div>
            <div className="info-item__value">
              {state.video ? formatResolution(state.video.width, state.video.height) : '—'} ·{' '}
              {formatDuration(state.video?.durationSec ?? 0)}
            </div>
          </div>
        </div>
      </div>

      <div className="callout callout--info">
        <span className="callout__icon">
          <Info size={17} weight="fill" />
        </span>
        <div>
          <strong>Lưu ý:</strong>
          <ul>
            <li>Quy trình render mất vài phút tùy độ dài video.</li>
            <li>Bạn vẫn có thể quay lại chỉnh sửa SRT trước khi render.</li>
            <li>
              Nhấn <Play size={13} weight="fill" /> trong khung xem trước để kiểm tra kết quả.
            </li>
          </ul>
        </div>
      </div>
    </StepPanel>
  );
};
