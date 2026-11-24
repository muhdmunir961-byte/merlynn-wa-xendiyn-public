import { randomUUID } from 'node:crypto';
import { theme } from './theme.js';
import { LANG_LABELS, SUPPORTED_LANGS, normalizeLang, tr, type Lang } from '../i18n/index.js';

const env = (key: string, fallback = ''): string => (process.env[key] ?? fallback).trim();

export const store = {
  name: env('STORE_NAME', 'Merlynn Store'),
  tagline: env('STORE_TAGLINE', 'lovely · trustable · fast'),
  keyword: env('STORE_KEYWORD', 'merlynn').toLowerCase(),
  ownerName: env('STORE_OWNER', 'Owner'),
  ownerContact: env('STORE_CONTACT', ''),
  rules: env('STORE_RULES', ''),
  prefix: env('COMMAND_PREFIX', '.'),
  timezone: env('STORE_TIMEZONE', 'Asia/Jakarta'),
  lang: (normalizeLang(env('STORE_LANG', 'id')) ?? 'id') as Lang,
  orderAllowPublic: ['true', '1', 'yes'].includes(env('ORDER_ALLOW_PUBLIC', 'false').toLowerCase()),
  maxQty: Math.max(1, Number(env('ORDER_MAX_QTY', '5')) || 5),
  payment: {
    qrisNote: env('PAYMENT_QRIS_NOTE', 'qris diatas khusus dana'),
    dana: env('PAYMENT_DANA'),
    gopay: env('PAYMENT_GOPAY'),
    shopeepay: env('PAYMENT_SHOPEEPAY'),
    seabank: env('PAYMENT_SEABANK'),
    adminFee: env('PAYMENT_ADMIN_FEE', '1.000')
  }
} as const;

export interface WordingOverride {
  name?: string;
  tagline?: string;
  greeting?: string;
}

/** Runtime wording set by the owner via chat; overrides env defaults. */
let wordingOverride: WordingOverride = {};

export const applyWording = (override: WordingOverride): void => {
  wordingOverride = { ...override };
};

export const currentWording = (): WordingOverride => ({ ...wordingOverride });

const storeName = (): string => wordingOverride.name || store.name;
const storeTagline = (): string => wordingOverride.tagline || store.tagline;


/** Short store commands mapped to product keyword searches. */
export const categories: Category[] = [
  { key: 'ml', label: 'Mobile Legends', needles: ['mobile legends', 'mobile legend'] },
  { key: 'ff', label: 'Free Fire', needles: ['free fire'] },
  { key: 'pubg', label: 'PUBG Mobile', needles: ['pubg'] },
  { key: 'codm', label: 'Call of Duty Mobile', needles: ['call of duty'] },
  { key: 'genshin', label: 'Genshin Impact', needles: ['genshin'] },
  { key: 'hok', label: 'Honor of Kings', needles: ['honor of kings'] },
  { key: 'valorant', label: 'Valorant', needles: ['valorant'] },
  { key: 'roblox', label: 'Roblox / Robux', needles: ['roblox', 'robux'] },
  { key: 'starlight', label: 'Starlight ML', needles: ['starlight'] },
  { key: 'steam', label: 'Steam Wallet', needles: ['steam'] },
  { key: 'gplay', label: 'Google Play', needles: ['google play'] },
  { key: 'pln', label: 'PLN / Token Listrik', needles: ['pln', 'token listrik'] },
  { key: 'pulsa', label: 'Pulsa', needles: ['pulsa'] },
  { key: 'data', label: 'Paket Data', needles: ['data', 'internet'] },
  { key: 'emoney', label: 'E-Money', needles: ['dana', 'gopay', 'shopeepay', 'ovo', 'linkaja'] },
  { key: 'telkomsel', label: 'Telkomsel', needles: ['telkomsel'] },
  { key: 'indosat', label: 'Indosat', needles: ['indosat'] },
  { key: 'xl', label: 'XL', needles: ['xl'] },
  { key: 'axis', label: 'Axis', needles: ['axis'] },
  { key: 'tri', label: 'Tri', needles: ['tri'] },
  { key: 'smartfren', label: 'Smartfren', needles: ['smartfren'] },
  { key: 'byu', label: 'by.U', needles: ['by.u', 'byu'] },
  { key: 'tiktok', label: 'TikTok', needles: ['tiktok'] },
  { key: 'instagram', label: 'Instagram', needles: ['instagram'] },
  { key: 'youtube', label: 'YouTube', needles: ['youtube'] },
  { key: 'spotify', label: 'Spotify', needles: ['spotify'] },
  { key: 'netflix', label: 'Netflix', needles: ['netflix'] },
  { key: 'voucher', label: 'Voucher', needles: ['voucher', 'vcr'] }
];

