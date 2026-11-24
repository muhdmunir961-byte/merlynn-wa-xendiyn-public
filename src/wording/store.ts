import { randomUUID } from 'node:crypto';

const env = (key: string, fallback = ''): string => (process.env[key] ?? fallback).trim();

export const store = {
  name: env('STORE_NAME', 'Merlynn Store'),
  tagline: env('STORE_TAGLINE', 'lovely · trustable · fast'),
  keyword: env('STORE_KEYWORD', 'merlynn').toLowerCase(),
  ownerName: env('STORE_OWNER', 'Owner'),
  prefix: env('COMMAND_PREFIX', '.'),
  timezone: env('STORE_TIMEZONE', 'Asia/Jakarta'),
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
  const greeting = hour < 11 ? 'Selamat Pagi' : hour < 15 ? 'Selamat Siang' : hour < 18 ? 'Selamat Sore' : 'Selamat Malam';
  return {
    date: `${get('day')}/${get('month')}/${get('year')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')} WIB`,
    greeting
  };
};

const LINE = '━━━ • ━━━ • ━━━ • ━━━ • ━━━ •';
const SOFT = '꒰  ࣪. ━ׄ─ִ─ׁ─ִ─ׁ─𔕙─ׅ─ׁ─ׅ─ׁ─ׅ━ ˖ ࣪꒱';

export const newRefId = (): string => `MLY-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

export const banner = (): string => [
  'ﾟ ˖ ✦ : ⤿ ' + store.name + ' ✦',
  '   🌦️ ‧˚ʚ ' + store.tagline + ' ɞ˚⋆  ⸝⸝`'
].join('\n');

export const greetingHeader = (senderName: string): string => {
  const clock = now();
  return [
    banner(),
    '',
    `ᐢ..ᐢ   ${clock.greeting} 🌤 @${senderName}`,
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
    SOFT,
    ...section.items.map((item) => `   ᥴ⃘ᦱ ֹ ${item}`)
  ].join('\n'));

  return [
    greetingHeader(senderName),
    '',
    ...body,
    '',
    '      ╭╸ ۫  ⸼ happy shopping  𝅄 ׄ',
    `      ╰╸ֵ ֹ ✦  ${store.name} ✧ ׄ  ⃘✿`
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
    `───═[ *${brand.toUpperCase()}* ]═───`,
    '',
    `Order Ketik : \`${keyword} [kode] [target]\``,
    `Contoh Order : \`${keyword} ${products[0]?.code ?? 'SKU'} 12345678\``,
    `Contoh Isi 2x : \`${keyword} ${products[0]?.code ?? 'SKU'} 12345678 2x\``
  ].join('\n');

  const body = products.map((product) => [LINE, '', productBlock(product)].join('\n')).join('\n\n');

  return [head, '', body, '', LINE, '', `Ada ${products.length} produk ditampilkan.`].join('\n');
};

export const noProducts = (query: string): string => [
  '╭╸ ⃘✿ *produk tidak dijumpai*',
  `> Carian : ${query || '-'}`,
  '> Cuba kata kunci lain, cth: `ml`, `pubg`, `telkomsel`',
  `╰╸ ֹ ${store.prefix}price [kata kunci]`
].join('\n');

export const paymentInfo = (): string => {
  const lines = [
    'ᥫ᭡ ˖ ࣪ ‹ 𖥔 payment ‧˚ʚ ' + store.name + ' ɞ˚⋆｡',
    ' 𓄲𓄲𓄲𓄲𓄲𓄲𓄲𓄲𓄲𓄲𓄲𓄲𓄲𓄲𓄲𓄲',
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
    ' 𖥻 ̨𖥔 ִ ་ ، kirim bukti transaksi no crop',
    ' 𖥻 ̨𖥔 ִ ་ ، tanpa fee pesanan tidak akan di proses',
    '',
    ' *tf sesuai nominal dan biaya admin*'
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
    '🪺〔 *TRANSAKSI PROSES* 〕🪺',
    '',
    `> Trxid : ${order.refId}`,
    `> Product : ${order.product}`,
    `> Target : ${order.target}`,
    `> Price : ${rupiah(order.price)}`,
    '> Status : Prosess 🔄',
    `> Calendar : ${clock.date}`,
    `> Time : ${clock.time}`
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
    '🐣〔 *TRANSAKSI SUCCESS* 〕🐣',
    '',
    `> Trxid : ${order.refId}`,
    `> Product : ${order.product}`,
    `> Target : ${order.target}`,
    `> Price : ${rupiah(order.price)}`,
    '> Status : Sukses ✅',
    `> Calendar : ${clock.date}`,
    `> Time : ${clock.time}`
  ];
  if (order.serial) {
    lines.push('', '──〔 *SERIAL NUMBER* 〕──', order.serial);
  }
  if (order.message) {
    lines.push('', `_${order.message}_`);
  }
  return lines.join('\n');
};

export const orderFailed = (order: {
  refId: string;
  product: string;
  target: string;
  message?: string;
}): string => [
  '🪹〔 *TRANSAKSI GAGAL* 〕🪹',
  '',
  `> Trxid : ${order.refId}`,
  `> Product : ${order.product}`,
  `> Target : ${order.target}`,
  '> Status : Gagal ❌',
  `> Note : ${order.message ?? 'transaksi ditolak penyedia'}`,
  '',
  'Jika saldo terpotong, hubungi owner untuk refund.'
].join('\n');

