import {StepStatusMark} from './StepStatusMark';
import {openStep} from '../actions';
import {useWorkflow} from '../store';
import type {StepId, StepStatus, WorkflowState} from '../types';
import {formatBytes} from '../utils';
import {lookSummary} from '@lib/look.mjs';

type StepMeta = {
  id: StepId;
  title: string;
  summary: (s: WorkflowState) => {text: string; tone?: 'ok' | 'err'};
};

const STEPS: StepMeta[] = [
  {
    id: 'upload',
    title: 'Tải video',
    summary: (s) =>
      s.video ? {text: `${s.video.name} (${formatBytes(s.video.size)})`, tone: 'ok'} : {text: 'Chưa có video'},
  },
  {
    id: 'language',
    title: 'Cấu hình ngôn ngữ',
    summary: (s) => (s.languageCommitted ? {text: 'Đã chọn ngôn ngữ', tone: 'ok'} : {text: 'Chưa chọn'}),
  },
  {
    id: 'transcribe',
    title: 'Tạo SRT',
    summary: (s) => {
      if (s.statuses.transcribe === 'processing') return {text: 'Đang xử lý...'};
      if (s.statuses.transcribe === 'error') return {text: s.job.error ?? 'Thất bại', tone: 'err'};
      if (s.statuses.transcribe === 'completed') return {text: `${s.cueCount} phụ đề`, tone: 'ok'};
      return {text: 'Chưa xử lý'};
    },
  },
  {
    id: 'review',
    title: 'Xem lại / Chỉnh sửa SRT',
    summary: (s) => (s.srt ? {text: 'Đã có nội dung SRT', tone: 'ok'} : {text: 'Chưa thực hiện'}),
  },
  {
    id: 'save',
    title: 'Lưu SRT',
    summary: (s) => (s.srtSaved ? {text: 'Đã lưu file SRT', tone: 'ok'} : {text: 'Chưa thực hiện'}),
  },
  {
    id: 'style',
    title: 'Chọn kiểu phụ đề',
    summary: (s) =>
      s.statuses.style === 'completed' ? {text: lookSummary(s.look), tone: 'ok'} : {text: 'Chưa thực hiện'},
  },
  {
    id: 'render',
    title: 'Tạo phụ đề cho video',
    summary: (s) => {
      if (s.statuses.render === 'processing') return {text: 'Đang render...'};
      if (s.statuses.render === 'error') return {text: s.job.error ?? 'Thất bại', tone: 'err'};
      if (s.outputUrl) return {text: 'Hoàn thành', tone: 'ok'};
      return {text: 'Chưa thực hiện'};
    },
  },
];

const nextStatus = (statuses: Record<StepId, StepStatus>, index: number) =>
  index < STEPS.length - 1 ? statuses[STEPS[index + 1].id] : null;

export const WorkflowSidebar = () => {
  const state = useWorkflow();

  return (
    <aside className="sidebar" data-guide="sidebar">
      <div className="sidebar__title">Tạo phụ đề video</div>
      <div className="steps">
        {STEPS.map((step, i) => {
          const status = state.statuses[step.id];
          const summary = step.summary(state);
          const isActive = state.step === step.id;
          const connectorDone =
            status === 'completed' && nextStatus(state.statuses, i) !== 'pending';
          return (
            <button
              key={step.id}
              type="button"
              className={`step ${isActive ? 'step--active' : ''} ${status === 'completed' ? 'step--completed' : ''} ${
                status === 'processing' ? 'step--processing' : ''
              } ${status === 'error' ? 'step--error' : ''}`}
              disabled={status === 'processing'}
              onClick={() => openStep(step.id)}
            >
              <div className="step__rail">
                <StepStatusMark status={status} index={i} />
                {i < STEPS.length - 1 && (
                  <span className={`step__connector ${connectorDone ? 'step__connector--done' : ''}`} />
                )}
              </div>
              <div className="step__body">
                <div className="step__title">
                  {i + 1}. {step.title}
                </div>
                <div
                  className={`step__sub ${summary.tone === 'ok' ? 'step__sub--ok' : ''} ${
                    summary.tone === 'err' ? 'step__sub--err' : ''
                  }`}
                >
                  {summary.text}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
};
