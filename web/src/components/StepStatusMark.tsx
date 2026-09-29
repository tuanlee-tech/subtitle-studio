import {Check, Spinner, X} from '@phosphor-icons/react';
import type {ReactNode} from 'react';
import type {StepStatus} from '../types';

/** Dot content for one sidebar step: number, check, spinner or cross. */
export const StepStatusMark = ({status, index}: {status: StepStatus; index: number}) => {
  let content: ReactNode = index + 1;
  if (status === 'completed') content = <Check size={17} weight="bold" />;
  if (status === 'processing') content = <Spinner size={16} className="spin" />;
  if (status === 'error') content = <X size={16} weight="bold" />;
  return <span className="step__dot">{content}</span>;
};
