import makeWASocket, {
  DisconnectReason,
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
import { ollamaLlmProvider } from '../llm/ollama.js';
import type { LlmProvider } from '../plugins/interfaces.js';
import { OutgoingQueue } from './queue.js';
import { loadAuth } from './auth.js';
import { theme } from '../wording/theme.js';
import {
  balanceInfo,
  catalogue,
  categories,
  depositCreated,
  depositList,
  depositReviewed,
  errors,
  findCategory,
  howToOrder,
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
  ready: Boolean(item.seller_product_status) && Boolean(item.buyer_product_status)
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

export class WhatsAppClient {
  private socket?: WASocket;
  private auth?: { state: AuthenticationState; saveCreds: () => Promise<void> };
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private readonly startedAt = new Date();
  private readonly queue = new OutgoingQueue(config.outgoingMinDelayMs, config.outgoingJitterMs);
  private readonly logger = pino({ level: config.logLevel });
  private readonly histories = new Map<string, string[]>();
  private readonly providers: ClientProviders;
  private readonly llmLastRequest = new Map<string, number>();
  private readonly userRate = new Map<string, { count: number; windowStart: number }>();
  private priceCache?: { at: number; items: PriceListItem[] };

  constructor(private readonly store_: JsonStore, providers?: ClientProviders) {
    this.providers = providers ?? { deposits: new ManualDepositService(store_), llm: ollamaLlmProvider };
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
      setLatestQr(update.qr);
      void this.printQr(update.qr);
    }
    if (update.connection === 'open') {
      clearLatestQr();
      this.logger.info('WhatsApp connected');
    }
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
    return entry.count > limit;
  }

  private async handleMessage(message: WAMessage): Promise<void> {
    const remoteJid = message.key.remoteJid;
    if (!remoteJid || remoteJid === 'status@broadcast' || message.key.fromMe) return;
    const text = message.message?.conversation ?? message.message?.extendedTextMessage?.text;
    if (!text) return;
    if (this.rateLimited(remoteJid)) return;

    const senderJid = message.key.participant ?? remoteJid;
    const name = displayName(message, senderJid);
    const command = parseCommand(text, config.commandPrefix) ?? parseOrder(text, store.keyword);

    if (!command) {
      const category = findCategory(text.trim());
      if (category) {
        await this.price(remoteJid, category.label, category.needles);
        return;
      }
      if (llmIsEnabled()) await this.askLlm(remoteJid, text, name);
      return;
    }

    if (INFO_COMMANDS[command.name]) {
      await this.reply(remoteJid, INFO_COMMANDS[command.name]!());
      return;
    }

    switch (command.name) {
      case 'menu':
      case 'help':
        await this.reply(remoteJid, this.menuText(name));
        return;
      case 'ping': {
        const replyMs = Date.now();
        await this.reply(remoteJid, `🏓 Pong! Bot aktif.\n> ${new Date(replyMs).toISOString()}`);
        return;
      }
      case 'uptime':
      case 'statusbot':
        await this.reply(remoteJid, uptimeInfo(Date.now() - this.startedAt.getTime(), this.startedAt.toISOString(), theme.name));
        return;
      case 'id':
        await this.reply(remoteJid, `🆔 *Chat ID*\n> JID : ${remoteJid}\n> Kamu : ${senderJid}`);
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
        await this.catalogue(remoteJid, name);
        return;
      case 'price':
      case 'harga': {
        const query = command.args.join(' ');
        const category = findCategory(query.trim().split(/\s+/)[0] ?? '');
        await this.price(remoteJid, query, category?.needles ?? (query ? [query] : undefined));
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
        const category = findCategory(command.name);
        if (category) {
          await this.price(remoteJid, category.label, category.needles);
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

  private menuText(name: string): string {
    const sections: MenuSection[] = [
      {
        title: 'ᴄᴀᴛᴀʟᴏɢᴜᴇ - だ !',
        items: [
          `${store.prefix}list — ringkasan semua produk`,
          `${store.prefix}price [kata kunci] — cari produk`,
          `${store.keyword} [kode] [target] — order terus`
        ]
      },
      {
        title: 'ᴋᴀᴛᴇɢᴏʀɪ - 🎮',
        items: categories.slice(0, 12).map((category) => category.key).join('  ')
          .match(/.{1,48}(\s|$)/g)?.map((chunk) => chunk.trim()) ?? [],
        }
      },
      {
        title: 'ᴘᴀʏᴍᴇɴᴛ - 💳',
        items: [
          `${store.prefix}pay — info pembayaran`,
          `${store.prefix}deposit [jumlah] — invoice deposit`
        ]
      },
      {
        title: 'ʙᴀɴᴛᴜᴀɴ - 📖',
        items: [
          `${store.prefix}cara — cara order`,
          `${store.prefix}syarat — terma & syarat`,
          `${store.prefix}owner — hubungi owner`,
          `${store.prefix}status [trxid] — semak transaksi`
        ]
      },
      {
        title: 'ᴏᴡɴᴇʀ - 👑',
        items: [
          `${store.prefix}saldo — baki provider`,
          `${store.prefix}topup [sku] [target] — order manual`,
          `${store.prefix}deposits / ${store.prefix}approve / ${store.prefix}reject`,
          `${store.prefix}claimowner — daftar owner group`,
          `${store.prefix}uptime — status bot`
        ]
      }
    ];

    return [menu(name, sections.filter((section) => section.items.length)), '', `Style: ${theme.name}`].join('\n');
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

  private isOwnerNow(jid: string, senderJid: string): boolean {
    return jid.endsWith('@g.us') && this.store_.getOwner(jid)?.jid === senderJid;
  }

  private async isOwner(jid: string, senderJid: string): Promise<boolean> {
    if (this.isOwnerNow(jid, senderJid)) return true;
    await this.reply(jid, errors.ownerOnly());
    return false;
  }

  private async priceItems(): Promise<PriceListItem[]> {
    if (!this.providers.digiflazz) throw new Error('Digiflazz belum dikonfigurasi');
    const cached = this.priceCache;
    if (cached && Date.now() - cached.at < PRICE_CACHE_TTL_MS) return cached.items;
    const items = await this.providers.digiflazz.getPriceList();
    this.priceCache = { at: Date.now(), items };
    return items;
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

  private async executeOrder(jid: string, code: string, target: string, qty: number, manual: boolean): Promise<void> {
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
      if (!product.seller_product_status || !product.buyer_product_status) {
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
        }));

        const result = await this.providers.digiflazz.prepaidTransaction({
          sku: product.buyer_sku_code,
          customer: target,
          refId
        });
        const status = result.status.toLowerCase();
        if (status.includes('sukses') || status.includes('success')) {
          await this.reply(jid, orderSuccess({
            refId: result.ref_id,
            product: product.product_name,
            target: result.customer_no,
            price: result.price ?? product.price,
            serial: result.sn,
            message: manual ? undefined : oneLine(result.message)
          }));
          continue;
        }
        if (status.includes('gagal') || status.includes('fail')) {
          await this.reply(jid, orderFailed({
            refId: result.ref_id,
            product: product.product_name,
            target: result.customer_no,
            message: oneLine(result.message)
          }));
          continue;
        }
        await this.reply(jid, orderPending({
          refId: result.ref_id,
          product: product.product_name,
          target: result.customer_no,
          message: oneLine(result.message)
        }));
      }
    } catch (error) {
      await this.reply(jid, errors.requestFailed(error instanceof Error ? error.message : 'order gagal'));
    }
  }

  private async catalogue(jid: string, senderName: string): Promise<void> {
    if (!this.providers.digiflazz) {
      await this.reply(jid, errors.digiflazzMissing());
      return;
    }
    try {
      const items = await this.priceItems();
      const counts = new Map<string, number>();
      for (const item of items) {
        const brand = (item.brand || item.category || 'lain').trim();
        counts.set(brand, (counts.get(brand) ?? 0) + 1);
      }
      const summaries: BrandSummary[] = [...counts.entries()]
        .map(([brand, count]) => ({ brand, count }))
        .sort((a, b) => b.count - a.count);
      await this.reply(jid, catalogue(summaries, senderName));
    } catch (error) {
      await this.reply(jid, errors.priceFailed(error instanceof Error ? error.message : 'request gagal'));
    }
  }

  private async price(jid: string, label: string, needles?: string[]): Promise<void> {
    if (!this.providers.digiflazz) {
      await this.reply(jid, errors.digiflazzMissing());
      return;
    }
    try {
      const items = await this.priceItems();
      const normalized = (needles ?? []).map((needle) => needle.toLowerCase()).filter(Boolean);
      const matches = normalized.length
        ? items.filter((item) => normalized.some((needle) =>
            [item.buyer_sku_code, item.product_name, item.brand, item.category]
              .some((value) => value.toLowerCase().includes(needle))))
        : items;

      if (!matches.length) {
        await this.reply(jid, noProducts(label));
        return;
      }

      const shown = matches.slice(0, 10);
      await this.reply(jid, productList(label, shown.map(toProductView), store.keyword));
      if (matches.length > shown.length) {
        await this.reply(jid, `ℹ️ Ada ${matches.length} produk untuk *${label}*. Guna kata kunci lebih spesifik, cth \`${store.prefix}price ${label} 100\`.`);
      }
    } catch (error) {
      await this.reply(jid, errors.priceFailed(error instanceof Error ? error.message : 'request gagal'));
    }
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
      const answer = await this.providers.llm.complete({
        prompt,
        context: [`Pelanggan: ${name}`, ...history].join('\n')
      });
      const next = [...history, `User: ${oneLine(prompt)}`, `Assistant: ${oneLine(answer)}`]
        .slice(-Math.max(2, config.llmHistoryLimit));
      this.histories.set(jid, next);
      await this.reply(jid, answer);
    } catch (error) {
      await this.reply(jid, errors.aiFailed(error instanceof Error ? error.message : 'request gagal'));
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
