import { JsonStore } from './persistence/json-store.js';
import { config } from './config.js';
import { DigiflazzClient } from './digiflazz/client.js';
import { ManualDepositService } from './deposit/manual.js';
import { ollamaLlmProvider } from './llm/ollama.js';
import { startHealthServer } from './server.js';
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
  llm: ollamaLlmProvider,
  digiflazz
});
await client.start();

const shutdown = async () => {
  await client.stop();
  await health.close();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
