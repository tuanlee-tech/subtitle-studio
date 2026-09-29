import {useEffect, useState} from 'react';
import {Check, Info, PaintBrush, Palette, TrashSimple, UploadSimple} from '@phosphor-icons/react';
import {StepPanel} from '../components/StepPanel';
import {chooseLook, confirmStyle, openStep, patchLook} from '../actions';
import {applyFontFaces, deleteFont, listFonts, uploadFont} from '../api';
import {useWorkflow} from '../store';
import type {FontEntry} from '../types';
import {COLORS, EFFECTS, FONTS, PRESETS, presetIdOf, presetLabel, previewStyle, weightForFont} from '@lib/look.mjs';

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');

export const StepStyle = () => {
  const state = useWorkflow();
  const look = state.look;
  const activePreset = presetIdOf(look);

  const [fonts, setFonts] = useState<FontEntry[]>([]);
  const [fontBusy, setFontBusy] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listFonts()
      .then((list) => {
        if (!alive) return;
        setFonts(list);
        applyFontFaces(list);
      })
      .catch((err) => {
        if (alive) setFontError(errorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  const applyFontList = (list: FontEntry[]) => {
    setFonts(list);
    applyFontFaces(list);
  };

  const pickFont = async (file: File | null | undefined) => {
    if (!file) return;
    setFontError(null);
    setFontBusy(true);
    try {
      const entry = await uploadFont(file);
      applyFontList([entry, ...fonts.filter((f) => f.file !== entry.file)]);
      patchLook({font: 'custom', customFont: {family: entry.family, file: entry.file}, fontWeight: 700});
    } catch (err) {
      setFontError(errorMessage(err));
    } finally {
      setFontBusy(false);
    }
  };

  const removeFont = async (entry: FontEntry) => {
    if (!window.confirm(`Xóa phóm chữ "${entry.family}"?`)) return;
    setFontError(null);
    try {
      await deleteFont(entry.id);
      applyFontList(fonts.filter((f) => f.id !== entry.id));
      if (look.font === 'custom' && look.customFont?.file === entry.file) {
        patchLook({font: FONTS[0].id, fontWeight: weightForFont(FONTS[0].id), customFont: undefined});
      }
    } catch (err) {
      setFontError(errorMessage(err));
    }
  };

  const selectFont = (entry: FontEntry) =>
    patchLook({font: 'custom', customFont: {family: entry.family, file: entry.file}, fontWeight: 700});

  return (
    <StepPanel
      icon={<PaintBrush size={22} weight="bold" />}
      title="Chọn kiểu phụ đề"
      desc="Bắt đầu với một mẫu có sẵn, hoặc tự chọn màu chữ và phóm chữ riêng"
      onBack={() => openStep('save')}
      primary={{label: 'Tiếp tục', onClick: confirmStyle}}
    >
      <div className="style-grid" data-guide="style-cards">
        {PRESETS.map((preset) => {
          const selected = activePreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              className={`style-card ${selected ? 'style-card--selected' : ''}`}
              onClick={() => chooseLook({...preset.look})}
            >
              <div className="style-card__preview">
                <span className="sub-preview" style={previewStyle(preset.look)}>
                  Xin chào các bạn!
                </span>
              </div>
              <div className="style-card__label">
                {preset.label}
                {selected && <Check size={16} weight="bold" color="var(--accent)" />}
              </div>
              <div className="style-card__desc">{preset.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="card card--soft panel__section look-editor" data-guide="look-editor">
        <div className="look-editor__head">
          <div>
            <div className="look-editor__title">
              <Palette size={16} weight="bold" />
              Tùy chỉnh màu &amp; phóm chữ
            </div>
            <div className="look-editor__hint">
              Chỉnh thoải mái — khung xem trước bên dưới cập nhật ngay lập tức
            </div>
          </div>
          <span className={`pill ${activePreset === 'custom' ? 'pill--green' : ''}`}>
            {presetLabel(look)}
          </span>
        </div>

        <div className="look-preview">
          <span className="sub-preview" style={previewStyle(look)}>
            Xin chào các bạn! Hôm nay trời đẹp quá.
          </span>
        </div>

        <div className="look-row">
          <div className="look-row__label">Màu chữ</div>
          <div className="look-row__body">
            <div className="swatches">
              {COLORS.map((color) => {
                const on = color.hex.toLowerCase() === look.color.toLowerCase();
                return (
                  <button
                    key={color.hex}
                    type="button"
                    title={color.label}
                    className={`swatch ${on ? 'swatch--on' : ''}`}
                    style={{background: color.hex}}
                    onClick={() => patchLook({color: color.hex})}
                  >
                    {on && (
                      <Check
                        size={14}
                        weight="bold"
                        color={['#ffffff', '#fde047', '#a3e635'].includes(color.hex) ? '#0f172a' : '#ffffff'}
                      />
                    )}
                  </button>
                );
              })}
              <label className="swatch swatch--custom" title="Chọn màu khác">
                <input
                  type="color"
                  aria-label="Chọn màu chữ tùy ý"
                  value={look.color}
                  onChange={(event) => patchLook({color: event.target.value})}
                />
              </label>
              <span className="swatch__hex">{look.color.toUpperCase()}</span>
            </div>
          </div>
        </div>

        <div className="look-row">
          <div className="look-row__label">Phóm chữ</div>
          <div className="look-row__body">
            <div className="font-grid">
              {FONTS.map((font) => (
                <button
                  key={font.id}
                  type="button"
                  className={`font-opt ${look.font === font.id ? 'font-opt--on' : ''}`}
                  onClick={() => patchLook({font: font.id, fontWeight: weightForFont(font.id)})}
                >
                  <span className="font-opt__name">
                    {font.name}
                    <span className="font-opt__desc"> · {font.desc}</span>
                  </span>
                  <span className="font-opt__sample" style={{fontFamily: font.stack}}>
                    Xin chào 123
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="look-row">
          <div className="look-row__label">Phóm chữ tải lên</div>
          <div className="look-row__body">
            <div className="custom-fonts" data-guide="font-upload">
              <label className="btn btn--secondary font-upload">
                <UploadSimple size={15} weight="bold" />
                <span>{fontBusy ? 'Đang tải lên...' : 'Tải phóm chữ (.ttf, .otf, .woff2)'}</span>
                <input
                  type="file"
                  accept=".ttf,.otf,.woff,.woff2"
                  hidden
                  disabled={fontBusy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    void pickFont(file);
                  }}
                />
              </label>

              {fonts.length === 0 ? (
                <span className="custom-fonts__hint">
                  Chưa có phóm chữ nào — tải file từ máy để dùng riêng cho video này.
                </span>
              ) : (
                <div className="custom-fonts__list">
                  {fonts.map((entry) => {
                    const on = look.font === 'custom' && look.customFont?.file === entry.file;
                    return (
                      <div key={entry.id} className={`font-chip ${on ? 'font-chip--on' : ''}`}>
                        <button
                          type="button"
                          className="font-chip__pick"
                          style={{fontFamily: `"${entry.family.replace(/["\\]/g, '')}", sans-serif`}}
                          onClick={() => selectFont(entry)}
                        >
                          {entry.family}
                        </button>
                        <button
                          type="button"
                          className="font-chip__del"
                          title="Xóa phóm chữ"
                          aria-label={`Xóa phóm chữ ${entry.family}`}
                          onClick={() => void removeFont(entry)}
                        >
                          <TrashSimple size={13} weight="bold" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {fontError && <div className="custom-fonts__error">{fontError}</div>}
            </div>
          </div>
        </div>

        <div className="look-row">
          <div className="look-row__label">Hiệu ứng</div>
          <div className="look-row__body">
            <div className="chips">
              {EFFECTS.map((effect) => (
                <button
                  key={effect.id}
                  type="button"
                  className={`chip-btn ${look.effect === effect.id ? 'chip-btn--on' : ''}`}
                  onClick={() => patchLook({effect: effect.id})}
                >
                  {effect.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="callout callout--info">
        <span className="callout__icon">
          <Info size={17} weight="fill" />
        </span>
        <div>
          Kiểu phụ đề bạn đang chọn <strong>({presetLabel(look)})</strong> sẽ được chèn vào toàn bộ
          video ở bước tạo phụ đề.
        </div>
      </div>
    </StepPanel>
  );
};
