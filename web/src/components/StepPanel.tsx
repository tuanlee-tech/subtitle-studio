import type {ReactNode} from 'react';
import {ArrowLeft, ArrowRight} from '@phosphor-icons/react';

type Props = {
  icon: ReactNode;
  title: string;
  desc: string;
  onBack?: () => void;
  backLabel?: string;
  primary?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
    hideArrow?: boolean;
  };
  secondary?: {label: string; onClick: () => void; disabled?: boolean};
  children: ReactNode;
};

/** Shared chrome of every workflow step: header, actions and body. */
export const StepPanel = ({
  icon,
  title,
  desc,
  onBack,
  backLabel = 'Quay lại',
  primary,
  secondary,
  children,
}: Props) => (
  <section className="panel">
    <header className="panel__header">
      <div className="panel__head-left">
        <div className="panel__icon">{icon}</div>
        <div>
          <h1 className="panel__title" data-guide="panel-title">
            {title}
          </h1>
          <p className="panel__desc">{desc}</p>
        </div>
      </div>
      <div className="panel__actions">
        {onBack && (
          <button type="button" className="btn btn--secondary" onClick={onBack}>
            <ArrowLeft size={16} />
            {backLabel}
          </button>
        )}
        {secondary && (
          <button type="button" className="btn btn--secondary" onClick={secondary.onClick} disabled={secondary.disabled}>
            {secondary.label}
          </button>
        )}
        {primary && (
          <button
            type="button"
            className="btn btn--primary"
            data-guide="primary"
            onClick={primary.onClick}
            disabled={primary.disabled || primary.loading}
          >
            {primary.label}
            {!primary.hideArrow && <ArrowRight size={16} />}
          </button>
        )}
      </div>
    </header>
    {children}
  </section>
);
