export type Intent =
  | { kind: 'remember'; key: string; value: string }
  | { kind: 'forget'; key: string }
  | { kind: 'confirm' }
  | { kind: 'cancel' }
  | { kind: 'order'; sku: string; target: string; qty: number }
  | { kind: 'status'; refId: string }
  | { kind: 'search'; query: string }
  | { kind: 'payment' }
  | { kind: 'help' }
  | { kind: 'chat' };

const CLEAN = /[^\p{L}\p{N}\s]/gu;

const tokens = (text: string): string[] =>
  text.toLowerCase().replace(CLEAN, ' ').split(/\s+/).filter(Boolean);

const digits = (text: string): string[] =>
  (text.match(/\d{5,}/g) ?? []).sort((a, b) => b.length - a.length);

const skuLike = (text: string): string | undefined =>
  (text.split(/[\s,]+/).find((token) => /^[A-Za-z0-9._-]{2,}$/.test(token) && /\d/.test(token) && /[A-Za-z]/.test(token)));

const qtyOf = (text: string): number => {
  const match = /(\d+)\s*(x|kali)\b/i.exec(text);
  if (!match?.[1]) return 1;
  const qty = Number(match[1]);
  return Number.isFinite(qty) && qty > 0 ? Math.min(qty, 10) : 1;
};

const hasAny = (words: string[], list: string[]): boolean => words.some((word) => list.includes(word));

const ORDER_WORDS = ['order', 'beli', 'topup', 'top', 'isi', 'nak', 'mahu', 'mau', 'pesan', 'checkout'];
const STATUS_WORDS = ['status', 'semak', 'cek', 'tracking', 'trx', 'trxid'];
const PRICE_WORDS = ['ada', 'harga', 'price', 'cari', 'senarai', 'list', 'berapa', 'stok'];
const PAY_WORDS = ['bayar', 'payment', 'deposit', 'qris', 'dana', 'gopay', 'transfer'];
const HELP_WORDS = ['menu', 'bantuan', 'help', 'panduan', 'cara'];
const CONFIRM_WORDS = ['ya', 'yes', 'betul', 'confirm', 'teruskan', 'proceed', 'ok', 'okay', 'boleh'];
const CANCEL_WORDS = ['batal', 'cancel', 'tak', 'no', 'jangan', 'stop'];

/**
 * Deterministic natural-language routing. Runs before any LLM call so the
 * common store requests never wait on inference.
 */
export const classify = (raw: string): Intent => {
  const text = raw.trim();
  const lower = text.toLowerCase();
  const words = tokens(text);

  const remember = /^(ingat|simpan|remember)\b[\s:,-]*(.+)$/i.exec(text);
  if (remember?.[2]) {
    const body = remember[2].trim();
    const split = /^(.{2,40}?)\s*(?:=|:|ialah|adalah|tu)\s*(.+)$/i.exec(body);
    if (split?.[1] && split[2]) return { kind: 'remember', key: split[1].trim(), value: split[2].trim() };
    return { kind: 'remember', key: body.slice(0, 40), value: body };
  }

  const forget = /^(lupa|padam|forget)\b[\s:,-]*(.+)$/i.exec(text);
  if (forget?.[2]) return { kind: 'forget', key: forget[2].trim() };

  if (words.length <= 3 && hasAny(words, CONFIRM_WORDS)) return { kind: 'confirm' };
  if (words.length <= 3 && hasAny(words, CANCEL_WORDS)) return { kind: 'cancel' };

  const statusMatch = /(?:status|semak|cek)\s+(?:order\s+)?([A-Za-z0-9-]{6,})/i.exec(text);
  if (statusMatch?.[1] && hasAny(words, STATUS_WORDS)) {
    return { kind: 'status', refId: statusMatch[1] };
  }

  const sku = skuLike(text);
  const [target] = digits(text);
  if (sku && target && hasAny(words, ORDER_WORDS)) {
    return { kind: 'order', sku, target, qty: qtyOf(text) };
  }

  if (hasAny(words, PAY_WORDS)) return { kind: 'payment' };
  if (words.length <= 2 && hasAny(words, HELP_WORDS)) return { kind: 'help' };

  if (hasAny(words, PRICE_WORDS)) {
    const query = words.filter((word) => !PRICE_WORDS.includes(word)).join(' ').trim();
    return { kind: 'search', query: query || words[words.length - 1] || '' };
  }

  return { kind: 'chat' };
};
