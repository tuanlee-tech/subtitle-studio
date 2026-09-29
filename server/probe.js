import {spawn} from 'node:child_process';

/** Reads container/stream metadata with ffprobe. */
export const probeVideo = (file) =>
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
