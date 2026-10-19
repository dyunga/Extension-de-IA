import type { ImageMime } from '../lib/image.js';

export interface AnalyzeImageInput {
  bytes: Uint8Array;
  mime: ImageMime;
  signal: AbortSignal;
}

export interface AIProvider {
  analyzeImage(input: AnalyzeImageInput): Promise<string>;
}
