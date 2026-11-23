import makeWASocket, {
  DisconnectReason,
  type WASocket,
  type WAMessage,
  type AuthenticationState
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { config } from '../config.js';
import { claimGroupOwner } from '../bot/owner-claim.js';
import { parseCommand } from '../bot/parser.js';
import { JsonStore } from '../persistence/json-store.js';
import { ManualDepositService } from '../deposit/manual.js';
import { DigiflazzClient } from '../digiflazz/client.js';
import { ollamaLlmProvider } from '../llm/ollama.js';
import type { LlmProvider } from '../plugins/interfaces.js';
import { OutgoingQueue } from './queue.js';
import { loadAuth } from './auth.js';

interface ClientProviders {
  deposits: ManualDepositService;
  llm: LlmProvider;
  digiflazz?: DigiflazzClient;
}

const llmIsEnabled = (): boolean => ['true', '1', 'yes'].includes((process.env.LLM_ENABLED ?? '').trim().toLowerCase());
const safeAmount = (value: string | undefined): number | undefined => {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
};
const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

export class WhatsAppClient {
  private socket?: WASocket;
  private auth?: { state: AuthenticationState; saveCreds: () => Promise<void> };
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private readonly queue = new OutgoingQueue(config.outgoingMinDelayMs, config.outgoingJitterMs);
  private readonly logger = pino({ level: config.logLevel });
  private readonly histories = new Map<string, string[]>();
  private readonly providers: ClientProviders;
  private readonly llmLastRequest = new Map<string, number>();

  constructor(private readonly store: JsonStore, providers?: ClientProviders) {
    this.providers = providers ?? { deposits: new ManualDepositService(store), llm: ollamaLlmProvider };
  }

  async start(): Promise<void> {
    this.stopping = false;
    this.auth = await loadAuth(config.authDir);
    this.connect(this.auth.state);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.end(undefined);
    this.socket = undefined;
  }

  private connect(state: AuthenticationState): void {
    const socket = makeWASocket({
      auth: state,
      logger: this.logger,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false
    });
    this.socket = socket;
    socket.ev.on('creds.update', async () => this.auth?.saveCreds());
    socket.ev.on('connection.update', (update) => this.onConnectionUpdate(update));
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const message of messages) await this.handleMessage(message);
    });
  }

  private onConnectionUpdate(update: { connection?: 'open' | 'close' | 'connecting'; qr?: string; lastDisconnect?: { error?: unknown } }): void {
    if (update.qr) {
      console.log('\nScan this WhatsApp QR code:\n');
      qrcode.generate(update.qr, { small: true });
    }
    if (update.connection === 'open') this.logger.info('WhatsApp connected');
    if (update.connection !== 'close' || this.stopping) return;
    const statusCode = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
    if (statusCode === DisconnectReason.loggedOut) {
      this.logger.error('WhatsApp logged out; remove auth_info and re-authenticate if intentional');
      return;
    }
    this.logger.warn({ statusCode }, 'WhatsApp connection closed; reconnecting');
    this.reconnectTimer = setTimeout(() => {
      if (this.auth && !this.stopping) this.connect(this.auth.state);
    }, 3000);
  }

  private async handleMessage(message: WAMessage): Promise<void> {
    const remoteJid = message.key.remoteJid;
    if (!remoteJid || remoteJid === 'status@broadcast' || message.key.fromMe) return;
    const text = message.message?.conversation ?? message.message?.extendedTextMessage?.text;
    if (!text) return;
    const command = parseCommand(text, config.commandPrefix);
    const senderJid = message.key.participant ?? remoteJid;
    if (!command) {
      if (llmIsEnabled()) await this.askLlm(remoteJid, text);
      return;
    }

    switch (command.name) {
      case 'menu':
      case 'help':
        await this.reply(remoteJid, 'Commands: .menu .help .ping .claimowner .ai <text> .price [query] .deposit <amount> .deposits .approve <id> .reject <id> .saldo .topup <sku> <customer> .status <ref_id>');
        return;
      case 'ping':
        await this.reply(remoteJid, 'pong');
        return;
      case 'claimowner':
        await this.claimOwner(remoteJid, senderJid);
        return;
      case 'ai':
        await this.askLlm(remoteJid, command.args.join(' '));
        return;
      case 'price':
        await this.price(remoteJid, command.args.join(' '));
        return;
      default:
        if (['deposit', 'deposits', 'approve', 'reject', 'saldo', 'topup', 'status'].includes(command.name)) {
          if (!(await this.isStoredOwner(remoteJid, senderJid))) return;
          await this.ownerOrDigiflazzCommand(remoteJid, senderJid, command.name, command.args);
          return;
        }
        await this.reply(remoteJid, 'Unknown command. Try .help.');
    }
  }

  private async claimOwner(groupJid: string, senderJid: string): Promise<void> {
    if (!groupJid.endsWith('@g.us') || !this.socket) {
      await this.reply(groupJid, 'Owner claims are only available in groups.');
      return;
    }
    try {
      const metadata = await this.socket.groupMetadata(groupJid);
      await this.reply(groupJid, await claimGroupOwner(this.store, metadata, senderJid));
    } catch {
      await this.reply(groupJid, 'I could not verify group permissions. Please try again.');
    }
  }

  private async isStoredOwner(jid: string, senderJid: string): Promise<boolean> {
    if (!jid.endsWith('@g.us') || this.store.getOwner(jid)?.jid !== senderJid) {
      await this.reply(jid, 'Only the stored group owner can run this command.');
      return false;
    }
    return true;
  }

  private async ownerOrDigiflazzCommand(jid: string, ownerJid: string, name: string, args: string[]): Promise<void> {
    try {
      if (name === 'deposit') {
        const amount = safeAmount(args[0]);
        if (!amount) { await this.reply(jid, 'Usage: .deposit <positive integer amount>'); return; }
        const result = await this.providers.deposits.createRequest({ requesterJid: ownerJid, amount });
        await this.reply(jid, `Pending deposit created: ${result.id}`);
        return;
      }
      if (name === 'deposits') {
        const pending = this.providers.deposits.listPending();
        await this.reply(jid, pending.length ? pending.map((item) => `${item.id} — ${item.amount} (${item.requesterJid})`).join('\n') : 'No pending deposits.');
        return;
      }
      if (name === 'approve' || name === 'reject') {
        const id = args[0];
        if (!id) { await this.reply(jid, `Usage: .${name} <id>`); return; }
        const result = name === 'approve'
          ? await this.providers.deposits.ownerApprove(id, ownerJid)
          : await this.providers.deposits.ownerReject(id, ownerJid, args.slice(1).join(' ') || undefined);
        await this.reply(jid, `Deposit ${result.id} ${result.status}.`);
        return;
      }
      if (!this.providers.digiflazz) { await this.reply(jid, 'Digiflazz is not configured.'); return; }
      if (name === 'saldo') {
        const result = await this.providers.digiflazz.checkBalance();
        await this.reply(jid, `Saldo: ${result.balance} ${result.currency}`);
        return;
      }
      if (name === 'topup') {
        if (!args[0] || !args[1]) { await this.reply(jid, 'Usage: .topup <sku> <customer>'); return; }
        const result = await this.providers.digiflazz.prepaidTransaction({ sku: args[0], customer: args[1] });
        await this.reply(jid, `Topup ${result.status}: ${result.ref_id} — ${oneLine(result.message)}`);
        return;
      }
      if (name === 'status') {
        if (!args[0]) { await this.reply(jid, 'Usage: .status <ref_id>'); return; }
        const result = await this.providers.digiflazz.checkStatus({ refId: args[0] });
        await this.reply(jid, `Status ${result.status}: ${result.ref_id} — ${oneLine(result.message)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      await this.reply(jid, `Request failed: ${message}`);
    }
  }

  private async price(jid: string, query: string): Promise<void> {
    if (!this.providers.digiflazz) { await this.reply(jid, 'Digiflazz is not configured.'); return; }
    try {
      const items = await this.providers.digiflazz.getPriceList();
      const needle = query.trim().toLowerCase();
      const matches = (needle ? items.filter((item) => [item.buyer_sku_code, item.product_name, item.brand, item.category].some((value) => value.toLowerCase().includes(needle))) : items).slice(0, 10);
      await this.reply(jid, matches.length ? matches.map((item) => `${item.buyer_sku_code} — ${item.product_name} — ${item.price ?? '-'} — ${item.seller_product_status ? 'active' : 'inactive'}`).join('\n') : 'No matching products.');
    } catch (error) {
      await this.reply(jid, `Price lookup failed: ${error instanceof Error ? error.message : 'request failed.'}`);
    }
  }

  private async askLlm(jid: string, prompt: string): Promise<void> {
    if (!prompt.trim()) { await this.reply(jid, 'Usage: .ai <text>'); return; }
    const now = Date.now();
    const last = this.llmLastRequest.get(jid) ?? 0;
    if (now - last < config.llmRateLimitMs) { await this.reply(jid, 'Please wait before sending another AI request.'); return; }
    if (!llmIsEnabled()) { await this.reply(jid, 'AI is disabled.'); return; }
    this.llmLastRequest.set(jid, now);
    const history = this.histories.get(jid) ?? [];
    try {
      const answer = await this.providers.llm.complete({ prompt, context: history.join('\n') });
      const next = [...history, `User: ${oneLine(prompt)}`, `Assistant: ${oneLine(answer)}`].slice(-Math.max(2, config.llmHistoryLimit));
      this.histories.set(jid, next);
      await this.reply(jid, answer);
    } catch (error) {
      await this.reply(jid, `AI request failed: ${error instanceof Error ? error.message : 'request failed.'}`);
    }
  }

  private async reply(jid: string, text: string): Promise<void> {
    await this.queue.enqueue(async () => {
      if (!this.socket) return;
      await this.socket.sendPresenceUpdate('composing', jid);
      await this.socket.sendMessage(jid, { text });
      await this.socket.sendPresenceUpdate('paused', jid);
    });
  }
}
