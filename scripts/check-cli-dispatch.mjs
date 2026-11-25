import ts from 'typescript';
import { CLI_ENTRIES } from './cli-entries.mjs';

// esbuild checks explicit re-exports, not properties destructured from a dynamic namespace.
export function checkCliDispatch(source, entries = CLI_ENTRIES) {
  const ast = ts.createSourceFile('cli/baton.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments;
      const name = arg && ts.isStringLiteral(arg) && /^\.\.\/scripts\/(baton-[^/]+\.mjs)$/.exec(arg.text)?.[1];
      if (name) {
        const prop = node.parent.parent.parent;
        const decl = prop.parent;
        if (!ts.isAwaitExpression(node.parent) || !ts.isParenthesizedExpression(node.parent.parent) ||
            !ts.isPropertyAccessExpression(prop) || prop.name.text !== 'default' ||
            !ts.isVariableDeclaration(decl) || !ts.isObjectBindingPattern(decl.name)) {
          throw new Error(`build-cli: destructure the exports of ${name} at its import`);
        }
        const names = new Set(entries[name]?.flatMap(({ exports }) => exports));
        for (const element of decl.name.elements) {
          const key = element.propertyName ?? element.name;
          if (element.dotDotDotToken || !(ts.isIdentifier(key) || ts.isStringLiteral(key)) || !names.has(key.text)) {
            throw new Error(`build-cli: ${name} does not declare the dispatch export ${key.getText(ast)}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
