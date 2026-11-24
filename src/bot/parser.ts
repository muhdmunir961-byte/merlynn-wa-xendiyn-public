export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

export function parseCommand(text: string, prefix = '.'): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(prefix)) return null;
  const body = trimmed.slice(prefix.length).trim();
  if (!body) return null;
  const parts = body.split(/\s+/);
  const name = parts.shift();
  if (!name) return null;
  return { name: name.toLowerCase(), args: parts, raw: body };
}

/**
 * Store orders are written without a prefix: `store_keyword SKU TARGET [qty]x`.
 */
export function parseOrder(text: string, keyword: string): ParsedCommand | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const needle = keyword.toLowerCase();
  if (!lower.startsWith(needle)) return null;
  const rest = trimmed.slice(needle.length);
  if (rest && !/^\s/.test(rest)) return null;
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return { name: 'order', args: parts, raw: rest.trim() };
}
