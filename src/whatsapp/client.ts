import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  type WASocket,
  type WAMessage,
  type AuthenticationState
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import { clearLatestQr, setLatestQr } from './qr-store.js';
import { config } from '../config.js';
import { claimGroupOwner } from '../bot/owner-claim.js';
import { parseCommand, parseOrder } from '../bot/parser.js';
import { JsonStore } from '../persistence/json-store.js';
import { ManualDepositService } from '../deposit/manual.js';
import { DigiflazzClient, type PriceListItem } from '../digiflazz/client.js';
import { llmProvider } from '../llm/openai.js';
import type { LlmProvider } from '../plugins/interfaces.js';
import { OutgoingQueue } from './queue.js';
import { loadAuth } from './auth.js';
import { theme } from '../wording/theme.js';
import { buildTree, filterItems, isActive, resolveNode, type CategoryNode } from '../catalog/tree.js';import { rowIdToCommand, sendList } from '../utils/uiMessage.js';
import { eventBus } from '../server/event-bus.js';
import { extractOrderIntent, stripWakeWord } from '../bot/intent.js';
import { classify } from '../agent/intent.js';
import { defaultLang, LanguageRegistry, normalizeLang, runWithLang, SUPPORTED_LANGS, t, tr } from '../i18n/index.js';
import { forgetFact, memoryContext, rememberFact } from '../agent/memory-client.js';
import { sttConfigured, transcribe } from '../stt/whisper.js';
import {
  balanceInfo,
  categoryOverview,
  catalogue,
  depositCreated,
  depositList,
  depositReviewed,
  errors,
  filterNotice,
  howToOrder,
  applyWording,
  currentWording,
  menu,
  newRefId,
  noProducts,
  orderFailed,
  orderPending,
  orderProcessing,
  orderSuccess,
  paymentInfo,
  productList,
  staffInfo,
  store,
  subcategoryOverview,
  terms,
  uptimeInfo,
  usage,
  type BrandSummary,
  type MenuSection,
  type ProductView
} from '../wording/store.js';

interface ClientProviders {
  deposits: ManualDepositService;
  llm: LlmProvider;
  digiflazz?: DigiflazzClient;
}

type FilterMode = 'all' | 'active' | 'inactive';

const PRICE_CACHE_TTL_MS = 10 * 60 * 1000;
const llmIsEnabled = (): boolean => ['true', '1', 'yes'].includes((process.env.LLM_ENABLED ?? '').trim().toLowerCase());
const safeAmount = (value: string | undefined): number | undefined => {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
};
const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();
const displayName = (message: WAMessage, jid: string): string => {
  const name = message.pushName?.trim();
  if (name) return name;
  return jid.split('@')[0]?.replace(/\D/g, '').slice(-6) ?? 'kak';
};
const toProductView = (item: PriceListItem): ProductView => ({
  code: item.buyer_sku_code,
  name: item.product_name,
  price: item.price,
  ready: isActive(item)
});

const OWNER_COMMANDS = ['deposit', 'deposits', 'approve', 'reject', 'saldo', 'topup', 'status'];
const INFO_COMMANDS: Record<string, () => string> = {
  cara: howToOrder,
  syarat: terms,
  rules: terms,
  owner: staffInfo,
  staff: staffInfo,
  pay: paymentInfo
};

