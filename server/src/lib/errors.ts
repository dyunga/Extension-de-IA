export type PublicErrorCode =
  | 'UNSUPPORTED'
  | 'CAPTURE_FAILED'
  | 'IMAGE_TOO_LARGE'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INVALID_IMAGE'
  | 'BAD_REQUEST'
  | 'FORBIDDEN';

export class PublicError extends Error {
  constructor(
    public readonly code: PublicErrorCode,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export const publicMessages: Record<PublicErrorCode, string> = {
  UNSUPPORTED: 'Esta página no es compatible con la captura.',
  CAPTURE_FAILED: 'No se pudo capturar la página.',
  IMAGE_TOO_LARGE: 'La imagen es demasiado grande.',
  TIMEOUT: 'El análisis tardó demasiado.',
  RATE_LIMITED: 'Demasiadas solicitudes. Probá de nuevo en un momento.',
  SERVICE_UNAVAILABLE: 'El servicio no está disponible ahora.',
  INVALID_IMAGE: 'La imagen enviada no es válida.',
  BAD_REQUEST: 'La solicitud no es válida.',
  FORBIDDEN: 'La solicitud no está autorizada.'
};

export function toPublicError(error: unknown): PublicError {
  if (error instanceof PublicError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new PublicError('TIMEOUT', publicMessages.TIMEOUT, 504);
  }
  return new PublicError('SERVICE_UNAVAILABLE', publicMessages.SERVICE_UNAVAILABLE, 503);
}
