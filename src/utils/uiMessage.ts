import type { WASocket } from '@whiskeysockets/baileys';

export interface ListRow {
  title: string;
  description?: string;
  rowId: string;
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

export interface ListOptions {
  title: string;
  text: string;
  footer?: string;
  buttonText?: string;
  sections: ListSection[];
  /** Text used when the client refuses interactive messages. */
  fallback: string;
}

export interface AdCardOptions {
  text: string;
  title: string;
  description: string;
  url: string;
  thumbnail?: Buffer;
}

const listSupported = (): boolean => (process.env.ENABLE_LIST_MESSAGES ?? 'true').toLowerCase() !== 'false';

/**
 * Best-effort native WhatsApp list message. WhatsApp frequently rejects native
 * lists for non-business accounts, so every call has a text fallback.
 */
export const sendList = async (
  socket: WASocket,
  jid: string,
  options: ListOptions
): Promise<'list' | 'fallback'> => {
  if (!listSupported()) return 'fallback';
  try {
    await socket.sendMessage(jid, {
      text: options.text,
      footer: options.footer ?? '',
      title: options.title,
      buttonText: options.buttonText ?? 'Buka Senarai',
      sections: options.sections.map((section) => ({
        title: section.title,
        rows: section.rows.map((row) => ({
          title: row.title.slice(0, 24),
          description: (row.description ?? '').slice(0, 72),
          rowId: row.rowId
        }))
      }))
    } as Parameters<WASocket['sendMessage']>[1]);
    return 'list';
  } catch {
    await socket.sendMessage(jid, { text: options.fallback });
    return 'fallback';
  }
};

/** Large link-preview card (fake ad banner) attached to a text message. */
export const sendAdCard = async (
  socket: WASocket,
  jid: string,
  options: AdCardOptions
): Promise<void> => {
  try {
    await socket.sendMessage(jid, {
      text: options.text,
      contextInfo: {
        matchedText: options.url,
        canonicalUrl: options.url,
        title: options.title,
        description: options.description,
        renderLargerThumbnail: true,
        ...(options.thumbnail ? { jpegThumbnail: options.thumbnail } : {})
      }
    } as Parameters<WASocket['sendMessage']>[1]);
  } catch {
    await socket.sendMessage(jid, { text: options.text });
  }
};

/** Parse a tapped list row id into a plain command. */
export const rowIdToCommand = (rowId: string, prefix: string): string | undefined => {
  if (!rowId) return undefined;
  if (rowId.startsWith('cmd:')) return `${prefix}${rowId.slice(4)}`;
  if (rowId.startsWith('cat:')) return rowId.slice(4);
  if (rowId.startsWith('sub:')) return rowId.slice(4);
  return undefined;
};
