import type { LlmProvider } from '../plugins/interfaces.js';

const env = (key: string, fallback = ''): string => (process.env[key] ?? fallback).trim();

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_PROMPT_CHARS = 6_000;
const MAX_CONTEXT_CHARS = 200;

// Byte-identical on every call so the server prompt cache always hits.
const DEFAULT_SYSTEM_PROMPT =
  'Kamu Merlynn, asisten toko top-up. Jawab 1-2 kalimat singkat, ikut bahasa user, jangan mengarang harga.';

const LANG_LINE: Record<'id' | 'en' | 'ms', string> = {
  id: ' (Indonesia).',
  en: ' (English).',
  ms: ' (Melayu).'
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
  private readonly deadlineMs: number;
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
    this.deadlineMs = Number(env('LLM_DEADLINE_MS', '2000')) || 2000;
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

    // Hard latency budget: the caller never waits longer than deadlineMs.
    const deadline = new AbortController();
    const budget = setTimeout(() => deadline.abort(), this.deadlineMs);
    try {
      const attempt = (baseUrl: string, model: string): Promise<string> =>
        this.deadlineMs < this.timeoutMs
          ? Promise.race([
              this.request(baseUrl, model, system, userContent),
              new Promise<string>((_, reject) => {
                deadline.signal.addEventListener('abort', () => reject(new Error('DEADLINE')));
              })
            ])
          : this.request(baseUrl, model, system, userContent);

      if (this.fallbackUrl && this.preferFallback() && (await this.fallbackHealthy())) {
        try {
          return await attempt(this.fallbackUrl, this.fallbackModel);
        } catch {
          this.healthyUntil = 0;
        }
      }
      return await attempt(this.baseUrl, this.model);
    } finally {
      clearTimeout(budget);
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
        max_tokens: 20,
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
