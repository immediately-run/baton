// sourceGate.ts — Decision 6a's source gate (B-193): the check itself, pure, over file text —
// no ESLint, one unit test the suite runs (§12.3's rendering rule, G-BTN-13). Two rules: the
// dashboard's source never contains a markup-parsing API, and neither the source nor the built
// bundle puts an `http(s)://` URL in a `src`, `href`, `url(` or `import` position — the bundle
// loads nothing from another origin.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** §12.3's rendering rule, as the patterns the dashboard's source refuses: React is the only
 *  code that touches the DOM, and no string is ever parsed as markup or run as code. */
export const MARKUP_APIS: ReadonlyArray<readonly [label: string, re: RegExp]> = [
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['innerHTML', /\binnerHTML\b/],
  ['outerHTML', /\bouterHTML\b/],
  ['insertAdjacentHTML', /\binsertAdjacentHTML\b/],
  ['document.write', /\bdocument\s*\.\s*write\b/],
  ['DOMParser', /\bDOMParser\b/],
  ['createContextualFragment', /\bcreateContextualFragment\b/],
  ['eval', /\beval\b/],
  ['new Function', /\bnew\s+Function\b/],
];

/** §12.3's origin rule: an `http(s)://` URL in a `src`, `href`, `url(` or `import` position —
 *  quoted or braced, HTML, TSX, CSS or TS alike. */
const REMOTE_URLS: ReadonlyArray<readonly [label: string, re: RegExp]> = [
  ['src', /\bsrc\s*=\s*[{("'`]?https?:\/\//i],
  ['href', /\bhref\s*=\s*[{("'`]?https?:\/\//i],
  ['url(', /\burl\(\s*[{("'`]?https?:\/\//i],
  ['import', /\bimport\b[^(;]*?[{("'` ]https?:\/\//i],
  ['import()', /\bimport\s*\(\s*[{("'`]?https?:\/\//i],
];

/** Every rule `text` breaks, one `name:line: what` per line of the file. */
function violations(name: string, text: string, rules: ReadonlyArray<readonly [label: string, re: RegExp]>): string[] {
  const out: string[] = [];
  text.split('\n').forEach((line, i) => {
    for (const [label, re] of rules) if (re.test(line)) out.push(`${name}:${i + 1}: ${label}`);
  });
  return out;
}

/** The source gate: every markup-parsing API and every remote URL, over one file's text. */
export const gateSource = (name: string, text: string): string[] =>
  violations(name, text, [...MARKUP_APIS, ...REMOTE_URLS]);

/** The bundle gate: the origin rule alone — `react-dom` itself contains `innerHTML`, so the
 *  built bundle answers only for what it loads, never for how it renders. */
export const gateBundle = (name: string, text: string): string[] => violations(name, text, REMOTE_URLS);

/** Every file under `src/dashboard`, `dist/` (the build's output, gateBundle's own input)
 *  apart. */
export function readDashboardSource(): { name: string; text: string }[] {
  const root = resolve(import.meta.dirname, '../../src/dashboard');
  const walk = (dir: string): { name: string; text: string }[] => {
    const out: { name: string; text: string }[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'dist') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else out.push({ name: full.slice(root.length + 1), text: readFileSync(full, 'utf8') });
    }
    return out;
  };
  return walk(root);
}
