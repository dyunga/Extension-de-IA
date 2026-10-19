import type { FastifyInstance } from 'fastify';
import type { AIProvider } from '../ai/AIProvider.js';
import type { AppConfig } from '../config.js';
import { decodeImageDataUrl } from '../lib/image.js';
import { prepareStudyResponse } from '../lib/response-policy.js';
import { PublicError, publicMessages, toPublicError } from '../lib/errors.js';

const bodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['imageDataUrl'],
  properties: { imageDataUrl: { type: 'string', minLength: 1 } }
} as const;

export async function registerAnalyzeRoute(app: FastifyInstance, provider: AIProvider, config: AppConfig) {
  app.post('/api/analyze', {
    schema: {
      body: bodySchema,
      response: {
        200: { type: 'object', required: ['message'], additionalProperties: false, properties: { message: { type: 'string' } } },
        '4xx': errorSchema,
        '5xx': errorSchema
      }
    }
  }, async (request, reply) => {
    try {
      const body = request.body as { imageDataUrl: string };
      if (!body || Object.keys(body).length !== 1 || typeof body.imageDataUrl !== 'string') {
        throw new PublicError('BAD_REQUEST', publicMessages.BAD_REQUEST, 400);
      }
      const decoded = decodeImageDataUrl(body.imageDataUrl, config.MAX_IMAGE_BYTES);
      request.log.info({ imageBytes: decoded.bytes.byteLength, mime: decoded.mime }, 'validated analysis request');

      const controller = new AbortController();
      let timeout: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new PublicError('TIMEOUT', publicMessages.TIMEOUT, 504));
        }, config.AI_TIMEOUT_MS);
      });
      const providerPromise = Promise.resolve().then(() => provider.analyzeImage({ ...decoded, signal: controller.signal }));
      providerPromise.catch(() => undefined);
      try {
        const raw = await Promise.race([providerPromise, timeoutPromise]);
        return { message: prepareStudyResponse(raw) };
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    } catch (error) {
      const publicError = error instanceof PublicError ? error : toPublicError(error);
      return reply.status(publicError.statusCode).send({ error: { code: publicError.code, message: publicError.message } });
    }
  });
}

const errorSchema = {
  type: 'object',
  required: ['error'],
  additionalProperties: false,
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      additionalProperties: false,
      properties: { code: { type: 'string' }, message: { type: 'string' } }
    }
  }
} as const;
