import { createHmac, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config.js';

type WebhookOptions = { secret?: string };

const signatureMatches = (rawBody: Buffer, signature: string, secret: string): boolean => {
  const normalized = signature.trim();
  const match = /^(sha1|sha256)=([a-f0-9]+)$/i.exec(normalized);
  if (!match || !match[1] || !match[2]) return false;
  const expected = createHmac(match[1].toLowerCase(), secret).update(rawBody).digest('hex');
  const supplied = match[2];
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
};

export async function startHealthServer(options: WebhookOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  app.get('/health', async () => ({ ok: true, service: 'merlynn-wa-xendiyn' }));
  app.post('/webhooks/digiflazz', async (request, reply) => {
    const secret = options.secret?.trim();
    if (!secret) return reply.code(503).send({ ok: false, error: 'Webhook verification is not configured.' });
    const signatureHeader = request.headers['x-hub-signature'] ?? request.headers['x-digiflazz-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const body = Buffer.isBuffer(request.body) ? request.body : Buffer.from(JSON.stringify(request.body ?? {}));
    if (!signature || !signatureMatches(body, signature, secret)) {
      return reply.code(401).send({ ok: false, error: 'Invalid webhook signature.' });
    }
    try {
      JSON.parse(body.toString('utf8'));
    } catch {
      return reply.code(400).send({ ok: false, error: 'Invalid JSON webhook body.' });
    }
    return reply.code(202).send({ ok: true });
  });
  await app.listen({ host: config.host, port: config.port });
  return app;
}
