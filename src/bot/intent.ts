import type { LlmProvider } from '../plugins/interfaces.js';

export interface OrderIntent {
  sku: string;
  target: string;
  qty: number;
}

const env = (key: string, fallback = ''): string => (process.env[key] ?? fallback).trim();

export const wakeWord = (): string => env('WAKE_WORD', 'merlynn').toLowerCase();

/** Remove the wake word and return the remaining instruction, or undefined if absent. */
export const stripWakeWord = (text: string): string | undefined => {
  const cleaned = text.trim();
  if (!cleaned) return undefined;
  const needle = wakeWord();
  const lower = cleaned.toLowerCase();
  const index = lower.indexOf(needle);
  if (index === -1) return undefined;
  const rest = cleaned.slice(index + needle.length).replace(/^[\s,.:;!?-]+/, '').trim();
  return rest || '';
};

const cleanupTarget = (value: string): string => value.replace(/[^\d]/g, '');

const parseQty = (text: string): number => {
  const match = /(\d+)\s*(x|kali)\b/i.exec(text);
  if (!match?.[1]) return 1;
  const qty = Number(match[1]);
  return Number.isFinite(qty) && qty > 0 ? Math.min(qty, 10) : 1;
};

/** Heuristic extraction when the LLM is unavailable. */
export const heuristicIntent = (text: string): OrderIntent | undefined => {
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  const sku = tokens.find((token) => /^[A-Za-z0-9._-]{2,}$/.test(token) && /\d/.test(token) && /[A-Za-z]/.test(token));
  const numbers = tokens
    .map((token) => cleanupTarget(token))
    .filter((digits) => digits.length >= 6)
    .sort((a, b) => b.length - a.length);
  const target = numbers[0];
  if (!sku || !target) return undefined;
  return { sku, target, qty: parseQty(text) };
};

const prompt = (text: string): string => [
  'Tukar ayat pelanggan kepada JSON order.',
  'Balas HANYA JSON: {"sku":"","target":"","qty":1}',
  'sku = kod produk yang disebut (huruf+angka, contoh MLID500, 60UC, TSEL20).',
  'target = nombor/ID tujuan tanpa ruang.',
  'qty = kuantiti, default 1.',
  'Jika bukan order, balas {"sku":""}',
  '',
  `Ayat: ${text}`
].join('\n');

/** Deterministic parser first (fast), LLM only as a fallback. */
export const extractOrderIntent = async (text: string, llm?: LlmProvider): Promise<OrderIntent | undefined> => {
  const heuristic = heuristicIntent(text);
  if (heuristic) return heuristic;
  if (!llm) return undefined;
  try {
    const answer = await llm.complete({ prompt: prompt(text), context: 'intent-extraction' });
    const json = /\{[\s\S]*\}/.exec(answer)?.[0];
    if (!json) return undefined;
    const parsed = JSON.parse(json) as { sku?: unknown; target?: unknown; qty?: unknown };
    const sku = typeof parsed.sku === 'string' ? parsed.sku.trim() : '';
    const target = typeof parsed.target === 'string' ? cleanupTarget(parsed.target) : '';
    const qtyRaw = Number(parsed.qty);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.min(qtyRaw, 10) : 1;
    if (sku && target.length >= 5) return { sku, target, qty };
  } catch {
    return undefined;
  }
  return undefined;
};
