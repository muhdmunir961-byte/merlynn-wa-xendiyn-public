import type { LlmProvider } from '../plugins/interfaces.js';

const env = (key: string, fallback = ''): string => (process.env[key] ?? fallback).trim();

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_PROMPT_CHARS = 6_000;
const MAX_CONTEXT_CHARS = 2_000;

const DEFAULT_SYSTEM_PROMPT = [
  'Kamu ialah Merlynn, pembantu AI kedai digital di WhatsApp.',
  'Gaya: mesra, natural seperti manusia, ringkas, sedikit anime.',
  'Bahasa ikut pengguna (Melayu/Indonesia/English).',
  'Jangan mengaku melakukan tindakan yang belum dilakukan.',
  'Jangan dedahkan token, API key atau rahsia sistem.',
  'Untuk transaksi, arahkan pengguna guna format order rasmi.'
].join(' ');

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

  constructor() {
    this.enabled = isEnabled(process.env.LLM_ENABLED);
    this.baseUrl = (env('LLM_BASE_URL', 'http://127.0.0.1:11434') || 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.model = env('LLM_MODEL', 'qwen2.5:0.5b') || 'qwen2.5:0.5b';
    this.apiKey = env('LLM_API_KEY');
    this.systemPrompt = env('LLM_SYSTEM_PROMPT') || DEFAULT_SYSTEM_PROMPT;
    this.timeoutMs = Number(env('LLM_TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS))) || DEFAULT_TIMEOUT_MS;
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          temperature: 0.7,
          max_tokens: 220,
          messages: [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: userContent }
          ]
        }),
        signal: controller.signal
      });

      if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
      const payload = (await response.json()) as ChatResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error('LLM pulangkan jawapan kosong');
      return content.trim();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`LLM timeout selepas ${this.timeoutMs} ms`);
      }
      throw error instanceof Error ? error : new Error('LLM request gagal');
    } finally {
      clearTimeout(timer);
    }
  }
}

export const llmProvider = new OpenAiCompatibleProvider();