export const findCategory = (name: string): Category | undefined =>
  categories.find((category) => category.key === name.toLowerCase());

const rupiah = (value: number | string | undefined): string => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 'Rp -';
  return `Rp ${num.toLocaleString('id-ID')}`;
};

const now = (): { date: string; time: string; greeting: string } => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: store.timezone,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const hour = Number(get('hour'));
  const greeting = hour < 11
    ? tr('greet.morning')
    : hour < 15
      ? tr('greet.noon')
      : hour < 18
        ? tr('greet.evening')
        : tr('greet.night');
  return {
    date: `${get('day')}/${get('month')}/${get('year')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')} ${tr('time.suffix')}`,
    greeting
  };
};

export const newRefId = (): string => `MLY-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
export const money = rupiah;
export const divider = (): string => theme.line;

export const banner = (): string => [
  theme.header(storeName()),
  `   🌦️ ‧˚ʚ ${storeTagline()} ɞ˚⋆  ⸝⸝\``
].join('\n');

export const greetingHeader = (senderName: string): string => {
  const clock = now();
  return [
    banner(),
    '',
    `ᐢ..ᐢ   ${wordingOverride.greeting || clock.greeting} 🌤 @${senderName}`,
    '',
    `╭╸ date ꠩ ${clock.date}`,
    `╰╸ time ꠩ ${clock.time}`
  ].join('\n');
};

export interface MenuSection {
  title: string;
  items: string[];
}

export const menu = (senderName: string, sections: MenuSection[]): string => {
  const body = sections.map((section) => [
    `      ⤿ ֵ ˳  ${section.title}`,
    theme.soft,
    ...section.items.map((item) => `   ${theme.bullet} ${item}`)
  ].join('\n'));

  return [
    greetingHeader(senderName),
    '',
    ...body,
    '',
    theme.footer.replace("%STORE%", storeName())
  ].join('\n');
};

export interface ProductView {
  code: string;
  name: string;
  price?: number;
  admin?: number;
  ready: boolean;
}

export const productBlock = (product: ProductView): string => [
  `*🪐 ${product.name.toUpperCase()}*`,
  `> Harga Member : ${rupiah(product.price)}`,
  `> Code : \`${product.code}\``,
  `> Status : ${product.ready ? 'Ready ✅' : 'Gangguan ⛔'}`
].join('\n');

export const productList = (brand: string, products: ProductView[], keyword: string): string => {
  const head = [
    `──═[ *${brand.toUpperCase()}* ]═──`,
    '',
    `${tr('list.orderHint')} : \`${keyword} [kode] [target]\``,
    `${tr('list.orderExample')} : \`${keyword} ${products[0]?.code ?? 'SKU'} 12345678\``,
    `${tr('list.qtyExample')} : \`${keyword} ${products[0]?.code ?? 'SKU'} 12345678 2x\``
  ].join('\n');

  const body = products.map((product) => [theme.line, '', productBlock(product)].join('\n')).join('\n\n');

  return [head, '', body, '', theme.line, '', tr('list.count', { count: products.length })].join('\n');
};

export interface BrandSummary {
  brand: string;
  count: number;
}

export const catalogue = (summaries: BrandSummary[], senderName: string): string => {
  const header = [
    greetingHeader(senderName),
    '',
    `      ⤿ ֵ ˳  ᴄᴀᴛᴀʟᴏɢᴜᴇ ᴘʀᴏᴅᴜᴋ`,
    theme.soft
  ].join('\n');

  const grouped = new Map<string, string[]>();
  for (const category of categories) {
    const hit = summaries.find((summary) =>
      category.needles.some((needle) => summary.brand.toLowerCase().includes(needle)));
    if (!hit) continue;
    const list = grouped.get(category.label) ?? [];
    list.push(`${hit.brand} (${hit.count})`);
    grouped.set(category.label, list);
  }

  const lines: string[] = [];
  for (const [label, brands] of grouped) {
    lines.push(`   ${theme.bullet} ${label} — ${brands.join(', ')}`);
  }

  const other = summaries
    .filter((summary) => !categories.some((category) =>
      category.needles.some((needle) => summary.brand.toLowerCase().includes(needle))))
    .slice(0, 8)
    .map((summary) => `${summary.brand} (${summary.count})`);

  if (other.length) {
    lines.push(`   ${theme.bullet} ${tr('catalogue.other')} — ${other.join(', ')}`);
  }

  return [
    header,
    ...lines,
    '',
    tr('catalogue.openCategory'),
    ...categories.slice(0, 12).map((category) => `   • ${category.key}`).join(' ')
      .split('\n'),
    '',
    `${tr('catalogue.searchDirect')} \`${store.prefix}price [kata kunci]\``,
    '',
    theme.footer.replace("%STORE%", storeName())
  ].join('\n');
};

