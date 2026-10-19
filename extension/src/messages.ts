export type HintErrorCode = 'UNSUPPORTED' | 'CAPTURE_FAILED' | 'IMAGE_TOO_LARGE' | 'TIMEOUT' | 'RATE_LIMITED' | 'SERVICE_UNAVAILABLE';

export type HintMessage =
  | { type: 'hint/loading'; requestId: string }
  | { type: 'hint/success'; requestId: string; text: string }
  | { type: 'hint/error'; requestId: string; code: HintErrorCode; message: string };

export type ControlMessage = { type: 'request/cancel'; requestId: string };

export function isHintMessage(value: unknown): value is HintMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<HintMessage>;
  return message.type === 'hint/loading' || message.type === 'hint/success' || message.type === 'hint/error';
}

export function isControlMessage(value: unknown): value is ControlMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ControlMessage>;
  return message.type === 'request/cancel' && typeof message.requestId === 'string' && message.requestId.length > 0;
}
