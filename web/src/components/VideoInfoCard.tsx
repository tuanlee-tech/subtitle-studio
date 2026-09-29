import {FileText, FilmSlate, HardDrive, Ruler} from '@phosphor-icons/react';
import type {VideoMeta} from '../types';
import {formatBytes, formatDuration, formatResolution} from '../utils';

const fmtExt = (name: string) => (name.split('.').pop() ?? '').toUpperCase();

export const VideoInfoCard = ({video}: {video: VideoMeta}) => (
  <div className="video-info">
    <video className="video-info__preview" src={video.url} controls preload="metadata" muted />
    <div>
      <div className="video-info__title">Thông tin video</div>
      <div className="info-grid">
        <div className="info-item">
          <div className="info-item__label">
            <FileText size={15} /> Tên file
          </div>
          <div className="info-item__value">{video.name}</div>
        </div>
        <div className="info-item">
          <div className="info-item__label">
            <Ruler size={15} /> Kích thước
          </div>
          <div className="info-item__value">{formatResolution(video.width, video.height)}</div>
        </div>
        <div className="info-item">
          <div className="info-item__label">
            <FilmSlate size={15} /> Thời lượng
          </div>
          <div className="info-item__value">
            {formatDuration(video.durationSec)} · {Math.round(video.fps)} fps
          </div>
        </div>
        <div className="info-item">
          <div className="info-item__label">
            <HardDrive size={15} /> Định dạng
          </div>
          <div className="info-item__value">
            {fmtExt(video.name) || video.formatName.toUpperCase()} · {formatBytes(video.size)}
          </div>
        </div>
      </div>
    </div>
  </div>
);
