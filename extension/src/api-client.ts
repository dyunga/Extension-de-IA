import type { HintErrorCode } from './messages';

export interface AnalyzeResponse { message: string }
export interface AnalyzeErrorBody { error: { code: HintErrorCode; message: string } }
export const EXTENSION_TRANSPORT_TIMEOUT_MS = 50_000;

export class ApiError extends Error {
  constructor(public readonly code: HintErrorCode, message: string) { super(message); }
}

export async function analyzeImage(
  imageDataUrl: string,
  signal: AbortSignal,
  apiOrigin = import.meta.env.VITE_API_ORIGIN,
  localClientToken = import.meta.env.VITE_LOCAL_CLIENT_TOKEN
): Promise<string> {
  const response = await fetch(`${apiOrigin}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Local-Client-Token': localClientToken },
    body: JSON.stringify({ imageDataUrl }),
    signal
  });
  const body = await response.json().catch(() => undefined) as Partial<AnalyzeResponse & AnalyzeErrorBody> | undefined;
  if (!response.ok) {
    const code = body?.error?.code ?? (response.status === 429 ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE');
    const message = body?.error?.message ?? 'No se pudo analizar la captura.';
    throw new ApiError(code, message);
  }
  if (!body?.message) throw new ApiError('SERVICE_UNAVAILABLE', 'La respuesta del servicio no es válida.');
  return body.message;
}

export function createTimeoutSignal(timeoutMs: number, upstream?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const abort = () => {
    if (timeout) clearTimeout(timeout);
    controller.abort();
  };
  const cleanup = () => {
    if (timeout) clearTimeout(timeout);
    upstream?.removeEventListener('abort', abort);
  };
  if (upstream?.aborted) {
    abort();
    return controller.signal;
  }
  timeout = setTimeout(() => controller.abort(), timeoutMs);
  upstream?.addEventListener('abort', abort, { once: true });
  controller.signal.addEventListener('abort', cleanup, { once: true });
  return controller.signal;
}
