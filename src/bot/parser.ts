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
