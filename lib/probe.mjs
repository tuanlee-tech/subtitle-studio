import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {parseMedia} from '@remotion/media-parser';
import {nodeReader} from '@remotion/media-parser/node';

/**
 * Video metadata probe — dùng `@remotion/media-parser` (thuần JS, không cần ffprobe),
 * fallback `ffprobe` khi máy có. Cả hai fail mới báo lỗi tiếng Việt.
 *
 * Shape trả về giống hệt bản ffprobe cũ để frontend/cli không đổi:
 * {width, height, fps, durationSec, hasAudio, formatName, size, bitRate}
 */

const FIELDS = {
  dimensions: true,
  durationInSeconds: true,
  fps: true,
  // webm/mkv không lưu fps trong header — media-parser chỉ đọc được qua slowFps
  // (đếm sample). Đúng hơn fallback 30 mù.
  slowFps: true,
  audioCodec: true,
  container: true,
  videoCodec: true,
};

// media-parser gộp mov vào 'mp4' và mkv vào 'webm' — đọc tên theo đuôi file
// cho quen thuộc (ffprobe cũng trả 'mov'/'matroska').
const FORMAT_BY_EXT = {
  '.mp4': 'mp4',
  '.m4v': 'mp4',
  '.mov': 'mov',
  '.mkv': 'matroska',
  '.webm': 'webm',
  '.avi': 'avi',
  '.ts': 'ts',
};

export const probeWithMediaParser = async (file) => {
  const result = await parseMedia({
    src: file,
    reader: nodeReader,
    // Bản community miễn phí — trong gói Remotion đã có sẵn, không cần license.
    acknowledgeRemotionLicense: true,
    fields: FIELDS,
  });
  const dims = result.dimensions;
  if (!dims?.width || !dims?.height) {
    throw new Error('Không đọc được kích thước video.');
  }
  const durationSec = Number(result.durationInSeconds ?? 0);
  if (!durationSec) throw new Error('Không xác định được thời lượng video.');
  const fps = Number(result.fps ?? result.slowFps ?? 0) || 30;
  const size = fs.statSync(file).size;
  const ext = path.extname(file).toLowerCase();
  const formatName = FORMAT_BY_EXT[ext] ?? result.container ?? 'unknown';
  return {
    width: dims.width,
    height: dims.height,
    fps: Math.round(fps * 1000) / 1000,
    durationSec,
    hasAudio: result.audioCodec != null,
    formatName,
    size,
    bitRate: Math.round((size * 8) / durationSec),
  };
};

/** Fallback khi media-parser không đọc được (định dạng lạ…) nhưng máy có ffprobe. */
export const probeWithFfprobe = (file) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      {windowsHide: true},
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || 'ffprobe failed'));
      try {
        const info = JSON.parse(out);
        const video = (info.streams ?? []).find((s) => s.codec_type === 'video');
        if (!video) return reject(new Error('Không tìm thấy stream video trong tệp này.'));
        const [num, den] = String(video.avg_frame_rate ?? video.r_frame_rate ?? '30/1').split('/').map(Number);
        const fps = den ? num / den : 30;
        const duration = Number(info.format?.duration ?? 0);
        if (!duration) return reject(new Error('Không xác định được thời lượng video.'));
        resolve({
          width: video.width,
          height: video.height,
          fps: Math.round(fps * 1000) / 1000,
          durationSec: duration,
          hasAudio: (info.streams ?? []).some((s) => s.codec_type === 'audio'),
          formatName: (info.format?.format_name ?? '').split(',')[0],
          size: Number(info.format?.size ?? 0),
          bitRate: Number(info.format?.bit_rate ?? 0),
        });
      } catch (e) {
        reject(e);
      }
    });
  });

export const probeVideo = async (file) => {
  try {
    return await probeWithMediaParser(file);
  } catch (e1) {
    try {
      return await probeWithFfprobe(file);
    } catch {
      throw new Error(
        `Không đọc được metadata video (${e1.message}). ` +
          'Cài ffmpeg (ffprobe) hoặc kiểm tra lại file.',
      );
    }
  }
};
