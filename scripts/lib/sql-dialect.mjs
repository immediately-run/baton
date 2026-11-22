import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

/** This is a debt linter, not a SQL parser. Tokenize enough to ignore comments and string
 *  values, and to tell scalar MAX from aggregate MAX even with nested calls and subqueries. */
export function dialectUses(sql) {
  const tokens = [...sql.matchAll(/--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|\[[^\]]*\]|[\w$]+|[^\s]/g)]
    .map(([token]) => token)
    .filter((token) => !token.startsWith('--') && !token.startsWith('/*'));
  const words = tokens.map((token) => token.toUpperCase());
  const uses = [];
  for (const [i, word] of words.entries()) {
    const next = words[i + 1];
    if (word === 'ROWID' || /^(["`])ROWID\1$|^\[ROWID\]$/.test(word)) uses.push('rowid');
    if (word === 'PRAGMA' && next && /^[\w"`[]/.test(next)) uses.push('PRAGMA');
    if (word === 'INSERT' && next === 'OR') uses.push('INSERT OR');
    if (word === 'IS' && next === '?') uses.push('IS ?');
    if (word === 'COLLATE' && ['NOCASE', '"NOCASE"', '`NOCASE`', '[NOCASE]'].includes(next)) uses.push('COLLATE NOCASE');
    if (next !== '(') continue;
    if (word === 'LAST_INSERT_ROWID' || word === 'CHANGES') uses.push(`${word.toLowerCase()}()`);
    if (word !== 'MAX' || words[i - 1] === '.') continue;
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

/** Check source literals wherever defined, not just argument 1 of exec(). Template expressions
 *  count as opaque values, but their own string fragments are scanned too. */
export function sourceUses(path, text) {
  const findings = [];
  const add = (sql, line) => {
    const { uses, fingerprint } = dialectUses(sql);
    for (const kind of uses) findings.push({ key: `${path} | ${kind} | ${fingerprint}`, line });
  };
  if (path.endsWith('.sql')) {
    // Migration statements may include a trigger body. Splitting isn't necessary: migrations
    // are immutable, and a change to their token stream should invalidate their exemptions.
    add(text, 1);
  } else {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const staticText = (node) => {
      if (ts.isStringLiteralLike(node)) return node.text;
      if (ts.isParenthesizedExpression(node)) return staticText(node.expression);
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = staticText(node.left);
        const right = staticText(node.right);
        if (left !== undefined && right !== undefined) return left + right;
      }
    };
    const visit = (node) => {
      const line = () => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const literal = staticText(node);
      if (literal !== undefined) add(literal, line());
      else if (ts.isTemplateExpression(node)) {
        add(node.head.text + node.templateSpans.map((span) => ` ${span.literal.text}`).join(''), line());
        for (const span of node.templateSpans) visit(span.expression);
      } else ts.forEachChild(node, visit);
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
    if (path.startsWith('src/shared/') || path.startsWith('src/dashboard/dist/')) continue;
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
