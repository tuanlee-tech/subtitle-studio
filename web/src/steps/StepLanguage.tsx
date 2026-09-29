import type {ReactNode} from 'react';
import {Globe, Info, Translate} from '@phosphor-icons/react';
import {StepPanel} from '../components/StepPanel';
import {VideoInfoCard} from '../components/VideoInfoCard';
import {confirmLanguages, openStep} from '../actions';
import {setState, useWorkflow} from '../store';
import {languageFlag, languageLabel} from '../utils';

const SOURCE_LANGS = ['auto', 'vi', 'en', 'ja', 'ko', 'zh', 'fr', 'de', 'es'];
const TARGET_LANGS = ['vi', 'en', 'ja', 'ko', 'zh', 'fr', 'de', 'es'];

const ChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const LanguageSelect = ({
  lead,
  value,
  onChange,
  options,
}: {
  lead: ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) => (
  <div className="field">
    <span className="field__lead">{lead}</span>
    <select className="select has-lead" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((code) => (
        <option key={code} value={code}>
          {code === 'auto' ? languageLabel(code) : `${languageFlag(code)} ${languageLabel(code)}`}
        </option>
      ))}
    </select>
    <span className="field__chevron">
      <ChevronDown />
    </span>
  </div>
);

export const StepLanguage = () => {
  const state = useWorkflow();

  if (!state.video) return null;

  return (
    <StepPanel
      icon={<Translate size={22} weight="bold" />}
      title="Cấu hình ngôn ngữ"
      desc="Chọn ngôn ngữ video gốc và ngôn ngữ đầu ra để tạo phụ đề"
      onBack={() => openStep('upload')}
      primary={{label: 'Tạo SRT', onClick: () => void confirmLanguages()}}
    >
      <div className="grid2">
        <div className="card" data-guide="lang-source">
          <div className="card__head">
            <span className="card__icon">
              <Translate size={18} />
            </span>
            <span className="card__title">Ngôn ngữ video gốc</span>
          </div>
          <p className="card__desc">
            Chọn ngôn ngữ của video. Hệ thống sẽ tự động nhận diện nếu bạn chọn tùy chọn mặc định.
          </p>
          <LanguageSelect
            lead={<Globe size={17} />}
            value={state.sourceLang}
            onChange={(v) => setState({sourceLang: v})}
            options={SOURCE_LANGS}
          />
          <div className="callout callout--info">
            <span className="callout__icon">
              <Info size={17} weight="fill" />
            </span>
            <div>Hệ thống sẽ tự động nhận diện ngôn ngữ trong video của bạn.</div>
          </div>
        </div>

        <div className="card" data-guide="lang-target">
          <div className="card__head">
            <span className="card__icon">
              <Globe size={18} />
            </span>
            <span className="card__title">Ngôn ngữ đầu ra</span>
          </div>
          <p className="card__desc">Chọn ngôn ngữ bạn muốn tạo phụ đề.</p>
          <LanguageSelect
            lead={<Globe size={17} />}
            value={state.targetLang}
            onChange={(v) => setState({targetLang: v})}
            options={TARGET_LANGS}
          />
          <div className="callout callout--success">
            <span className="callout__icon">
              <Info size={17} weight="fill" />
            </span>
            <div>
              <strong>Đã chọn: {languageLabel(state.targetLang)}</strong>
              Phụ đề sẽ được tạo bằng {languageLabel(state.targetLang)}.
            </div>
          </div>
        </div>
      </div>

      <div className="panel__section">
        <VideoInfoCard video={state.video} />
      </div>

      <div className="callout callout--muted">
        <span className="callout__icon">
          <Info size={17} />
        </span>
        <div>
          <strong>Lưu ý:</strong>
          <ul>
            <li>Ngôn ngữ video gốc mặc định là Tự động nhận diện.</li>
            <li>Vui lòng chọn ngôn ngữ đầu ra để tiếp tục.</li>
          </ul>
        </div>
      </div>
    </StepPanel>
  );
};