export const noProducts = (query: string): string => [
  `╭╸ ⃘✿ *${tr('noProducts.title')}*`,
  `│ ${tr('noProducts.query')} : ${query || '-'}`,
  `│ ${tr('noProducts.hint')}`,
  `╰╸ ֹ ${store.prefix}price [kata kunci]`
].join('\n');

export const paymentInfo = (): string => {
  const lines = [
    'ᥫ᭡ ˖ ࣪ ‹ 𖥔 payment ‧˚ʚ ' + storeName() + ' ɞ˚⋆｡',
    theme.soft,
    '',
    ` - 𓊆 *${store.payment.qrisNote}* 𓊇`,
    '',
    ' 𖥻 ִ ۫ ּ ﹗ ˖ 𝐄 - 𝐖𝐀𝐋𝐋𝐄𝐓 :'
  ];
  if (store.payment.dana) lines.push(` • ˖ ࣪𖦆 ˓ 🥛 dana ⦂ ${store.payment.dana}`);
  if (store.payment.gopay) lines.push(` • ˖ ࣪𖦆 ˓ 🥛 gopay ⦂ ${store.payment.gopay}`);
  if (store.payment.shopeepay) lines.push(` • ˖ ࣪𖦆 ˓ 🥛 shopeepay ⦂ ${store.payment.shopeepay}`);
  if (store.payment.seabank) lines.push(` • ˖ ࣪𖦆 ˓ 🥛 seabank ⦂ ${store.payment.seabank}`);
  lines.push(
    '',
    '🏷️ 𝗇𝝾𝘁𝗲 ⦂',
    ` 𖥻 ̨𖥔 ִ ་ ، tf bank ke e-wallet + *${store.payment.adminFee}*`,
    ` 𖥻 ̨𖥔 ִ ་ ، ${tr('payment.note')}`,
    ` 𖥻 ̨𖥔 ִ ་ ، ${tr('payment.noFee')}`,
    '',
    ` *${tr('payment.exact')}*`
  );
  return lines.join('\n');
};

export const orderProcessing = (order: {
  refId: string;
  product: string;
  target: string;
  price?: number;
}): string => {
  const clock = now();
  return [
    '🪺〔 *' + tr('order.processing') + '* 〕🪺',
    '',
    `> ${tr('order.field.trxid')} : ${order.refId}`,
    `> ${tr('order.field.product')} : ${order.product}`,
    `> ${tr('order.field.target')} : ${order.target}`,
    `> ${tr('order.field.price')} : ${rupiah(order.price)}`,
    `> ${tr('order.field.status')} : ${tr('order.processingStatus')} 🔄`,
    `> ${tr('order.field.date')} : ${clock.date}`,
    `> ${tr('order.field.time')} : ${clock.time}`
  ].join('\n');
};

export const orderSuccess = (order: {
  refId: string;
  product: string;
  target: string;
  price?: number;
  serial?: string;
  message?: string;
}): string => {
  const clock = now();
  const lines = [
    '🐣〔 *' + tr('order.success') + '* 〕🐣',
    '',
    `> ${tr('order.field.trxid')} : ${order.refId}`,
    `> ${tr('order.field.product')} : ${order.product}`,
    `> ${tr('order.field.target')} : ${order.target}`,
    `> ${tr('order.field.price')} : ${rupiah(order.price)}`,
    `> ${tr('order.field.status')} : ${tr('order.successStatus')} ✅`,
    `> ${tr('order.field.date')} : ${clock.date}`,
    `> ${tr('order.field.time')} : ${clock.time}`
  ];
  if (order.serial) lines.push('', `──〔 *${tr('order.serial')}* 〕──`, order.serial);
  if (order.message) lines.push('', `_${order.message}_`);
  return lines.join('\n');
};

export const orderFailed = (order: {
  refId: string;
  product: string;
  target: string;
  message?: string;
}): string => [
  '🪹〔 *' + tr('order.failed') + '* 〕🪹',
  '',
  `> ${tr('order.field.trxid')} : ${order.refId}`,
  `> ${tr('order.field.product')} : ${order.product}`,
  `> ${tr('order.field.target')} : ${order.target}`,
  `> ${tr('order.field.status')} : ${tr('order.failedStatus')} ❌`,
  `> ${tr('order.field.note')} : ${order.message ?? tr('order.failedNote')}`,
  '',
  tr('order.failedRefund')
].join('\n');