const chunkKeys = (keys: string[]): string[] => {
  const lines: string[] = [];
  let current = '';
  for (const key of keys) {
    const next = current ? `${current}  ${key}` : key;
    if (next.length > 48) {
      if (current) lines.push(current);
      current = key;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
};

const messageText = (message: WAMessage): string | undefined => {
  const content = message.message;
  if (!content) return undefined;
  const direct = content.conversation ?? content.extendedTextMessage?.text;
  if (direct) return direct;
  const listReply = content.listResponseMessage?.singleSelectReply?.selectedRowId;
  if (listReply) return rowIdToCommand(listReply, store.prefix);
  const buttonReply = content.buttonsResponseMessage?.selectedButtonId;
  if (buttonReply) return rowIdToCommand(buttonReply, store.prefix);
  return undefined;
};

export class WhatsAppClient {
  private socket?: WASocket;
  private auth?: { state: AuthenticationState; saveCreds: () => Promise<void> };
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private readonly startedAt = new Date();
  private readonly queue = new OutgoingQueue(config.outgoingMinDelayMs, config.outgoingJitterMs);
  private readonly logger = pino({ level: config.logLevel });
  private readonly histories = new Map<string, string[]>();
  private readonly observed = new Map<string, string[]>();
  private readonly providers: ClientProviders;
  private readonly llmLastRequest = new Map<string, number>();
  private readonly userRate = new Map<string, { count: number; windowStart: number }>();
  private readonly pendingOrders = new Map<string, { sku: string; target: string; qty: number; expiresAt: number }>();
  private readonly languages = new LanguageRegistry(defaultLang());
  private panelTimer?: ReturnType<typeof setInterval>;
  private panelKey?: WAMessage['key'];
  private ordersToday = 0;
  private priceCache?: { at: number; items: PriceListItem[] };
  private treeCache?: { at: number; tree: CategoryNode[] };

  constructor(private readonly store_: JsonStore, providers?: ClientProviders) {
    this.providers = providers ?? { deposits: new ManualDepositService(store_), llm: llmProvider };
  }

  async start(): Promise<void> {
    this.stopping = false;
    this.languages.restore(this.store_.listLanguages());
    applyWording(this.store_.getWording() ?? {});
    this.auth = await loadAuth(config.authDir);
    this.connect(this.auth.state);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.panelTimer) clearInterval(this.panelTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.end(undefined);
    this.socket = undefined;
  }

  getSocket(): WASocket | undefined {
    return this.socket;
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
      setLatestQr(update.qr);
      void this.printQr(update.qr);
    }
    if (update.connection === 'open') {
      clearLatestQr();
      this.logger.info('WhatsApp connected');
      eventBus.emit('status', { connected: true });
      void this.announceOnline();
      this.startPanel();
    }
    if (update.connection !== 'close' || this.stopping) return;
    eventBus.emit('status', { connected: false });
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

  private async printQr(qr: string): Promise<void> {
    try {
      const ascii = await QRCode.toString(qr, { type: 'terminal', small: true });
      console.log('\nScan this WhatsApp QR code (expires quickly):\n');
      console.log(ascii);
    } catch (error) {
      this.logger.warn({ error }, 'could not render QR to console');
    }
  }

  private rateLimited(jid: string): boolean {
    const limit = Number(process.env.USER_RATE_LIMIT ?? 20);
    const windowMs = 60_000;
    const now = Date.now();
    const entry = this.userRate.get(jid);
    if (!entry || now - entry.windowStart > windowMs) {
      this.userRate.set(jid, { count: 1, windowStart: now });
      return false;
    }
    entry.count += 1;
    if (entry.count > limit) {
      eventBus.emit('log', { level: 'warn', message: `rate limit hit for ${jid}` });
      return true;
    }
    return false;
  }

  private async handleMessage(message: WAMessage): Promise<void> {
    const jid = message.key.remoteJid;
    if (!jid || jid === 'status@broadcast' || message.key.fromMe) return;
    const lang = this.languages.get(jid);
    await runWithLang(lang, () => this.routeMessage(message));
  }

  private async routeMessage(message: WAMessage): Promise<void> {
    const remoteJid = message.key.remoteJid;
    if (!remoteJid || remoteJid === 'status@broadcast' || message.key.fromMe) return;
    if (this.rateLimited(remoteJid)) return;

    const senderJid = message.key.participant ?? remoteJid;
    const name = displayName(message, senderJid);

    if (message.message?.audioMessage) {
      await this.handleVoice(message, remoteJid, senderJid, name);
      return;
    }

    const text = messageText(message);
    if (!text) return;
    this.observe(remoteJid, name, text);
    eventBus.emit('message', { jid: remoteJid, sender: senderJid, name, text, at: Date.now() });

    const command = parseCommand(text, config.commandPrefix) ?? parseOrder(text, store.keyword);

    if (!command) {
      await this.handleFreeText(message, remoteJid, senderJid, name, text);
      return;
    }

    if (INFO_COMMANDS[command.name]) {
      await this.reply(remoteJid, INFO_COMMANDS[command.name]!());
      return;
    }

    switch (command.name) {
      case 'menu':
      case 'help':
        await this.sendMenu(remoteJid, name);
        return;
      case 'ping':
        await this.reply(remoteJid, `🏓 Pong! Bot aktif.\n> ${new Date().toISOString()}`);
        return;
      case 'uptime':
      case 'statusbot':
        await this.reply(remoteJid, uptimeInfo(Date.now() - this.startedAt.getTime(), this.startedAt.toISOString(), theme.name));
        return;
      case 'id':
        await this.reply(remoteJid, `🆔 *Chat ID*\n> JID : ${remoteJid}\n> ${tr('staff.name')} : ${senderJid}`);
        return;
      case 'lang':
      case 'bahasa':
        await this.switchLanguage(remoteJid, senderJid, command.args[0]);
        return;
      case 'wording':
        await this.changeWording(remoteJid, senderJid, command.args);
        return;
      case 'claimowner':
        await this.claimOwner(remoteJid, senderJid);
        return;
      case 'ai':
        await this.askLlm(remoteJid, command.args.join(' '), name);
        return;
      case 'cat':
      case 'catalog':
      case 'list':
      case 'kategori':
        await this.showCategories(remoteJid, name);
        return;
      case 'aktif':
      case 'active':
      case 'nonaktif':
      case 'inactive': {
        const mode: FilterMode = command.name === 'aktif' || command.name === 'active' ? 'active' : 'inactive';
        const target = command.args.join(' ');
        const node = target ? await this.resolveInput(target) : undefined;
        if (node) {
          await this.browseNode(remoteJid, node.category, node.subcategory?.key, mode);
          return;
        }
        await this.showCategories(remoteJid, name, mode);
        return;
      }
      case 'price':
      case 'harga': {
        const target = command.args.join(' ');
        const node = target ? await this.resolveInput(target) : undefined;
        if (node) {
          await this.browseNode(remoteJid, node.category, node.subcategory?.key, 'all');
          return;
        }
        await this.searchPrice(remoteJid, target);
        return;
      }
      case 'order':
        if (!store.orderAllowPublic && !this.isOwnerNow(remoteJid, senderJid)) {
          await this.reply(remoteJid, errors.orderPublicDisabled());
          return;
        }
        await this.order(remoteJid, command.args);
        return;
      default: {
        const node = await this.resolveInput(command.name);
        if (node) {
          await this.browseNode(remoteJid, node.category, node.subcategory?.key, 'all');
          return;
        }
        if (OWNER_COMMANDS.includes(command.name)) {
          if (!(await this.isOwner(remoteJid, senderJid))) return;
          await this.ownerCommand(remoteJid, senderJid, command.name, command.args);
          return;
        }
        await this.reply(remoteJid, errors.unknown());
      }
    }
  }

  private async handleVoice(message: WAMessage, jid: string, senderJid: string, name: string): Promise<void> {
    if (!sttConfigured()) {
      await this.reply(jid, [
        '🎙️〔 *VOICE BELUM AKTIF* 〕🎙️',
        '',
        '> Owner perlu set `STT_BASE_URL` pada server bot.',
        `> Sementara itu guna teks: \`${store.keyword} [kode] [target]\``
      ].join('\n'));
      return;
    }

    await this.react(message, '🎧');

    let transcript = '';
    try {
      const buffer = await downloadMediaMessage(
        message,
        'buffer',
        {},
        { logger: this.logger, reuploadRequest: this.socket!.updateMediaMessage }
      ) as Buffer;
      const result = await transcribe(buffer, 'voice.ogg');
      transcript = result.text;
    } catch (error) {
      await this.react(message, '❌');
      await this.reply(jid, errors.requestFailed(error instanceof Error ? error.message : 'voice gagal diproses'));
      return;
    }

    eventBus.emit('message', { jid, sender: senderJid, name, text: transcript, voice: true, at: Date.now() });

    const instruction = stripWakeWord(transcript);
    if (instruction === undefined) {
      await this.react(message, '🤔');
      return;
    }
    if (!instruction) {
      await this.react(message, '👋');
      await this.reply(jid, `🎙️ Ya? Sebut \`${store.keyword} order [kode] [target]\`.`, { mentions: [senderJid] });
      return;
    }

    const intent = await extractOrderIntent(
      instruction,
      llmIsEnabled() ? this.providers.llm : undefined
    );
    if (!intent) {
      await this.react(message, '🤔');
      await this.reply(jid, [
        '🎙️〔 *' + tr('error.voiceNotUnderstood') + '* 〕🎙️',
        '',
        `> ${tr('error.heard')} : _${oneLine(transcript)}_`,
        `> ${tr('error.tryWith')} : \`${store.keyword} order MLID500 12345678\``
      ].join('\n'), { mentions: [senderJid] });
      return;
    }

    if (!store.orderAllowPublic && !this.isOwnerNow(jid, senderJid)) {
      await this.react(message, '🚫');
      await this.reply(jid, errors.orderPublicDisabled(), { mentions: [senderJid] });
      return;
    }

    await this.react(message, '⏳');
    await this.reply(jid, [
      '🎙️〔 *VOICE ORDER* 〕🎙️',
      '',
      `> Dengar : _${oneLine(transcript)}_`,
      `> SKU : \`${intent.sku}\``,
      `> Target : ${intent.target}`,
      `> Qty : ${intent.qty}x`
    ].join('\n'), { mentions: [senderJid] });

    await this.executeOrder(jid, intent.sku, intent.target, intent.qty, false, { mentions: [senderJid] });
  }

  private async react(message: WAMessage, emoji: string): Promise<void> {
    try {
      await this.socket?.sendMessage(message.key.remoteJid!, {
        react: { text: emoji, key: message.key }
      } as Parameters<WASocket['sendMessage']>[1]);
    } catch (error) {
      this.logger.debug({ error }, 'reaction failed');
    }
  }

  /** Natural-language entry point: the AI decides what to do, no commands needed. */
  private async handleFreeText(
    message: WAMessage,
    jid: string,
    senderJid: string,
    name: string,
    text: string
  ): Promise<void> {
    const node = await this.resolveInput(text);
    if (node && !this.pendingOrders.has(jid)) {
      await this.browseNode(jid, node.category, node.subcategory?.key, 'all');
      return;
    }

    const intent = classify(text);

    if (intent.kind === 'remember') {
      const saved = await rememberFact(intent.key, intent.value, ['auto']);
      await this.reply(jid, saved
        ? tr('memory.saved', { key: intent.key, value: intent.value })
        : tr('memory.notLinked'), { mentions: [senderJid] });
      return;
    }

    if (intent.kind === 'forget') {
      const removed = await forgetFact(intent.key);
      await this.reply(jid, removed
        ? tr('memory.forgotten', { key: intent.key })
        : tr('memory.notFound', { key: intent.key }), { mentions: [senderJid] });
      return;
    }

    const pending = this.pendingOrders.get(jid);

    if (intent.kind === 'cancel' && pending) {
      this.pendingOrders.delete(jid);
      await this.reply(jid, tr('order.confirm.cancelled'), { mentions: [senderJid] });
      return;
    }

    if (intent.kind === 'confirm' && pending) {
      this.pendingOrders.delete(jid);
      if (pending.expiresAt < Date.now()) {
        await this.reply(jid, tr('order.confirm.expired'), { mentions: [senderJid] });
        return;
      }
      await this.executeOrder(jid, pending.sku, pending.target, pending.qty, false, { mentions: [senderJid] });
      return;
    }

    if (intent.kind === 'order') {
      if (!this.providers.digiflazz) {
        await this.reply(jid, errors.digiflazzMissing(), { mentions: [senderJid] });
        return;
      }
      const owner = this.isOwnerNow(jid, senderJid);
      if (owner || store.orderAllowPublic) {
        await this.executeOrder(jid, intent.sku, intent.target, intent.qty, false, { mentions: [senderJid] });
        return;
      }
      const minutes = Number(process.env.ORDER_CONFIRM_TTL_MINUTES ?? 5);
      this.pendingOrders.set(jid, {
        sku: intent.sku,
        target: intent.target,
        qty: intent.qty,
        expiresAt: Date.now() + Math.max(1, minutes) * 60_000
      });
      await this.reply(jid, [
        '🛒〔 *' + tr('order.confirm.title') + '* 〕🛒',
        '',
        `> ${tr('order.confirm.sku')} : \`${intent.sku}\``,
        `> ${tr('order.confirm.target')} : ${intent.target}`,
        `> ${tr('order.confirm.qty')} : ${intent.qty}x`,
        '',
        tr('order.confirm.ask', { minutes })
      ].join('\n'), { mentions: [senderJid] });
      return;
    }

    if (intent.kind === 'status') {
      if (!this.isOwnerNow(jid, senderJid)) {
        await this.reply(jid, errors.ownerOnly(), { mentions: [senderJid] });
        return;
      }
      await this.ownerCommand(jid, senderJid, 'status', [intent.refId]);
      return;
    }

    if (intent.kind === 'search') {
      await this.searchPrice(jid, intent.query);
      return;
    }

    if (intent.kind === 'payment') {
      await this.reply(jid, paymentInfo(), { mentions: [senderJid] });
      return;
    }

    if (intent.kind === 'help') {
      await this.sendMenu(jid, name);
      return;
    }

    if (llmIsEnabled() && this.shouldAnswerFreeText(message, jid, text)) {
      await this.askLlm(jid, text, name);
    }
  }

  /** Greets the main group when the bot comes online, in the group's language. */
  private async announceOnline(): Promise<void> {
    const jid = this.panelJid();
    if (!jid || !this.socket) return;
    const lang = this.languages.get(jid);
    const clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: store.timezone, hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date());
    const text = runWithLang(lang, () => [
      `🌸〔 *${store.name.toUpperCase()}* 〕🌸`,
      '',
      t(lang, 'greet.online'),
      '',
      `> ${t(lang, 'uptime.uptime')} : ${t(lang, 'panel.online')}`,
      `> ${t(lang, 'panel.time')} : ${clock} ${t(lang, 'time.suffix')}`,
      `> ${t(lang, 'panel.model')} : ${config.llmModel}`,
      '',
      t(lang, 'greet.callMe'),
      t(lang, 'greet.examples'),
      '',
      theme.line
    ].join('\n'));
    try {
      await this.sendText(jid, text);
    } catch (error) {
      this.logger.warn({ error }, 'announceOnline failed');
    }
  }

  private startPanel(): void {
    if ((process.env.PANEL_ENABLED ?? 'true').toLowerCase() === 'false') return;
    const jid = this.panelJid();
    if (!jid) return;
    if (this.panelTimer) clearInterval(this.panelTimer);
    const minutes = Math.max(2, Number(process.env.PANEL_INTERVAL_MINUTES ?? 360) || 360);
    void this.refreshPanel(jid);
    this.panelTimer = setInterval(() => void this.refreshPanel(jid), minutes * 60_000);
  }

  /** Group that receives the live panel: PANEL_JID, else the first claimed group. */
  private panelJid(): string {
    const explicit = (process.env.PANEL_JID ?? '').trim();
    if (explicit) return explicit;
    return this.store_.ownerGroups()[0] ?? '';
  }

  /** Keeps one live status panel in the main group: delete old, send new, pin. */
  private async refreshPanel(jid: string): Promise<void> {
    if (!this.socket) return;
    const clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: store.timezone, hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date());
    const seconds = Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const lang = this.languages.get(jid);

    const text = runWithLang(lang, () => [
      `📌〔 *${store.name.toUpperCase()} · ${t(lang, 'panel.title')}* 〕📌`,
      '',
      `> ${t(lang, 'panel.status')} : ${t(lang, 'panel.online')}`,
      `> ${t(lang, 'panel.uptime')} : ${hours}j ${minutes}m`,
      `> ${t(lang, 'panel.ordersToday')} : ${this.ordersToday}`,
      `> ${t(lang, 'panel.time')} : ${clock} ${t(lang, 'time.suffix')}`,
      `> ${t(lang, 'panel.model')} : ${config.llmModel}`,
      '',
      t(lang, 'panel.hint'),
      t(lang, 'panel.orderHint', { keyword: store.keyword }),
      '',
      theme.line
    ].join('\n'));

    try {
      if (this.panelKey) {
        try {
          await this.socket.sendMessage(jid, { delete: this.panelKey });
        } catch {
          // panel may already be gone
        }
      }
      const sent = await this.socket.sendMessage(jid, { text });
      this.panelKey = sent?.key ?? undefined;
      if (this.panelKey) {
        try {
          await this.socket.sendMessage(jid, {
            pin: this.panelKey,
            type: 1,
            time: 21600
          } as Parameters<WASocket['sendMessage']>[1]);
        } catch {
          // pinning is best-effort; newer clients may reject it
        }
      }
      eventBus.emit('log', { level: 'info', message: 'panel refreshed' });
    } catch (error) {
      this.logger.warn({ error }, 'panel refresh failed');
    }
  }

  /** `.lang id|en` or `.lang` to show the current language. */
  private async switchLanguage(jid: string, senderJid: string, raw?: string): Promise<void> {
    const requested = normalizeLang(raw);
    if (!raw) {
      const current = this.languages.get(jid);
      await this.reply(jid, [
        t(current, 'lang.current', { lang: current === 'id' ? 'Indonesia' : 'English' }),
        '',
        t(current, 'lang.hint', { prefix: store.prefix })
      ].join('\n'), { mentions: [senderJid] });
      return;
    }
    if (!requested) {
      const current = this.languages.get(jid);
      await this.reply(jid, t(current, 'lang.unknown', {
        value: raw,
        options: SUPPORTED_LANGS.join(', ')
      }), { mentions: [senderJid] });
      return;
    }

    this.languages.set(jid, requested);
    await this.store_.setLanguage(jid, requested);
    await this.reply(jid, t(requested, 'lang.changed', {
      lang: requested === 'id' ? 'Indonesia' : 'English'
    }), { mentions: [senderJid] });

    if (this.panelTimer) this.startPanel();
  }

  /** Real catalogue rows for the prompt, so the model never invents prices. */
  private async productContext(prompt: string): Promise<string> {
    if (!this.providers.digiflazz) return '';
    const query = prompt.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim();
    try {
      const items = await this.priceItems();
      const matches = filterItems(items, { query }).slice(0, 5);
      if (!matches.length) return '';
      return matches
        .map((item) => `- ${item.product_name} | kode ${item.buyer_sku_code} | Rp ${(item.price ?? 0).toLocaleString('id-ID')} | ${isActive(item) ? 'aktif' : 'gangguan'}`)
        .join('\n');
    } catch {
      return '';
    }
  }

  /** `.wording <teks>` sets the shop tagline; `.wording reset` restores it. */
  private async changeWording(jid: string, senderJid: string, args: string[]): Promise<void> {
    if (!this.isOwnerNow(jid, senderJid)) {
      await this.reply(jid, errors.ownerOnly(), { mentions: [senderJid] });
      return;
    }
    const raw = args.join(' ').trim();
    if (!raw) {
      const current = currentWording();
      const text = current.tagline || store.tagline;
      await this.reply(jid, tr('wording.current', { text }) + '\n\n' + tr('wording.usage', { prefix: store.prefix }), {
        mentions: [senderJid]
      });
      return;
    }
    if (raw.toLowerCase() === 'reset') {
      await this.store_.resetWording();
      applyWording({});
      await this.reply(jid, tr('wording.reset'), { mentions: [senderJid] });
      return;
    }

    // `nama: X` / `tagline: Y` / `salam: Z`, or a bare line that sets the tagline.
    const patch: { name?: string; tagline?: string; greeting?: string } = {};
    for (const part of raw.split('|')) {
      const [label, ...rest] = part.split(':');
      const value = rest.join(':').trim();
      if (!value) continue;
      const key = label.trim().toLowerCase();
      if (['nama', 'name'].includes(key)) patch.name = value.slice(0, 60);
      else if (['tagline', 'slogan'].includes(key)) patch.tagline = value.slice(0, 120);
      else if (['salam', 'greeting'].includes(key)) patch.greeting = value.slice(0, 60);
    }
    if (!Object.keys(patch).length) patch.tagline = raw.slice(0, 120);

    await this.store_.setWording(patch);
    applyWording(this.store_.getWording() ?? {});
    await this.reply(jid, tr('wording.saved', {
      text: patch.tagline ?? patch.name ?? patch.greeting ?? raw
    }), { mentions: [senderJid] });
  }

  private async priceItems(): Promise<PriceListItem[]> {
    if (!this.providers.digiflazz) throw new Error('Digiflazz belum dikonfigurasi');
    const cached = this.priceCache;
    if (cached && Date.now() - cached.at < PRICE_CACHE_TTL_MS) return cached.items;
    const items = await this.providers.digiflazz.getPriceList();
    this.priceCache = { at: Date.now(), items };
    this.treeCache = { at: Date.now(), tree: buildTree(items) };
    return items;
  }

  private async categoryTree(): Promise<CategoryNode[]> {
    const cached = this.treeCache;
    if (cached && Date.now() - cached.at < PRICE_CACHE_TTL_MS) return cached.tree;
    const items = await this.priceItems();
    const tree = buildTree(items);
    this.treeCache = { at: Date.now(), tree };
    return tree;
  }

  private async resolveInput(input: string): Promise<{ category: CategoryNode; subcategory?: { key: string } } | undefined> {
    if (!this.providers.digiflazz || !input.trim()) return undefined;
    try {
      const tree = await this.categoryTree();
      return resolveNode(tree, input);
    } catch {
      return undefined;
    }
  }

  private async showCategories(jid: string, name: string, mode: FilterMode = 'all'): Promise<void> {
    if (!this.providers.digiflazz) {
      await this.reply(jid, errors.digiflazzMissing());
      return;
    }
    try {
      const tree = await this.categoryTree();
      const lines = tree.map((category) => ({
        key: category.key,
        label: category.label,
        total: mode === 'active' ? category.active : mode === 'inactive' ? category.inactive : category.total,
        active: category.active,
        inactive: category.inactive
      })).filter((line) => line.total > 0);

      await sendList(this.socket!, jid, {
        title: `${store.name} · Kategori`,
        text: categoryOverview(name, lines),
        footer: theme.name,
        buttonText: 'Pilih Kategori',
        sections: [{
          title: 'Kategori Produk',
          rows: lines.slice(0, 10).map((line) => ({
            title: line.label,
            description: `${line.total} produk`,
            rowId: `cat:${line.key}`
          }))
        }],
        fallback: categoryOverview(name, lines)
      });
    } catch (error) {
      await this.reply(jid, errors.priceFailed(error instanceof Error ? error.message : 'request gagal'));
    }
  }

  private async browseNode(jid: string, category: CategoryNode, subKey?: string, mode: FilterMode = 'all'): Promise<void> {
    try {
      const items = await this.priceItems();
      if (!subKey) {
        const lines = category.subcategories.map((sub) => ({
          key: sub.key,
          label: sub.label,
          total: mode === 'active' ? sub.active : mode === 'inactive' ? sub.inactive : sub.total,
          active: sub.active,
          inactive: sub.inactive
        })).filter((line) => line.total > 0);

        const text = subcategoryOverview(category, lines);
        await sendList(this.socket!, jid, {
          title: category.label,
          text,
          footer: theme.name,
          buttonText: 'Pilih Subkategori',
          sections: [{
            title: 'Subkategori',
            rows: lines.slice(0, 10).map((line) => ({
              title: line.label,
              description: `${line.total} produk`,
              rowId: `sub:${line.key}`
            }))
          }],
          fallback: text
        });
        return;
      }

      const matches = filterItems(items, { categoryKey: category.key, subKey, mode });
      const label = category.subcategories.find((sub) => sub.key === subKey)?.label ?? category.label;

      if (!matches.length) {
        await this.reply(jid, [
          noProducts(label),
          '',
          filterNotice(mode, label)
        ].join('\n'));
        return;
      }

      const shown = matches.slice(0, 10);
      await this.reply(jid, [
        filterNotice(mode, label),
        '',
        productList(label, shown.map(toProductView), store.keyword)
      ].join('\n'));

      if (matches.length > shown.length) {
        await this.reply(jid, `ℹ️ Ada ${matches.length} produk untuk *${label}*. Ketik \`${store.prefix}aktif ${label}\` untuk tapis produk aktif.`);
      }
    } catch (error) {
      await this.reply(jid, errors.priceFailed(error instanceof Error ? error.message : 'request gagal'));
    }
  }

  private async searchPrice(jid: string, query: string): Promise<void> {
    if (!this.providers.digiflazz) {
      await this.reply(jid, errors.digiflazzMissing());
      return;
    }
    try {
      const items = await this.priceItems();
      const matches = query ? filterItems(items, { query }) : items;
      if (!matches.length) {
        await this.reply(jid, noProducts(query));
        return;
      }
      const shown = matches.slice(0, 10);
      const label = query || 'semua produk';
      await this.reply(jid, productList(label, shown.map(toProductView), store.keyword));
      if (matches.length > shown.length) {
        await this.reply(jid, `ℹ️ Ada ${matches.length} produk. Guna kata kunci lebih spesifik.`);
      }
    } catch (error) {
      await this.reply(jid, errors.priceFailed(error instanceof Error ? error.message : 'request gagal'));
    }
  }

  private async sendMenu(jid: string, name: string): Promise<void> {
    const sections: MenuSection[] = [
      {
        title: tr('menu.section.catalogue'),
        items: [
          `${store.prefix}kategori — ${tr('menu.item.categories')}`,
          `${store.prefix}aktif / ${store.prefix}nonaktif [kategori] — ${tr('menu.item.filter')}`,
          `${store.prefix}price [kata kunci] — ${tr('menu.item.search')}`,
          `${store.keyword} [kode] [target] — ${tr('menu.item.order')}`
        ]
      },
      {
        title: tr('menu.section.category'),
        items: chunkKeys(['ml', 'ff', 'pubg', 'codm', 'genshin', 'hok', 'valorant', 'roblox', 'starlight', 'steam', 'gplay', 'pln', 'pulsa', 'data', 'emoney'])
      },
      {
        title: tr('menu.section.payment'),
        items: [
          `${store.prefix}pay — ${tr('menu.item.payment')}`,
          `${store.prefix}deposit [jumlah] — ${tr('menu.item.deposit')}`
        ]
      },
      {
        title: tr('menu.section.help'),
        items: [
          `${store.prefix}cara — ${tr('menu.item.howto')}`,
          `${store.prefix}syarat — ${tr('menu.item.terms')}`,
          `${store.prefix}owner — ${tr('menu.item.owner')}`,
          `${store.prefix}status [trxid] — ${tr('menu.item.status')}`,
          `${store.prefix}lang id|en — ${tr('menu.item.lang')}`,
          `${store.prefix}wording [teks] — ubah tagline kedai`
        ]
      },
      {
        title: tr('menu.section.owner'),
        items: [
          `${store.prefix}saldo — ${tr('menu.item.balance')}`,
          `${store.prefix}topup [sku] [target] — ${tr('menu.item.topup')}`,
          `${store.prefix}deposits / ${store.prefix}approve / ${store.prefix}reject`,
          `${store.prefix}claimowner — ${tr('menu.item.claim')}`,
          `${store.prefix}uptime — ${tr('menu.item.uptime')}`
        ]
      }
    ];

    const text = [menu(name, sections.filter((section) => section.items.length)), '', `Style: ${theme.name}`].join('\n');

    await sendList(this.socket!, jid, {
      title: store.name,
      text,
      footer: theme.name,
      buttonText: 'Buka Menu',
      sections: [{
        title: 'Menu Utama',
        rows: [
          { title: 'Kategori Produk', description: 'Lihat semua kategori', rowId: 'cmd:kategori' },
          { title: 'Cara Order', description: 'Panduan order', rowId: 'cmd:cara' },
          { title: 'Pembayaran', description: 'Info deposit & e-wallet', rowId: 'cmd:pay' },
          { title: 'Terma', description: 'Syarat & peraturan', rowId: 'cmd:syarat' },
          { title: 'Owner', description: 'Hubungi owner', rowId: 'cmd:owner' }
        ]
      }],
      fallback: text
    });
  }

  private async claimOwner(groupJid: string, senderJid: string): Promise<void> {
    if (!groupJid.endsWith('@g.us') || !this.socket) {
      await this.reply(groupJid, errors.ownerGroupOnly());
      return;
    }
    try {
      const metadata = await this.socket.groupMetadata(groupJid);
      const result = await claimGroupOwner(this.store_, metadata, senderJid);
      const message = result.includes('claimed')
        ? errors.claimSuccess()
        : result.includes('already')
          ? errors.claimExists()
          : result.includes('admin')
            ? errors.claimNotAdmin()
            : result;
      await this.reply(groupJid, message);
    } catch {
      await this.reply(groupJid, errors.claimFailed());
    }
  }

  /** Digiflazz webhook → notify the owner group so status changes reach buyers. */
  async reportWebhookEvent(
    event: string,
    data: { refId?: string; status?: string; product?: string; customer?: string; serial?: string; price?: number; message?: string }
  ): Promise<void> {
    const target = this.panelJid();
    if (!target || !this.socket) return;
    const lang = this.languages.get(target);
    const status = (data.status ?? '').toLowerCase();
    const head = status.includes('sukses') || status.includes('success')
      ? '✅ '
      : status.includes('gagal') || status.includes('fail')
        ? '⚠️ '
        : '⏳ ';
    const lines = [
      `${head}${t(lang, 'webhook.update')} (${event})`,
      '',
      data.product ? `> ${t(lang, 'webhook.product')} : ${data.product}` : '',
      data.customer ? `> ${t(lang, 'webhook.target')} : ${data.customer}` : '',
      data.refId ? `> ${t(lang, 'webhook.ref')} : \`${data.refId}\`` : '',
      data.status ? `> ${t(lang, 'webhook.status')} : ${data.status}` : '',
      data.serial ? `> ${t(lang, 'webhook.serial')} : \`${data.serial}\`` : '',
      data.price ? `> ${t(lang, 'webhook.price')} : Rp ${data.price.toLocaleString('id-ID')}` : '',
      data.message ? `> ${t(lang, 'webhook.message')} : ${oneLine(data.message)}` : ''
    ].filter(Boolean);
    try {
      await this.sendText(target, lines.join('\n'));
      eventBus.emit('order', { jid: target, refId: data.refId, status: data.status, product: data.product, target: data.customer });
    } catch (error) {
      this.logger.warn({ error }, 'webhook notify failed');
    }
  }

  private isOwnerNow(jid: string, senderJid: string): boolean {
    return jid.endsWith('@g.us') && this.store_.getOwner(jid)?.jid === senderJid;
  }

  private async isOwner(jid: string, senderJid: string): Promise<boolean> {
    if (this.isOwnerNow(jid, senderJid)) return true;
    await this.reply(jid, errors.ownerOnly());
    return false;
  }

  private async ownerCommand(jid: string, ownerJid: string, name: string, args: string[]): Promise<void> {
    try {
      if (name === 'deposit') {
        const amount = safeAmount(args[0]);
        if (!amount) {
          await this.reply(jid, errors.usage(usage.deposit));
          return;
        }
        const result = await this.providers.deposits.createRequest({ requesterJid: ownerJid, amount });
        await this.reply(jid, depositCreated({ id: result.id, amount }));
        return;
      }
      if (name === 'deposits') {
        const pending = this.providers.deposits.listPending();
        await this.reply(jid, depositList(pending.map((item) => ({ id: item.id, amount: item.amount }))));
        return;
      }
      if (name === 'approve' || name === 'reject') {
        const id = args[0];
        if (!id) {
          await this.reply(jid, errors.usage(name === 'approve' ? usage.approve : usage.reject));
          return;
        }
        const result = name === 'approve'
          ? await this.providers.deposits.ownerApprove(id, ownerJid)
          : await this.providers.deposits.ownerReject(id, ownerJid, args.slice(1).join(' ') || undefined);
        await this.reply(jid, depositReviewed({
          id: result.id,
          amount: result.amount,
          status: result.status === 'approved' ? 'approved' : 'rejected',
          reason: result.rejectionReason
        }));
        return;
      }
      if (!this.providers.digiflazz) {
        await this.reply(jid, errors.digiflazzMissing());
        return;
      }
      if (name === 'saldo') {
        const result = await this.providers.digiflazz.checkBalance();
        await this.reply(jid, balanceInfo(result.balance, result.currency));
        return;
      }
      if (name === 'topup') {
        if (!args[0] || !args[1]) {
          await this.reply(jid, errors.usage(usage.topup));
          return;
        }
        await this.executeOrder(jid, args[0], args[1], 1, true);
        return;
      }
      if (name === 'status') {
        if (!args[0]) {
          await this.reply(jid, errors.usage(usage.status));
          return;
        }
        const result = await this.providers.digiflazz.checkStatus({ refId: args[0] });
        const status = result.status.toLowerCase();
        if (status.includes('sukses') || status.includes('success')) {
          await this.reply(jid, orderSuccess({
            refId: result.ref_id,
            product: result.buyer_sku_code,
            target: result.customer_no,
            price: result.price,
            serial: result.sn,
            message: oneLine(result.message)
          }));
          return;
        }
        if (status.includes('gagal') || status.includes('fail')) {
          await this.reply(jid, orderFailed({
            refId: result.ref_id,
            product: result.buyer_sku_code,
            target: result.customer_no,
            message: oneLine(result.message)
          }));
          return;
        }
        await this.reply(jid, orderPending({
          refId: result.ref_id,
          product: result.buyer_sku_code,
          target: result.customer_no,
          message: oneLine(result.message)
        }));
      }
    } catch (error) {
      await this.reply(jid, errors.requestFailed(error instanceof Error ? error.message : 'request gagal'));
    }
  }

  private async order(jid: string, args: string[]): Promise<void> {
    const [code, target, qtyArg] = args;
    if (!code || !target) {
      await this.reply(jid, errors.usage(usage.order));
      return;
    }
    const qty = qtyArg && /^\d+x$/i.test(qtyArg) ? Number(qtyArg.slice(0, -1)) : 1;
    if (!Number.isFinite(qty) || qty < 1) {
      await this.reply(jid, errors.usage(usage.order));
      return;
    }
    if (qty > store.maxQty) {
      await this.reply(jid, errors.orderQtyTooHigh());
      return;
    }
    if (!this.providers.digiflazz) {
      await this.reply(jid, errors.digiflazzMissing());
      return;
    }
    await this.executeOrder(jid, code, target, qty, false);
  }

  private async executeOrder(
    jid: string,
    code: string,
    target: string,
    qty: number,
    manual: boolean,
    meta?: { mentions?: string[]; tag?: string }
  ): Promise<void> {
    if (!this.providers.digiflazz) {
      await this.reply(jid, errors.digiflazzMissing());
      return;
    }
    try {
      const items = await this.priceItems();
      const product = items.find((item) => item.buyer_sku_code.toLowerCase() === code.toLowerCase());
      if (!product) {
        await this.reply(jid, noProducts(code));
        return;
      }
      if (!isActive(product)) {
        await this.reply(jid, orderFailed({
          refId: '-',
          product: product.product_name,
          target,
          message: 'produk sedang gangguan, cuba produk lain'
        }));
        return;
      }

      for (let index = 0; index < qty; index += 1) {
        const refId = newRefId();
        await this.reply(jid, orderProcessing({
          refId,
          product: product.product_name,
          target,
          price: product.price
        }), { mentions: meta?.mentions });

        const result = await this.providers.digiflazz.prepaidTransaction({
          sku: product.buyer_sku_code,
          customer: target,
          refId
        });
        eventBus.emit('order', {
          jid, refId: result.ref_id, status: result.status, product: product.product_name, target: result.customer_no
        });
        const status = result.status.toLowerCase();
        if (status.includes('sukses') || status.includes('success')) {
          this.ordersToday += 1;
          await this.reply(jid, orderSuccess({
            refId: result.ref_id,
            product: product.product_name,
            target: result.customer_no,
            price: result.price ?? product.price,
            serial: result.sn,
            message: manual ? undefined : oneLine(result.message)
          }), { mentions: meta?.mentions });
          continue;
        }
        if (status.includes('gagal') || status.includes('fail')) {
          await this.reply(jid, orderFailed({
            refId: result.ref_id,
            product: product.product_name,
            target: result.customer_no,
            message: oneLine(result.message)
          }), { mentions: meta?.mentions });
          continue;
        }
        await this.reply(jid, orderPending({
          refId: result.ref_id,
          product: product.product_name,
          target: result.customer_no,
          message: oneLine(result.message)
        }), { mentions: meta?.mentions });
      }
    } catch (error) {
      await this.reply(jid, errors.requestFailed(error instanceof Error ? error.message : 'order gagal'));
    }
  }

  private selfNumber(): string {
    const id = this.socket?.user?.id ?? '';
    return id.split('@')[0]?.split(':')[0] ?? '';
  }

  /** Rolling transcript so the AI can read the room, not just the tagged line. */
  private observe(jid: string, name: string, text: string): void {
    const line = `${name}: ${oneLine(text).slice(0, 160)}`;
    const buffer = this.observed.get(jid) ?? [];
    buffer.push(line);
    this.observed.set(jid, buffer.slice(-12));
  }

  private recentChatter(jid: string): string {
    return (this.observed.get(jid) ?? []).join('\n');
  }

  /** True when the text starts with or contains a configured wake word. */
  private hasWakeWord(text: string): boolean {
    const lower = text.toLowerCase();
    return config.wakeWords.some((word) => {
      const pattern = new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, 'i');
      return pattern.test(lower);
    });
  }

  /** Group chats only get free-text AI replies when called by name, tagged or quoted. */
  private shouldAnswerFreeText(message: WAMessage, jid: string, text: string): boolean {
    if (!jid.endsWith('@g.us')) return true;
    const mode = (process.env.GROUP_AI_MODE ?? 'wake').toLowerCase();
    if (mode === 'off') return false;
    if (mode === 'all') return true;
    if (this.hasWakeWord(text)) return true;

    const self = this.selfNumber();
    if (!self) return false;
    if (text.toLowerCase().startsWith(this.selfNumber())) return true;

    const content = message.message;
    const context = content?.extendedTextMessage?.contextInfo
      ?? content?.imageMessage?.contextInfo
      ?? content?.videoMessage?.contextInfo
      ?? content?.documentMessage?.contextInfo;

    const normalise = (value: string | null | undefined): string => (value ?? '').split('@')[0]?.split(':')[0] ?? '';

    if ((context?.mentionedJid ?? []).some((mentioned) => normalise(mentioned) === self)) return true;
    if (normalise(context?.participant) === self) return true;
    return false;
  }

  private async askLlm(jid: string, prompt: string, name: string): Promise<void> {
    if (!prompt.trim()) {
      await this.reply(jid, errors.usage(usage.ai));
      return;
    }
    if (!llmIsEnabled()) {
      await this.reply(jid, errors.aiDisabled());
      return;
    }
    const now = Date.now();
    const last = this.llmLastRequest.get(jid) ?? 0;
    if (now - last < config.llmRateLimitMs) {
      await this.reply(jid, errors.aiRateLimited());
      return;
    }
    this.llmLastRequest.set(jid, now);
    const history = this.histories.get(jid) ?? [];
    try {
      const remembered = await memoryContext(prompt);
      const room = this.recentChatter(jid);
      const answer = await this.providers.llm.complete({
        prompt,
        context: [
          ...(room ? [`Obrolan grup terkini:\n${room}`] : []),
          ...(remembered ? [remembered.slice(0, 200)] : []),
          ...history.slice(-3)
        ].join('\n')
      });
      const next = [...history, `User: ${oneLine(prompt)}`, `Assistant: ${oneLine(answer)}`]
        .slice(-Math.max(2, config.llmHistoryLimit));
      this.histories.set(jid, next);
      await this.reply(jid, answer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'request gagal';
      if (message === 'DEADLINE') {
        await this.reply(jid, tr('error.aiSlow'));
        return;
      }
      await this.reply(jid, errors.aiFailed(message));
    }
  }

  /** Used by the web dashboard to send a message through the bot. */
  async sendText(jid: string, text: string): Promise<void> {
    await this.reply(jid, text);
  }

  private async reply(jid: string, text: string, options?: { mentions?: string[] }): Promise<void> {
    await this.queue.enqueue(async () => {
      if (!this.socket) return;
      await this.socket.sendPresenceUpdate('composing', jid);
      await this.socket.sendMessage(jid, {
        text,
        ...(options?.mentions?.length ? { mentions: options.mentions } : {})
      });
      await this.socket.sendPresenceUpdate('paused', jid);
      eventBus.emit('reply', { jid, text, at: Date.now() });
    });
  }
}
