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

const health = await startHealthServer({
  secret: config.digiflazzWebhookSecret,
  onEvent: (event, payload) => {
    const data = payload as { data?: Record<string, unknown> } | undefined;
    const row = data?.data ?? {};
    void client.reportWebhookEvent(event, {
      refId: typeof row.ref_id === 'string' ? row.ref_id : undefined,
      status: typeof row.status === 'string' ? row.status : undefined,
      product: typeof row.product_name === 'string' ? row.product_name : undefined,
      customer: typeof row.customer_no === 'string' ? row.customer_no : undefined,
      serial: typeof row.sn === 'string' ? row.sn : undefined,
      price: typeof row.price === 'number' ? row.price : undefined,
      message: typeof row.message === 'string' ? row.message : undefined
    });
  }
});
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
