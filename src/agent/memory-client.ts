const env = (key: string, fallback = ''): string => (process.env[key] ?? fallback).trim();

export const memoryConfigured = (): boolean => Boolean(env('AI_CORE_URL'));

const authHeaders = (): Record<string, string> => {
  const token = env('AI_CORE_TOKEN');
  return {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };
};

export const rememberFact = async (key: string, value: string, tags: string[] = []): Promise<boolean> => {
  const base = env('AI_CORE_URL').replace(/\/$/, '');
  if (!base) return false;
  try {
    const response = await fetch(`${base}/api/memory`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ key, value, tags })
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const forgetFact = async (idOrKey: string): Promise<boolean> => {
  const base = env('AI_CORE_URL').replace(/\/$/, '');
  if (!base) return false;
  try {
    const response = await fetch(`${base}/api/memory/${encodeURIComponent(idOrKey)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const memoryContext = async (query: string): Promise<string> => {
  const base = env('AI_CORE_URL').replace(/\/$/, '');
  if (!base || !query.trim()) return '';
  try {
    const response = await fetch(`${base}/api/memory/search?q=${encodeURIComponent(query)}`, {
      headers: authHeaders()
    });
    if (!response.ok) return '';
    const payload = (await response.json()) as { records?: Array<{ key?: string; value?: string }> };
    const records = payload.records ?? [];
    return records
      .filter((record) => record.key && record.value)
      .map((record) => `- ${record.key}: ${record.value}`)
      .join('\n');
  } catch {
    return '';
  }
};