export const orderPending = (order: { refId: string; product: string; target: string; message?: string }): string => [
  '🕰️〔 *TRANSAKSI PENDING* 〕🕰️',
  '',
  `> Trxid : ${order.refId}`,
  `> Product : ${order.product}`,
  `> Target : ${order.target}`,
  '> Status : Pending ⏳',
  `> Note : ${order.message ?? 'menunggu konfirmasi penyedia'}`,
  '',
  `Semak bila-bila masa: \`${store.prefix}status ${order.refId}\``
].join('\n');

export const depositCreated = (input: { id: string; amount: number }): string => [
  '🧾〔 *DEPOSIT DIBUAT* 〕🧾',
  '',
  `> Invoice : ${input.id}`,
  `> Jumlah : ${rupiah(input.amount)}`,
  '> Status : Menunggu bayaran ⏳',
  '',
  paymentInfo(),
  '',
  'Selepas bayar, hantar bukti ke group. Owner akan approve.'
].join('\n');

export const depositReviewed = (input: { id: string; amount: number; status: 'approved' | 'rejected'; reason?: string }): string => [
  input.status === 'approved' ? '✅〔 *DEPOSIT DITERIMA* 〕✅' : '❌〔 *DEPOSIT DITOLAK* 〕❌',
  '',
  `> Invoice : ${input.id}`,
  `> Jumlah : ${rupiah(input.amount)}`,
  `> Status : ${input.status === 'approved' ? 'Berjaya ✅' : 'Ditolak ❌'}`,
  ...(input.reason ? [`> Sebab : ${input.reason}`] : [])
].join('\n');

export const depositList = (items: Array<{ id: string; amount: number }>): string => {
  if (!items.length) return '📭 Tiada deposit pending sekarang.';
  return [
    '📋〔 *DEPOSIT PENDING* 〕📋',
    '',
    ...items.map((item, index) => `${index + 1}. ${item.id} — ${rupiah(item.amount)}`),
    '',
    `Approve: \`${store.prefix}approve [invoice]\``
  ].join('\n');
};

export const balanceInfo = (balance: number, currency: string): string => [
  '💳〔 *SALDO PROVIDER* 〕💳',
  '',
  `> Baki : ${currency === 'IDR' ? rupiah(balance) : `${balance} ${currency}`}`,
  `> Masa : ${now().time}`
].join('\n');

export const errors = {
  ownerOnly: () => [
    '🚫〔 *AKSES DITOLAK* 〕🚫',
    '',
    '> Command ini hanya untuk owner yang sah.',
    `> Owner claim: \`${store.prefix}claimowner\``
  ].join('\n'),
  ownerGroupOnly: () => '🚫 Owner claim hanya boleh dibuat dalam group.',
  claimSuccess: () => '👑 Owner group berjaya didaftarkan. Command owner kini aktif.',
  claimExists: () => '👑 Group ini sudah ada owner.',
  claimNotAdmin: () => '🚫 Hanya admin group boleh claim owner.',
  claimFailed: () => '⚠️ Tidak dapat sahkan admin group. Cuba lagi.',
  digiflazzMissing: () => '⚠️ Digiflazz belum dikonfigurasi. Hubungi owner.',
  usage: (text: string) => `📝 *Format salah*\n\n> ${text}`,
  aiDisabled: () => `🤖 AI belum diaktifkan.\n> Owner perlu set \`LLM_ENABLED=true\`.`,
  aiRateLimited: () => '⏳ Sabar sikit ya, cuba lagi dalam beberapa saat.',
  aiFailed: (message: string) => `⚠️ AI ralat: ${message}`,
  priceFailed: (message: string) => `⚠️ Carian harga gagal: ${message}`,
  requestFailed: (message: string) => `⚠️ Ralat: ${message}`,
  unknown: () => `❓ Command tidak dikenali.\n> Taip \`${store.prefix}menu\` untuk senarai.`,
  orderPublicDisabled: () => [
    '🚫〔 *ORDER DITUTUP* 〕🚫',
    '',
    '> Order awam belum dibuka.',
    '> Hubungi owner untuk order manual.'
  ].join('\n'),
  orderQtyTooHigh: () => `⚠️ Maksimum ${store.maxQty}x setiap order.`,
  rateLimited: () => '⏳ Terlalu banyak mesej. Cuba lagi sebentar.'
};

export const usage = {
  order: `\`${store.keyword} [kode] [target] [qty]x\`\nContoh: \`${store.keyword} MLID500 12345678\``,
  topup: `\`${store.prefix}topup [sku] [target]\``,
  deposit: `\`${store.prefix}deposit [jumlah]\``,
  status: `\`${store.prefix}status [trxid]\``,
  price: `\`${store.prefix}price [kata kunci]\``,
  approve: `\`${store.prefix}approve [invoice]\``,
  reject: `\`${store.prefix}reject [invoice] [sebab]\``,
  ai: `\`${store.prefix}ai [soalan]\``
};

export const helpFooter = (): string => `Hubungi ${store.ownerName} untuk bantuan lanjut.`;
