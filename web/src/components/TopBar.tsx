import {Compass, Play, PlusCircle} from '@phosphor-icons/react';
import {startGuide} from '../guide';
import {resetAll} from '../actions';

export const TopBar = () => (
  <header className="topbar">
    <div className="topbar__brand" data-guide="brand">
      <div className="brand-icon">
        <Play size={20} weight="fill" />
      </div>
      <div>
        <div className="brand-title">Subtitle Studio</div>
        <div className="brand-sub">Tạo phụ đề video nhanh chóng, chính xác</div>
      </div>
    </div>
    <div className="topbar__actions">
      <button type="button" className="topbar__new" onClick={resetAll}>
        <PlusCircle size={17} weight="bold" />
        Video mới
      </button>
      <button type="button" className="topbar__help" data-guide="guide-help" onClick={startGuide}>
        <Compass size={17} weight="bold" />
        Hướng dẫn
      </button>

      <div className="user">
        <span className="avatar">LT</span>
        <span>Lê Tuân</span>
      </div>
    </div>
  </header>
);
