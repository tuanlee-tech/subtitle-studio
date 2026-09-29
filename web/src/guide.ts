import {driver, type DriveStep, type Driver, type Popover} from 'driver.js';
import 'driver.js/dist/driver.css';
import {getState} from './store';
import type {StepId, WorkflowState} from './types';

const SEEN_KEY = 'subtitle-studio:guide-seen';

const sel = (name: string) => `[data-guide="${name}"]`;

type GuideCopy = {
  name: string;
  title: string;
  description: string;
  side?: Popover['side'];
  align?: Popover['align'];
};

/** Extra highlights shown for the step the user is currently on. */
const STEP_HIGHLIGHTS: Record<StepId, GuideCopy[]> = {
  upload: [
    {
      name: 'dropzone',
      title: 'Kéo thả video vào đây',
      description: 'Kéo file video vào khung này, hoặc bấm "Chọn video" (MP4, MOV, MKV, WEBM, M4V).',
    },
  ],
  language: [
    {
      name: 'lang-source',
      title: 'Ngôn ngữ video gốc',
      description: 'Chọn ngôn ngữ đang nói trong video, hoặc để "Tự động nhận diện".',
      side: 'right',
    },
    {
      name: 'lang-target',
      title: 'Ngôn ngữ phụ đề',
      description: 'Chọn ngôn ngữ của file phụ đề đầu ra, ví dụ Tiếng Việt.',
      side: 'left',
    },
  ],
  transcribe: [
    {
      name: 'progress',
      title: 'Tiến trình tạo SRT',
      description:
        'Nhận diện chạy theo từng giai đoạn: chuẩn bị, nhận diện giọng nói, canh thời gian, tạo file SRT.',
    },
  ],
  review: [
    {
      name: 'srt-editor',
      title: 'Trình sửa phụ đề',
      description:
        'Chỉnh sửa trực tiếp nội dung và mốc thời gian. Lỗi cú pháp SRT được báo ngay bên dưới khung.',
    },
  ],
  save: [
    {
      name: 'save-summary',
      title: 'Thông tin file SRT',
      description: 'Tên file, số phụ đề và trạng thái lưu. Bấm "Tiếp tục" để lưu lên máy chủ.',
    },
  ],
  style: [
    {
      name: 'style-cards',
      title: 'Mẫu có sẵn',
      description: 'Chọn nhanh một trong 3 kiểu chữ phổ biến nếu bạn không muốn tinh chỉnh.',
    },
    {
      name: 'look-editor',
      title: 'Tùy chỉnh màu & phóm chữ',
      description:
        'Đổi màu chữ, phóm chữ và hiệu ứng — khung xem trước cập nhật ngay lập tức.',
    },
    {
      name: 'font-upload',
      title: 'Tải phóm chữ của riêng bạn',
      description:
        'Chọn file .ttf, .otf hoặc .woff2 từ máy tính. Bấm tên phóm chữ để áp dụng, dấu X để xóa.',
      side: 'top',
    },
  ],
  render: [
    {
      name: 'render-summary',
      title: 'Thông tin trước khi render',
      description: 'Tóm tắt video, file phụ đề và kiểu chữ sắp được chèn vào video.',
    },
    {
      name: 'result-video',
      title: 'Xem trước kết quả',
      description: 'Video hoàn thành — phát thử ngay tại đây, hoặc bấm "Tải video" phía trên.',
    },
  ],
};

/** Returns a highlight only when the element exists in the current step. */
const at = (
  name: string,
  title: string,
  description: string,
  side?: Popover['side'],
  align?: Popover['align'],
): DriveStep | null =>
  document.querySelector(sel(name))
    ? {element: sel(name), popover: {title, description, side, align}}
    : null;

const buildSteps = (state: WorkflowState): DriveStep[] => {
  const steps: Array<DriveStep | null> = [
    at(
      'brand',
      'Chào mừng đến với Subtitle Studio',
      'Tạo phụ đề cho video chỉ với 7 bước: tải video → ngôn ngữ → tạo SRT → chỉnh sửa → lưu → tạo kiểu chữ → render.',
      'bottom',
      'start',
    ),
    at(
      'sidebar',
      'Quy trình 7 bước',
      'Mỗi bước có trạng thái riêng: dấu tích xanh là hoàn thành, vòng quay là đang xử lý. Bấm vào các bước đã hoàn thành để quay lại.',
      'right',
      'start',
    ),
    at(
      'panel-title',
      'Bước hiện tại',
      'Tiêu đề và mô tả của bước bạn đang đứng. Nút "Quay lại" ở bên phải để sửa bước trước.',
      'bottom',
      'start',
    ),
    ...STEP_HIGHLIGHTS[state.step].map((h) => at(h.name, h.title, h.description, h.side, h.align)),
    at(
      'primary',
      'Nút tiếp tục',
      'Bấm nút chính này để sang bước kế tiếp. Một số bước có thêm nút phụ như "Thử lại" hay "Tải video".',
      'bottom',
      'end',
    ),
    at(
      'guide-help',
      'Cần xem lại?',
      'Bấm "Hướng dẫn" ở thanh trên cùng bất cứ lúc nào để chạy lại tour này.',
      'bottom',
      'end',
    ),
  ];

  return steps.filter((step): step is DriveStep => step !== null);
};

let tour: Driver | null = null;

/** Runs the guided tour over whatever is on screen right now. */
export const startGuide = () => {
  if (typeof document === 'undefined') return;
  if (tour?.isActive()) return;

  const steps = buildSteps(getState());
  if (!steps.length) return;

  tour?.destroy();
  tour = driver({
    steps,
    showProgress: true,
    progressText: 'Bước {{current}} / {{total}}',
    nextBtnText: 'Tiếp',
    prevBtnText: 'Quay lại',
    doneBtnText: 'Hoàn tất',
    animate: true,
    smoothScroll: true,
    allowClose: true,
    overlayClickBehavior: 'close',
    overlayColor: 'rgba(15, 23, 42, 0.72)',
    stagePadding: 8,
    stageRadius: 12,
    skipMissingElement: true,
    disableActiveInteraction: false,
    popoverClass: 'guide-popover',
    onPopoverRender: (popover) => {
      popover.closeButton.setAttribute('title', 'Đóng');
      popover.closeButton.setAttribute('aria-label', 'Đóng');
    },
    onDestroyed: () => {
      try {
        localStorage.setItem(SEEN_KEY, '1');
      } catch {
        /* private mode — just skip remembering */
      }
      if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__guide = undefined;
    },
  });

  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__guide = tour;
  tour.drive(0);
};

export const hasSeenGuide = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
};

/** Clears the "already seen" flag (used when the user wants a fresh tour). */
export const resetGuideSeen = () => {
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    /* ignore */
  }
};
