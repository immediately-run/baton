import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

/** This is a debt linter, not a SQL parser. Tokenize enough to ignore comments and string
 *  values, and to tell scalar MAX from aggregate MAX even with nested calls and subqueries. */
export function dialectUses(sql) {
  const tokens = [...sql.matchAll(/--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[\w$]+|[^\s]/g)]
    .map(([token]) => token)
    .filter((token) => !token.startsWith('--') && !token.startsWith('/*'));
  const words = tokens.map((token) => token.toUpperCase());
  const identifier = (word, legacyQuote = false) => {
    if (word == null || !/^[\w$"`\[']/.test(word)) return;
    if (word.startsWith('[')) return word.slice(1, -1);
    if (word.startsWith("'") && !legacyQuote) return;
    if (/^["`']/.test(word)) return word.slice(1, -1);
    return word;
  };
  const uses = [];
  for (const [i, word] of words.entries()) {
    const next = words[i + 1];
    if (identifier(word) === 'ROWID') uses.push('rowid');
    if (word === 'PRAGMA' && identifier(next, true) !== undefined) uses.push('PRAGMA');
    if (word === 'INSERT' && next === 'OR') uses.push('INSERT OR');
    if (word === 'IS') {
      let j = i + 1;
      while (words[j] === '(') j++;
      if (words[j] === '?') uses.push('IS ?');
    }
    if (word === 'COLLATE' && identifier(next, true) === 'NOCASE') uses.push('COLLATE NOCASE');
    if (next !== '(') continue;
    const fn = identifier(word);
    if (fn === 'LAST_INSERT_ROWID' || fn === 'CHANGES') uses.push(`${fn.toLowerCase()}()`);
    if (fn !== 'MAX' || words[i - 1] === '.') continue;
    let depth = 1;
    for (let j = i + 2; j < words.length && depth > 0; j++) {
      if (words[j] === '(') depth++;
      if (words[j] === ')') depth--;
      if (words[j] === ',' && depth === 1) {
        uses.push('scalar MAX');
        break;
      }
    }
  }
  return { uses, fingerprint: createHash('sha256').update(JSON.stringify(tokens)).digest('hex').slice(0, 16) };
}

/** Check literals wherever defined, composing known fragments across interpolation boundaries. */
export function sourceUses(path, text) {
  const findings = [];
  const add = (variants, line) => {
    const seen = new Set();
    for (const sql of variants) {
      const { uses, fingerprint } = dialectUses(sql);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      for (const kind of uses) findings.push({ key: `${path} | ${kind} | ${fingerprint}`, line });
    }
  };
  if (path.endsWith('.sql')) {
    // Migration statements may include a trigger body. Splitting isn't necessary: migrations
    // are immutable, and a change to their token stream should invalidate their exemptions.
    add([text], 1);
  } else {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const opaque = (node) => { visit(node); return [' ']; };
    const combine = (left, right) => {
      const variants = new Set();
      for (const a of left) for (const b of right) {
        variants.add(a + b);
        if (variants.size > 256) throw new Error(`${path}: too many static SQL variants in one expression`);
      }
      return [...variants];
    };
    const fragments = (node) => {
      if (ts.isStringLiteralLike(node)) return [node.text];
      if (ts.isParenthesizedExpression(node)) return fragments(node.expression);
      if (ts.isConditionalExpression(node)) {
        const yes = fragments(node.whenTrue);
        const no = fragments(node.whenFalse);
        if (yes || no) {
          visit(node.condition);
          return [...new Set([...(yes ?? opaque(node.whenTrue)), ...(no ?? opaque(node.whenFalse))])];
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = fragments(node.left);
        const right = fragments(node.right);
        if (left || right) return combine(left ?? opaque(node.left), right ?? opaque(node.right));
      }
      if (ts.isTemplateExpression(node)) {
        let variants = [node.head.text];
        for (const { expression, literal } of node.templateSpans) {
          variants = combine(variants, (fragments(expression) ?? opaque(expression)).map((part) => part + literal.text));
        }
        return variants;
      }
    };
    const visit = (node) => {
      const variants = fragments(node);
      if (variants) add(variants, source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
      else ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}

export function inventory(root) {
  const counts = {};
  const locations = {};
  for (const entry of readdirSync(join(root, 'src'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:[cm]?[jt]sx?|sql)$/.test(entry.name)) continue;
    const file = join(entry.parentPath, entry.name);
    const path = relative(root, file).split(sep).join('/');
    // SQL lives in the core, its host adapters and migrations. In particular, do not
    // expand templates in the CLI that generate whole JavaScript programs or YAML documents.
    if (!path.endsWith('.sql') && !/^src\/(?:core|cloudflare|local|migrations)\//.test(path)) continue;
    for (const { key, line } of sourceUses(path, readFileSync(file, 'utf8'))) {
      counts[key] = (counts[key] ?? 0) + 1;
      (locations[key] ??= []).push(`${path}:${line}`);
    }
  }
  return { counts, locations };
}

export function excess(counts, ceiling) {
  return Object.keys(counts).filter((key) => counts[key] > (ceiling[key] ?? 0)).sort();
}
