import { JsonStore } from './persistence/json-store.js';
import { config } from './config.js';
import { DigiflazzClient } from './digiflazz/client.js';
import { ManualDepositService } from './deposit/manual.js';
import { llmProvider } from './llm/openai.js';
import { startHealthServer } from './server.js';
import { startWebSocketGateway } from './server/websocket.js';
import { WhatsAppClient } from './whatsapp/client.js';

const store = new JsonStore(config.dataFile);
await store.load();

const digiflazz = config.digiflazzUsername && config.digiflazzApiKey
  ? new DigiflazzClient({
      username: config.digiflazzUsername,
      apiKey: config.digiflazzApiKey,
      baseUrl: config.digiflazzBaseUrl
    })
  : undefined;

const health = await startHealthServer({ secret: config.digiflazzWebhookSecret });
const client = new WhatsAppClient(store, {
  deposits: new ManualDepositService(store),
  llm: llmProvider,
  digiflazz
});

const ws = startWebSocketGateway({
  httpServer: health.server,
  path: '/ws',
  token: process.env.DASHBOARD_WS_TOKEN || undefined,
  sendMessage: (jid, text) => client.sendText(jid, text)
});

await client.start();

const shutdown = async () => {
  ws.close();
  await client.stop();
  await health.close();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

process.on('uncaughtException', (error) => {
  console.error('uncaughtException', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection', reason);
});
