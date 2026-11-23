import 'dotenv/config';
import type { LevelWithSilent } from 'pino';

const number = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: number(process.env.PORT, 3000),
  authDir: process.env.AUTH_DIR ?? './auth_info',
  dataFile: process.env.DATA_FILE ?? './data/state.json',
  commandPrefix: process.env.COMMAND_PREFIX ?? '.',
  outgoingMinDelayMs: number(process.env.OUTGOING_MIN_DELAY_MS, 400),
  outgoingJitterMs: number(process.env.OUTGOING_JITTER_MS, 900),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as LevelWithSilent,
  digiflazzUsername: process.env.DIGIFLAZZ_USERNAME ?? '',
  digiflazzApiKey: process.env.DIGIFLAZZ_API_KEY ?? '',
  digiflazzBaseUrl: process.env.DIGIFLAZZ_BASE_URL ?? 'https://api.digiflazz.com/v1',
  digiflazzWebhookSecret: process.env.DIGIFLAZZ_WEBHOOK_SECRET ?? '',
  llmEnabled: process.env.LLM_ENABLED ?? 'false',
  llmRateLimitMs: number(process.env.LLM_RATE_LIMIT_MS, 15_000),
  llmHistoryLimit: number(process.env.LLM_HISTORY_LIMIT, 6)
} as const;
