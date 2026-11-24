import { AsyncLocalStorage } from 'node:async_hooks';
import { dictionaries, LANG_LABELS, SUPPORTED_LANGS, type Lang } from './dict.js';

export { LANG_LABELS, SUPPORTED_LANGS };
export type { Lang };

const env = (key: string, fallback = ''): string => (process.env[key] ?? fallback).trim();

export const defaultLang = (): Lang => normalizeLang(env('STORE_LANG', 'id')) ?? 'id';

export const normalizeLang = (value: string | undefined | null): Lang | undefined => {
  const clean = (value ?? '').trim().toLowerCase();
  if (!clean) return undefined;
  if (clean === 'id' || clean === 'in' || clean === 'ind' || clean === 'indonesia') return 'id';
  if (clean === 'en' || clean === 'eng' || clean === 'english') return 'en';
  return undefined;
};

/** Per-group language overrides, falling back to STORE_LANG. */
export class LanguageRegistry {
  private readonly overrides = new Map<string, Lang>();

  constructor(private readonly fallback: Lang = defaultLang()) {}

  get(jid?: string): Lang {
    if (!jid) return this.fallback;
    return this.overrides.get(jid) ?? this.fallback;
  }

  set(jid: string, lang: Lang): void {
    this.overrides.set(jid, lang);
  }

  clear(jid: string): void {
    this.overrides.delete(jid);
  }

  snapshot(): Record<string, Lang> {
    return Object.fromEntries(this.overrides);
  }

  restore(data: Record<string, string> | undefined): void {
    if (!data) return;
    for (const [jid, value] of Object.entries(data)) {
      const lang = normalizeLang(value);
      if (lang) this.overrides.set(jid, lang);
    }
  }
}

const fill = (template: string, vars?: Record<string, string | number>): string => {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
};

/**
 * Translate a dictionary key for the given language. Unknown keys fall back to
 * the Indonesian dictionary, then to the key itself, so a missing string never
 * throws inside a WhatsApp reply.
 */
export const t = (lang: Lang, key: string, vars?: Record<string, string | number>): string => {
  const primary = dictionaries[lang][key];
  const fallback = dictionaries.id[key];
  const chosen = primary ?? fallback;
  if (chosen === undefined) return key;
  return fill(chosen, vars);
};

export const hasKey = (lang: Lang, key: string): boolean => dictionaries[lang][key] !== undefined;

export const langLabel = (lang: Lang): string => LANG_LABELS[lang];

/**
 * Per-message language without threading a parameter through every wording
 * helper. The WhatsApp handler runs each incoming message inside runWithLang so
 * concurrent chats in different languages cannot leak into each other.
 */
const storage = new AsyncLocalStorage<Lang>();

export const runWithLang = <T>(lang: Lang, fn: () => T): T => storage.run(lang, fn);

export const currentLang = (): Lang => storage.getStore() ?? defaultLang();

/** Shorthand used by the wording module: translate with the active language. */
export const tr = (key: string, vars?: Record<string, string | number>): string =>
  t(currentLang(), key, vars);

