import type { HintErrorCode } from '../messages';

export type HintState =
  | { kind: 'hidden' }
  | { kind: 'loading'; requestId: string }
  | { kind: 'success'; requestId: string; text: string }
  | { kind: 'error'; requestId: string; code: HintErrorCode; message: string };

interface Props { state: HintState; onDismiss: () => void }

const loadingLabel = 'Analyzing capture';

export function HintBar({ state, onDismiss }: Props) {
  if (state.kind === 'hidden') return null;
  const text = state.kind === 'loading' ? undefined : state.kind === 'success' ? state.text : state.message;
  const icon = state.kind === 'loading' ? '✨' : state.kind === 'success' ? '✓' : '!';
  return (
    <aside className={`vsa-hint vsa-hint--${state.kind}`} role="status" aria-live="polite" aria-label={state.kind === 'loading' ? loadingLabel : undefined}>
      <span className="vsa-hint__icon" aria-hidden="true">{icon}</span>
      {text ? <span className="vsa-hint__text">{text}</span> : null}
      <button className="vsa-hint__close" type="button" aria-label="Cerrar" onClick={onDismiss}>×</button>
    </aside>
  );
}
