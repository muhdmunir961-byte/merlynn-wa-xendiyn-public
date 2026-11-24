export interface Theme {
  name: string;
  crown: string;
  header: (title: string) => string;
  line: string;
  soft: string;
  bullet: string;
  panel: (title: string, body: string[]) => string;
  footer: string;
}

const softTheme: Theme = {
  name: 'soft',
  crown: 'ﾟ ˖ ✦',
  header: (title) => `ﾟ ˖ ✦ : ⤿ ${title} ✦`,
  line: '━━━ • ━━━ • ━━━ • ━━━ • ━━━ •',
  soft: '꒰  ࣪. ━ׄ─ִ─ׁ─ִ─ׁ─𔕙─ׅ─ׁ─ׅ─ׁ─ׅ━ ˖ ࣪꒱',
  bullet: 'ᥴ⃘ᦱ ֹ',
  panel: (title, body) => [`╭╸ ۫ ⸼ ${title}`, ...body.map((line) => `│ ${line}`), '╰╸ ֹ ✧'].join('\n'),
  footer: '      ╭╸ ۫  ⸼ happy shopping  𝅄 ׄ\n      ╰╸ֵ ֹ ✦  %STORE% ✧ ׄ  ⃘✿'
};

const minimalTheme: Theme = {
  name: 'minimal',
  crown: '◆',
  header: (title) => `◆ ${title}`,
  line: '────────────────────────',
  soft: '────────────────────────',
  bullet: '•',
  panel: (title, body) => [`┌ ${title}`, ...body.map((line) => `│ ${line}`), '└─'].join('\n'),
  footer: '◆ %STORE% — happy shopping'
};

const monoTheme: Theme = {
  name: 'mono',
  crown: '[ ]',
  header: (title) => `[ ${title.toUpperCase()} ]`,
  line: '========================',
  soft: '------------------------',
  bullet: '-',
  panel: (title, body) => [`+-- ${title.toUpperCase()}`, ...body.map((line) => `| ${line}`), '+--'].join('\n'),
  footer: '[ %STORE% ] happy shopping'
};

const THEMES: Record<string, Theme> = {
  soft: softTheme,
  minimal: minimalTheme,
  mono: monoTheme
};

export const theme: Theme = THEMES[(process.env.WORDING_STYLE ?? 'soft').trim().toLowerCase()] ?? softTheme;
export const themeNames = Object.keys(THEMES);
