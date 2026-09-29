import React from 'react';
import {Composition, getInputProps} from 'remotion';
import type {CalculateMetadataFunction} from 'remotion';
import {normalizeLook} from '../lib/look.mjs';
import {SubtitledVideo} from './SubtitledVideo';
import type {SubProps} from './types';

const defaultProps: SubProps = {
  videoFile: 'input.mp4',
  cues: [],
  meta: {width: 1080, height: 1920, fps: 30, durationSec: 1},
  look: normalizeLook(null),
};

const resolveProps = (): SubProps => {
  const inputProps = (getInputProps() ?? {}) as Partial<SubProps>;
  return {
    videoFile: inputProps.videoFile ?? defaultProps.videoFile,
    cues: inputProps.cues ?? defaultProps.cues,
    meta: {...defaultProps.meta, ...(inputProps.meta ?? {})},
    look: normalizeLook(inputProps.look),
  };
};

/**
 * Sizes the composition to the source video (passed via --props), so any
 * input resolution / fps / duration works without editing code.
 */
const calculateMetadata: CalculateMetadataFunction<SubProps> = async ({props}) => {
  const {width, height, fps, durationSec} = props.meta;
  return {
    width,
    height,
    fps,
    durationInFrames: Math.max(1, Math.round(durationSec * fps)),
  };
};

export const Root: React.FC = () => {
  const props = resolveProps();

  return (
    <Composition
      id="SubtitledVideo"
      component={SubtitledVideo}
      width={props.meta.width}
      height={props.meta.height}
      fps={props.meta.fps}
      durationInFrames={Math.max(
        1,
        Math.round(props.meta.durationSec * props.meta.fps),
      )}
      defaultProps={props}
      calculateMetadata={calculateMetadata}
    />
  );
};
