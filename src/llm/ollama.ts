import type { LlmProvider } from '../plugins/interfaces.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'llama3.2';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_PROMPT_CHARS = 6_000;
const MAX_CONTEXT_CHARS = 2_000;

const DEFAULT_SYSTEM_PROMPT = [
  'You are a helpful local assistant with a warm, anime-inspired style.',
  'Be concise, clear, and friendly, with light expressive wording when it fits.',
  'Do not claim access to tools, private data, real-world actions, or abilities you do not have.',
  'Do not provide unsafe instructions. If a request is unsafe or beyond your knowledge, say so plainly and suggest a safe alternative.'
].join(' ');

type OllamaResponse = {
  message?: {
    content?: unknown;
  };
};

const isEnabled = (value: string | undefined): boolean =>
  value?.trim().toLowerCase() === 'true' || value?.trim() === '1' || value?.trim().toLowerCase() === 'yes';

const trimTo = (value: string, maxChars: number): string => value.trim().slice(0, maxChars);

/** A credentials-free LLM provider backed by an Ollama instance running locally. */
export class OllamaLlmProvider implements LlmProvider {
  private readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly timeoutMs: number;

  constructor() {
    this.enabled = isEnabled(process.env.LLM_ENABLED);
    this.baseUrl = (process.env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.model = process.env.LLM_MODEL?.trim() || DEFAULT_MODEL;
    this.systemPrompt = process.env.LLM_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT;
    this.timeoutMs = DEFAULT_TIMEOUT_MS;
  }

  async complete(input: { prompt: string; context?: string }): Promise<string> {
    if (!this.enabled) {
      throw new Error('Ollama LLM is disabled; set LLM_ENABLED=true to enable it.');
    }

    const prompt = trimTo(input.prompt, MAX_PROMPT_CHARS);
    if (!prompt) {
      throw new Error('LLM prompt must not be empty.');
    }

    const context = input.context ? trimTo(input.context, MAX_CONTEXT_CHARS) : '';
    const userContent = context
      ? `Context:\n${context}\n\nRequest:\n${prompt}`
      : prompt;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: userContent }
          ]
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Ollama request failed with HTTP ${response.status}.`);
      }

      const data = (await response.json()) as OllamaResponse;
      const content = typeof data.message?.content === 'string' ? data.message.content.trim() : '';
      if (!content) {
        throw new Error('Ollama returned an empty response.');
      }
      return content;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`Ollama request timed out after ${this.timeoutMs} ms.`);
      }
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Ollama request failed.');
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const ollamaLlmProvider = new OllamaLlmProvider();
