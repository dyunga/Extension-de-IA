import { PublicError, publicMessages } from './errors.js';

export type ImageMime = 'image/jpeg' | 'image/png';

export interface DecodedImage {
  bytes: Uint8Array;
  mime: ImageMime;
}

const DATA_URL = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/;

export function decodeImageDataUrl(imageDataUrl: string, maxBytes: number): DecodedImage {
  const match = DATA_URL.exec(imageDataUrl);
  if (!match) throw new PublicError('INVALID_IMAGE', publicMessages.INVALID_IMAGE, 400);
  const mime = match[1] as ImageMime;
  const base64 = match[2] ?? '';
  if (base64.length > Math.ceil((maxBytes * 4) / 3) + 4) {
    throw new PublicError('IMAGE_TOO_LARGE', publicMessages.IMAGE_TOO_LARGE, 413);
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0 || buffer.length > maxBytes) {
    throw new PublicError('IMAGE_TOO_LARGE', publicMessages.IMAGE_TOO_LARGE, 413);
  }
  if (buffer.toString('base64') !== base64) {
    throw new PublicError('INVALID_IMAGE', publicMessages.INVALID_IMAGE, 400);
  }
  if (!matchesMagic(buffer, mime)) {
    throw new PublicError('INVALID_IMAGE', publicMessages.INVALID_IMAGE, 400);
  }
  return { bytes: new Uint8Array(buffer), mime };
}

function matchesMagic(bytes: Uint8Array, mime: ImageMime): boolean {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}