export const orderPending = (order: { refId: string; product: string; target: string; message?: string }): string => [
  '🕰️〔 *' + tr('order.pending') + '* 〕🕰️',
  '',
  `> ${tr('order.field.trxid')} : ${order.refId}`,
  `> ${tr('order.field.product')} : ${order.product}`,
  `> ${tr('order.field.target')} : ${order.target}`,
  `> ${tr('order.field.status')} : ${tr('order.pendingStatus')} ⏳`,
  `> ${tr('order.field.note')} : ${order.message ?? tr('order.pendingNote')}`,
  '',
  `${tr('order.checkAnytime')} \`${store.prefix}status ${order.refId}\``
].join('\n');

export const depositCreated = (input: { id: string; amount: number }): string => [
  '🧾〔 *' + tr('deposit.created') + '* 〕🧾',
  '',
  `> ${tr('deposit.invoice')} : ${input.id}`,
  `> ${tr('deposit.amount')} : ${rupiah(input.amount)}`,
  `> ${tr('order.field.status')} : ${tr('deposit.waiting')} ⏳`,
  '',
  paymentInfo(),
  '',
  tr('deposit.afterPay')
].join('\n');

export const depositReviewed = (input: { id: string; amount: number; status: 'approved' | 'rejected'; reason?: string }): string => [
  input.status === 'approved' ? '✅〔 *' + tr('deposit.approved') + '* 〕✅' : '❌〔 *' + tr('deposit.rejected') + '* 〕❌',
  '',
  `> ${tr('deposit.invoice')} : ${input.id}`,
  `> ${tr('deposit.amount')} : ${rupiah(input.amount)}`,
  `> ${tr('order.field.status')} : ${input.status === 'approved' ? tr('deposit.statusOk') + ' ✅' : tr('deposit.statusNo') + ' ❌'}`,
  ...(input.reason ? [`> ${tr('deposit.reason')} : ${input.reason}`] : [])
].join('\n');

export const depositList = (items: Array<{ id: string; amount: number }>): string => {
  if (!items.length) return tr('deposit.empty');
  return [
    '📋〔 *' + tr('deposit.pendingList') + '* 〕📋',
    '',
    ...items.map((item, index) => `${index + 1}. ${item.id} — ${rupiah(item.amount)}`),
    '',
    `${tr('deposit.approveHint')} \`${store.prefix}approve [invoice]\``
  ].join('\n');
};

export const balanceInfo = (balance: number, currency: string): string => [
  '💳〔 *' + tr('balance.title') + '* 〕💳',
  '',
  `> ${tr('balance.left')} : ${currency === 'IDR' ? rupiah(balance) : `${balance} ${currency}`}`,
  `> ${tr('balance.time')} : ${now().time}`
].join('\n');

export const howToOrder = (): string => [
  '📖〔 *' + tr('howto.title') + '* 〕📖',
  '',
  tr('howto.step1'),
  tr('howto.step2'),
  tr('howto.step3', { keyword: store.keyword }),
  tr('howto.step4'),
  '',
  tr('howto.example'),
  `\`${store.keyword} 60UC 5123456789\``,
  `\`${store.keyword} 60UC 5123456789 2x\``,
  '',
  `${tr('order.checkAnytime')} \`${store.prefix}status [trxid]\``
].join('\n');

export const terms = (): string => [
  '📜〔 *' + tr('terms.title') + '* 〕📜',
  '',
  tr('terms.1'),
  tr('terms.2'),
  tr('terms.3'),
  tr('terms.4'),
  tr('terms.5'),
  ...(store.rules ? ['', store.rules] : [])
].join('\n');

export const staffInfo = (): string => [
  '👑〔 *' + tr('staff.title') + '* 〕👑',
  '',
  `> ${tr('staff.name')} : ${store.ownerName}`,
  ...(store.ownerContact ? [`> ${tr('staff.contact')} : ${store.ownerContact}`] : []),
  '',
  tr('staff.note')
].join('\n');

