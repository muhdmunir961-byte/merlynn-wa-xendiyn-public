import { randomUUID } from 'node:crypto';
import { theme } from './theme.js';

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

export interface Category {
  key: string;
  label: string;
  needles: string[];
}

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
  const greeting = hour < 11 ? 'Selamat Pagi' : hour < 15 ? 'Selamat Siang' : hour < 18 ? 'Selamat Sore' : 'Selamat Malam';
  return {
    date: `${get('day')}/${get('month')}/${get('year')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')} WIB`,
    greeting
  };
};

export const newRefId = (): string => `MLY-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
export const money = rupiah;
export const divider = (): string => theme.line;

export const banner = (): string => [
  theme.header(store.name),
  `   🌦️ ‧˚ʚ ${store.tagline} ɞ˚⋆  ⸝⸝\``
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
    theme.soft,
    ...section.items.map((item) => `   ${theme.bullet} ${item}`)
  ].join('\n'));

  return [
    greetingHeader(senderName),
    '',
    ...body,
    '',
    theme.footer.replace('%STORE%', store.name)
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

  const body = products.map((product) => [theme.line, '', productBlock(product)].join('\n')).join('\n\n');

  return [head, '', body, '', theme.line, '', `Ada ${products.length} produk ditampilkan.`].join('\n');
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
    lines.push(`   ${theme.bullet} Lain-lain — ${other.join(', ')}`);
  }

  return [
    header,
    ...lines,
    '',
    'Buka kategori (tanpa prefix):',
    ...categories.slice(0, 12).map((category) => `   • ${category.key}`).join(' ')
      .split('\n'),
    '',
    `Atau cari terus: \`${store.prefix}price [kata kunci]\``,
    '',
    theme.footer.replace('%STORE%', store.name)
  ].join('\n');
};

export const noProducts = (query: string): string => [
  `╭╸ ⃘✿ *produk tidak dijumpai*`,
  `│ Carian : ${query || '-'}`,
  '│ Cuba kata kunci lain, cth: `ml`, `pubg`, `telkomsel`',
  `╰╸ ֹ ${store.prefix}price [kata kunci]`
].join('\n');

export const paymentInfo = (): string => {
  const lines = [
    'ᥫ᭡ ˖ ࣪ ‹ 𖥔 payment ‧˚ʚ ' + store.name + ' ɞ˚⋆｡',
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
  if (order.serial) lines.push('', '──〔 *SERIAL NUMBER* 〕──', order.serial);
  if (order.message) lines.push('', `_${order.message}_`);
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

export const howToOrder = (): string => [
  '📖〔 *CARA ORDER* 〕📖',
  '',
  '1. Taip kategori, cth `ml` atau `pubg`',
  `2. Pilih kod produk, cth \`60UC\``,
  `3. Order: \`${store.keyword} [kode] [target]\``,
  '4. Bot akan hantar status transaksi',
  '',
  'Contoh:',
  `\`${store.keyword} 60UC 5123456789\``,
  `\`${store.keyword} 60UC 5123456789 2x\``,
  '',
  `Semak status: \`${store.prefix}status [trxid]\``
].join('\n');

export const terms = (): string => [
  '📜〔 *SYARAT & PERATURAN* 〕📜',
  '',
  `1. Pastikan data target betul sebelum order.`,
  '2. Order salah target tidak boleh refund.',
  '3. Proses 1-5 minit (maksimum 24 jam jika gangguan).',
  '4. Simpan Trxid untuk semakan.',
  `5. Deposit tidak boleh dipulangkan.`,
  ...(store.rules ? ['', store.rules] : [])
].join('\n');

export const staffInfo = (): string => [
  '👑〔 *OWNER / STAFF* 〕👑',
  '',
  `> Nama : ${store.ownerName}`,
  ...(store.ownerContact ? [`> Hubungi : ${store.ownerContact}`] : []),
  '',
  'Untuk komplen, refund atau order manual.'
].join('\n');

export const uptimeInfo = (uptimeMs: number, startedAt: string, style: string): string => {
  const seconds = Math.floor(uptimeMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [
    '⚡〔 *BOT STATUS* 〕⚡',
    '',
    `> Uptime : ${hours}j ${minutes}m`,
    `> Mula : ${startedAt}`,
    `> Wording : ${style}`,
    `> Masa : ${now().time}`
  ].join('\n');
};

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

export interface CategoryLine {
  key: string;
  label: string;
  total: number;
  active: number;
  inactive: number;
}

const statusBadge = (active: number, inactive: number): string =>
  inactive === 0 ? 'Aktif penuh ✅' : active === 0 ? 'Nonaktif ⛔' : `${active} aktif / ${inactive} nonaktif ⚠️`;

export const categoryOverview = (senderName: string, lines: CategoryLine[]): string => {
  const body = lines.map((line) =>
    `   ${theme.bullet} *${line.label}* — ${line.total} produk · ${statusBadge(line.active, line.inactive)}\n     \`${line.key}\``);

  return [
    greetingHeader(senderName),
    '',
    '      ⤿ ֵ ˳  ᴋᴀᴛᴇɢᴏʀɪ',
    theme.soft,
    ...body,
    '',
    'Ketik nama kategori untuk lihat subkategori.',
    `Contoh: \`ml\` · \`pln\` · \`pulsa\``,
    '',
    theme.footer.replace('%STORE%', store.name)
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
  `> Jumlah : ${category.total} produk`,
  `> Status : ${statusBadge(category.active, category.inactive)}`,
  '',
  theme.soft,
  ...lines.map((line) => `   ${theme.bullet} ${line.label} — ${line.total} produk · ${statusBadge(line.active, line.inactive)}\n     \`${line.key}\``),
  '',
  'Ketik subkategori untuk lihat produk.',
  `Tapis: \`${store.prefix}aktif ${category.label}\` atau \`${store.prefix}nonaktif ${category.label}\``
].join('\n');

export const filterNotice = (mode: 'all' | 'active' | 'inactive', label: string): string =>
  mode === 'active'
    ? `✅ Menunjuk produk *aktif* sahaja untuk ${label}.`
    : mode === 'inactive'
      ? `⛔ Menunjuk produk *nonaktif/gangguan* untuk ${label}.`
      : `📦 Semua produk untuk ${label}.`;
