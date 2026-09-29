import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {effectStroke, effectTextShadow, fontStack, normalizeLook} from '../lib/look.mjs';
import type {SubtitleLook} from '../lib/look.mjs';
import {FONT_FAMILY, loadCustomFont, loadFont} from './font';
import type {Cue, SubProps, Word} from './types';

loadFont();

const REVEAL_FRAMES = 3;

/**
 * A word stays invisible (but keeps its layout) until it is spoken, then
 * fades in with a small rise — subtitles appear word by word with the audio.
 * The color / glow live on the parent line, so they are inherited here.
 */
const RevealWord: React.FC<{word: Word; nowSec: number}> = ({word, nowSec}) => {
  const progress = interpolate(nowSec, [word.start, word.start + REVEAL_FRAMES / 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <span
      style={{
        display: 'inline-block',
        marginRight: '0.26em',
        opacity: progress,
        transform: `translateY(${(1 - progress) * 0.14}em)`,
      }}
    >
      {word.word}
    </span>
  );
};

/**
 * Subtitle style matching image.png:
 * - bold rounded font (Baloo 2), white fill
 * - red/pink neon glow outline
 * - centered, bottom of frame, max 2 lines, words revealed one by one
 * Color, font and effect come from the "look" picked in step 6.
 */
const SubtitleLine: React.FC<{cue: Cue; look: SubtitleLook}> = ({cue, look}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const nowSec = cue.startSec + frame / fps;

  // Pop-in over ~8 frames, fade-out over the last 4 frames
  const scale = spring({
    frame,
    fps,
    config: {damping: 14, mass: 0.5, stiffness: 160},
    durationInFrames: 8,
  });
  const durationFrames = Math.max(2, Math.round((cue.endSec - cue.startSec) * fps));
  const opacity = interpolate(
    frame,
    [0, 3, Math.max(durationFrames - 4, 4), Math.max(durationFrames, 5)],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  const fontSize = Math.round(width * 0.072);
  const glow = Math.max(fontSize / 22, 1.4);
  const shadow = effectTextShadow(look.effect, glow);
  const stroke = effectStroke(look.effect, glow);
  const fontFamily =
    look.font === 'baloo'
      ? `"${FONT_FAMILY}", ${fontStack(look.font)}`
      : fontStack(look.font, look.customFont);
  const lines = cue.lines?.length
    ? cue.lines
    : [cue.text.split(/\n/).flatMap((part) => part.split(/\s+/).filter(Boolean).map((word) => ({word, start: 0, end: 0})))];

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: Math.round(height * 0.08),
        opacity,
        transform: `scale(${interpolate(scale, [0, 1], [1.04, 1])})`,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          fontFamily,
          fontWeight: look.fontWeight,
          fontSize,
          lineHeight: 1.16,
          letterSpacing: '0.01em',
          color: look.color,
          textShadow: shadow,
          textAlign: 'center',
          maxWidth: '86%',
          ...(stroke ? {WebkitTextStroke: stroke} : null),
        }}
      >
        {lines.map((line, li) => (
          <div key={li} style={{whiteSpace: 'nowrap'}}>
            {line.map((word, wi) => (
              <RevealWord
                key={`${li}-${wi}-${word.word}`}
                word={word}
                nowSec={cue.lines?.length ? nowSec : cue.endSec}
              />
            ))}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const SubtitledVideo: React.FC<SubProps> = ({videoFile, cues, look}) => {
  const {fps, durationInFrames} = useVideoConfig();
  const subtitleLook = normalizeLook(look);
  if (subtitleLook.font === 'custom' && subtitleLook.customFont) {
    loadCustomFont(subtitleLook.customFont.family, subtitleLook.customFont.file);
  }

  return (
    <AbsoluteFill style={{backgroundColor: 'black'}}>
      <OffthreadVideo
        src={staticFile(videoFile)}
        style={{width: '100%', height: '100%'}}
      />
      {cues.map((cue, i) => {
        const from = Math.max(0, Math.round(cue.startSec * fps));
        const to = Math.min(durationInFrames, Math.round(cue.endSec * fps));
        const durationFramesForCue = Math.max(1, to - from);
        if (from >= durationInFrames) return null;
        return (
          <Sequence
            key={`${i}-${cue.startSec}`}
            from={from}
            durationInFrames={durationFramesForCue}
            layout="none"
          >
            <SubtitleLine cue={cue} look={subtitleLook} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
