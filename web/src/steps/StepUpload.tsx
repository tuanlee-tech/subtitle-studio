import {useRef, useState} from 'react';
import {Info, UploadSimple} from '@phosphor-icons/react';
import {StepPanel} from '../components/StepPanel';
import {ProgressBar} from '../components/Progress';
import {upload} from '../actions';
import {useWorkflow} from '../store';

const ACCEPT = '.mp4,.mov,.mkv,.webm,.m4v,video/*';

export const StepUpload = () => {
  const state = useWorkflow();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const pick = (file?: File | null) => {
    if (file) void upload(file);
  };

  return (
    <StepPanel
      icon={<UploadSimple size={22} weight="bold" />}
      title="Tải video lên"
      desc="Chọn video bạn muốn tạo phụ đề — tệp sẽ được xử lý hoàn toàn trên máy của bạn"
    >
      <div
        className={`dropzone ${over ? 'dropzone--over' : ''}`}
        data-guide="dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files?.[0]);
        }}
      >
        <div className="dropzone__icon">
          <UploadSimple size={26} weight="bold" />
        </div>
        <div className="dropzone__title">
          {state.uploading ? 'Đang tải video lên...' : 'Kéo thả video vào đây'}
        </div>
        <div className="dropzone__hint">hoặc chọn tệp từ máy tính · MP4, MOV, MKV, WEBM, M4V</div>
        <div className="dropzone__btn">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => inputRef.current?.click()}
            disabled={state.uploading}
          >
            Chọn video
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {state.uploading && (
        <div className="progress">
          <div className="progress__meta">
            <strong>Đang tải lên...</strong>
            <span>{state.uploadPercent}%</span>
          </div>
          <ProgressBar percent={state.uploadPercent} />
        </div>
      )}

      {state.error && (
        <div className="callout callout--error">
          <span className="callout__icon">
            <Info size={17} />
          </span>
          <div>{state.error}</div>
        </div>
      )}

      <div className="callout callout--muted">
        <span className="callout__icon">
          <Info size={17} />
        </span>
        <div>
          <strong>Lưu ý:</strong>
          <ul>
            <li>Video cần có âm thano lời nói để nhận diện phụ đề.</li>
            <li>Thời lượng video ngắn sẽ xử lý nhanh hơn (khuyên dùng dưới 10 phút).</li>
          </ul>
        </div>
      </div>
    </StepPanel>
  );
};
