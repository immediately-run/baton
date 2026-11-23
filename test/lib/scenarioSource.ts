import ts from 'typescript';

const SQL_TOKEN = /--[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"]|"")*"|'(?:[^']|'')*'|`(?:[^`]|``)*`|\[[^\]]*\]|<expression>|[\w$\u0080-\uffff]+|\S/g;
const IDENTIFIER = /^(?:[\w$\u0080-\uffff]+|["'`\[]|<expression>)/;

function* sqlWrites(text: string) {
  const tokens = (text.match(SQL_TOKEN) ?? []).filter((token) => !token.startsWith('--') && !token.startsWith('/*')).map((token) => token.toLowerCase());
  for (const [i, verb] of tokens.entries()) {
    if (!['insert', 'replace', 'delete', 'update'].includes(verb)) continue;
    let at = i + 1;
    if ((verb === 'insert' || verb === 'update') && tokens[at] === 'or') at += 2;
    if (verb === 'update') {
      if (tokens[i - 1] === 'do') continue; // UPSERT's update is part of the insert.
    } else if (tokens[at++] !== (verb === 'delete' ? 'from' : 'into')) continue;

    const command = tokens.slice(i, at).join(' ');
    let table = tokens[at++];
    if (!table || !IDENTIFIER.test(table)) continue;
    if (tokens[at] === '.' && IDENTIFIER.test(tokens[at + 1] ?? '')) {
      table += `.${tokens[at + 1]}`;
      at += 2;
    }
    if (verb === 'update') {
      if (tokens[at] === 'as') at += 2;
      if (tokens[at] === 'indexed' && tokens[at + 1] === 'by') at += 3;
      else if (tokens[at] === 'not' && tokens[at + 1] === 'indexed') at += 2;
      if (tokens[at] !== 'set') continue;
    }
    yield `${command} ${table}`;
  }
}

/** Inspect string literals rather than comments or regexes describing expected queries. */
export function scenarioSource(file: string, source: string) {
  const writes: { key: string; line: number }[] = [];
  const fixtures: number[] = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && /^(Repo|Home)$/.test(node.name?.text ?? '')) fixtures.push(line);
    const text = ts.isStringLiteralLike(node) ? node.text : ts.isTemplateExpression(node)
      ? node.head.text + node.templateSpans.map((span) => `<expression>${span.literal.text}`).join('') : '';
    for (const key of sqlWrites(text)) writes.push({ key, line });
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return { writes, fixtures };
}

export const scannerSample = [
  '// UPDATE tickets SET rank = 0',
  'const observed = /DELETE FROM claims/;',
  "rows(`WITH seed AS (SELECT 1) INSERT\n INTO claims SELECT * FROM seed`);",
  "rows(`UPDATE ${table} SET rank = 0`);",
  "rows('DELETE FROM tickets');",
  'class Home {}',
].join('\n');
