import ts from 'typescript';

const WRITE = /\b(?:insert\s+(?:or\s+\w+\s+)?into|replace\s+into|delete\s+from|update(?:\s+or\s+\w+)?(?=\s+(?:\S+\s+)?set\b))\s+([^\s(;]+)/gi;

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
    for (const match of text.matchAll(WRITE)) {
      writes.push({ key: match[0].toLowerCase().replace(/\s+/g, ' '), line });
    }
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
