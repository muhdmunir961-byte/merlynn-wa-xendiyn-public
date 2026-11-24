const env = (key: string, fallback = ''): string => (process.env[key] ?? fallback).trim();

export interface TranscriptionResult {
  text: string;
  model: string;
}

export const sttConfigured = (): boolean => Boolean(env('STT_BASE_URL'));

/**
 * Speech-to-text against any OpenAI-compatible audio transcription endpoint
 * (faster-whisper-server, whisper.cpp server, OpenAI audio API).
 */
export const transcribe = async (audio: Buffer, filename = 'voice.ogg'): Promise<TranscriptionResult> => {
  const baseUrl = env('STT_BASE_URL').replace(/\/$/, '');
  if (!baseUrl) throw new Error('STT belum dikonfigurasi');

  const model = env('STT_MODEL', 'whisper-1');
  const apiKey = env('STT_API_KEY');
  const language = env('STT_LANGUAGE', 'id');
  const timeoutMs = Number(env('STT_TIMEOUT_MS', '60000'));

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/ogg' }), filename);
  form.append('model', model);
  if (language) form.append('language', language);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
      body: form,
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`STT HTTP ${response.status}`);
    const payload = (await response.json()) as { text?: unknown };
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) throw new Error('STT pulangkan teks kosong');
    return { text, model };
  } finally {
    clearTimeout(timer);
  }
};
