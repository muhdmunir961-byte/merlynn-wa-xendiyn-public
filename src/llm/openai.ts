import type { LlmProvider } from '../plugins/interfaces.js';

const env = (key: string, fallback = ''): string => (process.env[key] ?? fallback).trim();

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_PROMPT_CHARS = 6_000;
const MAX_CONTEXT_CHARS = 2_000;

const DEFAULT_SYSTEM_PROMPT = [
  'Kamu ialah Merlynn, pembantu AI kedai digital di WhatsApp.',
  'Gaya: mesra, natural seperti manusia, ringkas, sedikit anime.',
  'Bahasa: jawab dalam bahasa yang sama seperti mesej terakhir pengguna (Indonesia, Melayu atau English).',
  'Jangan campur bahasa dalam satu jawapan kecuali istilah produk.',
  'Jangan mengaku melakukan tindakan yang belum dilakukan.',
  'Jangan dedahkan token, API key atau rahsia sistem.',
  'Untuk transaksi, arahkan pengguna guna format order rasmi.'
].join(' ');

const LANG_LINE: Record<'id' | 'en' | 'ms', string> = {
  id: 'Balas dalam Bahasa Indonesia yang santai dan jelas.',
  en: 'Reply in clear, friendly English.',
  ms: 'Balas dalam Bahasa Melayu yang santai dan jelas.'
};

/** Rough language guess from the customer message; cheap and offline. */
export const detectLang = (text: string): 'id' | 'en' | 'ms' => {
  const lower = ` ${text.toLowerCase()} `;
  const hits = (words: string[]): number => words.filter((word) => lower.includes(` ${word} `)).length;
  const id = hits(['yang', 'tidak', 'sudah', 'belum', 'bisa', 'saja', 'juga', 'kak', 'bang', 'makasih', 'terima', 'kasih', 'harga', 'mau', 'gimana', 'berapa', 'iya', 'dong', 'bintang']);
  const ms = hits(['yang', 'tak', 'dah', 'belum', 'boleh', 'sahaja', 'juga', 'kak', 'harga', 'nak', 'macam', 'mana', 'berapa', 'ya', 'lah', 'kot']);
  const en = hits(['the', 'is', 'are', 'do', 'does', 'can', 'could', 'would', 'please', 'thanks', 'thank', 'you', 'price', 'how', 'much', 'want', 'need', 'order', 'buy', 'hello', 'hi']);
  if (en > id && en > ms) return 'en';
  if (ms > id) return 'ms';
  return 'id';
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
};

const isEnabled = (value: string | undefined): boolean =>
  ['true', '1', 'yes'].includes((value ?? '').trim().toLowerCase());

const trimTo = (value: string, maxChars: number): string => value.trim().slice(0, maxChars);

/**
 * Any OpenAI-compatible chat endpoint: llama.cpp server, Ollama (/v1),
 * vLLM, OpenRouter, or the Merlynn AI core itself.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  private readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly systemPrompt: string;
  private readonly timeoutMs: number;
  private readonly fallbackUrl: string;
  private readonly fallbackModel: string;
  private readonly langMode: 'auto' | 'id' | 'en' | 'ms';
  private readonly preferNode: boolean;
  private healthyUntil = 0;

  constructor() {
    this.enabled = isEnabled(process.env.LLM_ENABLED);
    this.baseUrl = (env('LLM_BASE_URL', 'http://127.0.0.1:11434') || 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.model = env('LLM_MODEL', 'qwen2.5:0.5b') || 'qwen2.5:0.5b';
    this.apiKey = env('LLM_API_KEY');
    this.systemPrompt = env('LLM_SYSTEM_PROMPT') || DEFAULT_SYSTEM_PROMPT;
    this.timeoutMs = Number(env('LLM_TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS))) || DEFAULT_TIMEOUT_MS;
    this.fallbackUrl = env('LLM_FALLBACK_URL').replace(/\/$/, '');
    this.fallbackModel = env('LLM_FALLBACK_MODEL') || this.model;
    const mode = env('LLM_LANG', 'auto').toLowerCase();
    this.langMode = mode === 'id' || mode === 'en' || mode === 'ms' ? mode : 'auto';
    this.preferNode = isEnabled(env('LLM_PREFER_FALLBACK'));
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async complete(input: { prompt: string; context?: string }): Promise<string> {
    if (!this.enabled) throw new Error('AI belum diaktifkan (LLM_ENABLED=false)');

    const prompt = trimTo(input.prompt, MAX_PROMPT_CHARS);
    if (!prompt) throw new Error('Prompt kosong');

    const context = input.context ? trimTo(input.context, MAX_CONTEXT_CHARS) : '';
    const userContent = context ? `Konteks:\n${context}\n\nMesej:\n${prompt}` : prompt;
    const lang = this.langMode === 'auto' ? detectLang(prompt) : this.langMode;
    const system = `${this.systemPrompt} ${LANG_LINE[lang]}`;

    // Prefer the fast node (phone/Termux) when it is reachable; fall back to the
    // always-on VPS endpoint. Probe is cached so we do not pay it per message.
    if (this.fallbackUrl && this.preferFallback() && (await this.fallbackHealthy())) {
      try {
        return await this.request(this.fallbackUrl, this.fallbackModel, system, userContent);
      } catch {
        this.healthyUntil = 0;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.request(this.baseUrl, this.model, system, userContent, controller.signal);
    } catch (error) {
      if (!this.fallbackUrl) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`LLM timeout selepas ${this.timeoutMs} ms`);
        }
        throw error instanceof Error ? error : new Error('LLM request gagal');
      }
      return await this.request(this.fallbackUrl, this.fallbackModel, system, userContent);
    } finally {
      clearTimeout(timer);
    }
  }

  private preferFallback(): boolean {
    if (!this.preferNode) return false;
    return this.healthyUntil > Date.now();
  }

  /** Cheap reachability probe, cached for HEALTH_TTL_MS. */
  private async fallbackHealthy(): Promise<boolean> {
    if (this.healthyUntil > Date.now()) return true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(`${this.fallbackUrl}/v1/models`, { signal: controller.signal });
      const ok = response.ok;
      this.healthyUntil = ok ? Date.now() + 30_000 : 0;
      return ok;
    } catch {
      this.healthyUntil = 0;
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(
    baseUrl: string,
    model: string,
    system: string,
    userContent: string,
    signal?: AbortSignal
  ): Promise<string> {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0.7,
        max_tokens: 80,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent }
        ]
      }),
      signal
    });

    if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
    const payload = (await response.json()) as ChatResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('LLM pulangkan jawapan kosong');
    return content.trim();
  }
}

export const llmProvider = new OpenAiCompatibleProvider();
