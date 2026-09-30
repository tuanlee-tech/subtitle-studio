import {FileText, Info, CheckCircle, XCircle} from '@phosphor-icons/react';
import {StepPanel} from '../components/StepPanel';
import {confirmReview, openStep, reloadSrt, updateSrt} from '../actions';
import {useWorkflow} from '../store';

export const StepReview = () => {
  const state = useWorkflow();
  const lineCount = state.srt ? state.srt.split(/\r?\n/).length : 0;
  const charCount = state.srt.length;

  return (
    <StepPanel
      step="review"
      icon={<FileText size={22} weight="bold" />}
      title="Xem lại / Chỉnh sửa SRT"
      desc="Kiểm tra nội dung và thời gian từng phụ đề, sửa trực tiếp trong khung bên dưới"
      onBack={() => openStep('transcribe')}
      primary={{label: 'Tiếp tục', onClick: confirmReview, disabled: !state.srtValid}}
      secondary={{label: 'Tải lại bản gốc', onClick: () => void reloadSrt()}}
    >
      <div className="srt-toolbar">
        <div className="srt-stats">
          <span>
            Số phụ đề: <strong>{state.srtValid ? state.cueCount : '—'}</strong>
          </span>
          <span>
            Số dòng: <strong>{lineCount}</strong>
          </span>
          <span>
            Ký tự: <strong>{charCount}</strong>
          </span>
        </div>
        <span className={`pill ${state.srtValid ? 'pill--green' : 'pill--red'}`}>
          {state.srtValid ? <CheckCircle size={14} weight="fill" /> : <XCircle size={14} weight="fill" />}
          {state.srtValid ? 'Hợp lệ' : `${state.srtErrors.length} lỗi`}
        </span>
      </div>

      <textarea
        className="textarea"
        data-guide="srt-editor"
        value={state.srt}
        spellCheck={false}
        onChange={(e) => updateSrt(e.target.value)}
        aria-label="Nội dung file SRT"
      />

      {state.srtErrors.length > 0 && (
        <ul className="error-list">
          {state.srtErrors.slice(0, 8).map((err, i) => (
            <li key={i}>
              <XCircle size={15} weight="fill" style={{flex: 'none', marginTop: 2}} />
              <span>{err.message}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="callout callout--info">
        <span className="callout__icon">
          <Info size={17} weight="fill" />
        </span>
        <div>
          <strong>Cách chỉnh sửa:</strong>
          <ul>
            <li>Mỗi khối gồm: số thứ tự, dòng thời gian, dòng nội dung.</li>
            <li>Thời gian dạng <code>00:00:01,200 → 00:00:03,400</code> (giờ:phút:giây,ms).</li>
            <li>Phụ đề phải hợp lệ trước khi bạn tiếp tục sang bước lưu.</li>
          </ul>
        </div>
      </div>
    </StepPanel>
  );
};