export const uptimeInfo = (uptimeMs: number, startedAt: string, style: string): string => {
  const seconds = Math.floor(uptimeMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [
    '⚡〔 *' + tr('uptime.title') + '* 〕⚡',
    '',
    `> ${tr('uptime.uptime')} : ${hours}j ${minutes}m`,
    `> ${tr('uptime.started')} : ${startedAt}`,
    `> ${tr('uptime.wording')} : ${style}`,
    `> ${tr('uptime.time')} : ${now().time}`
  ].join('\n');
};

export const errors = {
  ownerOnly: () => [
    '🚫〔 *' + tr('error.ownerOnly.title') + '* 〕🚫',
    '',
    `> ${tr('error.ownerOnly.body')}`,
    `> ${tr('error.ownerOnly.hint')} \`${store.prefix}claimowner\``
  ].join('\n'),
  ownerGroupOnly: () => tr('error.ownerGroupOnly'),
  claimSuccess: () => tr('error.claimSuccess'),
  claimExists: () => tr('error.claimExists'),
  claimNotAdmin: () => tr('error.claimNotAdmin'),
  claimFailed: () => tr('error.claimFailed'),
  digiflazzMissing: () => tr('error.digiflazzMissing'),
  usage: (text: string) => `${tr('error.usage')}\n\n> ${text}`,
  aiDisabled: () => tr('error.aiDisabled'),
  aiRateLimited: () => tr('error.aiRateLimited'),
  aiFailed: (message: string) => tr('error.aiFailed', { message }),
  priceFailed: (message: string) => tr('error.priceFailed', { message }),
  requestFailed: (message: string) => tr('error.requestFailed', { message }),
  unknown: () => tr('error.unknown', { prefix: store.prefix }),
  orderPublicDisabled: () => [
    '🚫〔 *' + tr('error.orderClosed.title') + '* 〕🚫',
    '',
    `> ${tr('error.orderClosed.body')}`,
    `> ${tr('error.orderClosed.hint')}`
  ].join('\n'),
  orderQtyTooHigh: () => tr('error.qtyTooHigh', { max: store.maxQty }),
  rateLimited: () => tr('error.rateLimited')
};

/** Getters keep the text in the language of the message being handled. */
export const usage = {
  get order(): string {
    return tr('usage.order', { keyword: store.keyword });
  },
  get topup(): string {
    return tr('usage.topup', { prefix: store.prefix });
  },
  get deposit(): string {
    return tr('usage.deposit', { prefix: store.prefix });
  },
  get status(): string {
    return tr('usage.status', { prefix: store.prefix });
  },
  get price(): string {
    return tr('usage.price', { prefix: store.prefix });
  },
  get approve(): string {
    return tr('usage.approve', { prefix: store.prefix });
  },
  get reject(): string {
    return tr('usage.reject', { prefix: store.prefix });
  },
  get ai(): string {
    return tr('usage.ai', { prefix: store.prefix });
  }
};

export const helpFooter = (): string => tr('footer.help', { owner: store.ownerName });

export interface CategoryLine {
  key: string;
  label: string;
  total: number;
  active: number;
  inactive: number;
}

const statusBadge = (active: number, inactive: number): string =>
  inactive === 0
    ? tr('badge.full')
    : active === 0
      ? tr('badge.none')
      : tr('badge.mixed', { active, inactive });

export const categoryOverview = (senderName: string, lines: CategoryLine[]): string => {
  const body = lines.map((line) =>
    `   ${theme.bullet} *${line.label}* — ${line.total} ${tr('sub.products')} · ${statusBadge(line.active, line.inactive)}\n     \`${line.key}\``);

  return [
    greetingHeader(senderName),
    '',
    `      ⤿ ֵ ˳  ${tr('category.heading')}`,
    theme.soft,
    ...body,
    '',
    tr('category.hint'),
    `${tr('category.example')} \`ml\` · \`pln\` · \`pulsa\``,
    '',
    theme.footer.replace("%STORE%", storeName())
  ].join('\n');
};

export interface SubCategoryLine {
  key: string;
  label: string;
  total: number;
  active: number;
  inactive: number;
}

export const subcategoryOverview = (category: { label: string; total: number; active: number; inactive: number }, lines: SubCategoryLine[]): string => [
  `───═[ *${category.label.toUpperCase()}* ]═───`,
  '',
  `> ${tr('sub.total')} : ${category.total} ${tr('sub.products')}`,
  `> ${tr('sub.status')} : ${statusBadge(category.active, category.inactive)}`,
  '',
  theme.soft,
  ...lines.map((line) => `   ${theme.bullet} ${line.label} — ${line.total} ${tr('sub.products')} · ${statusBadge(line.active, line.inactive)}\n     \`${line.key}\``),
  '',
  tr('sub.hint'),
  `${tr('sub.filter')} \`${store.prefix}aktif ${category.label}\` / \`${store.prefix}nonaktif ${category.label}\``
].join('\n');

export const filterNotice = (mode: 'all' | 'active' | 'inactive', label: string): string =>
  mode === 'active'
    ? tr('filter.active', { label })
    : mode === 'inactive'
      ? tr('filter.inactive', { label })
      : tr('filter.all', { label });
