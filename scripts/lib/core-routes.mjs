import ts from 'typescript';

const METHOD = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/;
const ROUTERS = new Set(['route', 'runnerRoute', 'adminRoute', 'courierRoute', 'sequenceRoute']);

// The legacy dispatchers use exact string tests or anchored segment regexes. Normalize only
// the forms used by those guards; a new regex grammar must be taught to the checker explicitly.
function regexPaths(text) {
  const m = /^\/\^(.+)\$\/$/.exec(text);
  if (!m) throw new Error(`route regex must be anchored: ${text}`);
  const pattern = m[1].replaceAll('\\/', '/').replace(/\(?(?:\[\^\/\]\+|\\d\+)\)?/g, '{}');
  const paths = pattern.split(/(\([\w-]+(?:\|[\w-]+)+\))/).reduce((paths, part) => {
    const alternatives = part.startsWith('(') ? part.slice(1, -1).split('|') : [part];
    return paths.flatMap((path) => alternatives.map((suffix) => path + suffix));
  }, ['']);
  if (paths.some((path) => !/^[\w/{}-]+$/.test(path))) throw new Error(`unsupported route regex: ${text}`);
  return paths;
}

export function routeKey(method, path) {
  return `${method} ${path.replace(/\{[^}]*\}/g, '{}')}`;
}

/** Read dispatch guards, not comments, frontend forwarding prefixes or action declarations. */
export function legacyRoutes(source) {
  const file = ts.createSourceFile('baton.ts', source, ts.ScriptTarget.Latest, true);
  const routes = new Set();
  function router(node) {
    const bindings = new Map();
    const prefix = (subject) => subject === 'rest' ? '/v1/owner/{}/' : subject === 'view' ? '/v1/runner/' : '';
    const isMethod = (expr) => ['m', 'req.method'].includes(expr.getText(file));
    function visit(n, method) {
      if (ts.isVariableDeclaration(n) && n.initializer && ts.isCallExpression(n.initializer)) {
        const call = n.initializer;
        if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'exec'
          && ts.isRegularExpressionLiteral(call.expression.expression) && call.arguments.length === 1) {
          const subject = call.arguments[0].getText(file);
          if (['p', 'url.pathname', 'rest'].includes(subject)) bindings.set(n.name.getText(file), { subject, regex: call.expression.expression.text });
        }
      }
      if (ts.isIfStatement(n)) {
        const paths = [];
        const guarded = ts.isReturnStatement(n.thenStatement) && n.thenStatement.expression?.kind === ts.SyntaxKind.NullKeyword;
        let positiveMethod = method;
        let afterGuard = method;
        function condition(expr) {
          if (ts.isParenthesizedExpression(expr)) return condition(expr.expression);
          if (ts.isIdentifier(expr) && bindings.has(expr.text) && !guarded) {
            const { subject, regex } = bindings.get(expr.text);
            paths.push(...regexPaths(regex).map((path) => prefix(subject) + path));
          }
          if (guarded && ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken && ts.isIdentifier(expr.operand)) {
            const binding = bindings.get(expr.operand.text);
            if (binding) paths.push(...regexPaths(binding.regex).map((path) => prefix(binding.subject) + path));
          }
          if (!ts.isBinaryExpression(expr)) return;
          const op = expr.operatorToken.kind;
          if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
            condition(expr.left);
            condition(expr.right);
          }
          if (!ts.isStringLiteral(expr.right)) return;
          const value = expr.right.text;
          if (isMethod(expr.left) && METHOD.test(value)) {
            if (op === ts.SyntaxKind.EqualsEqualsEqualsToken) positiveMethod = value;
            if (guarded && op === ts.SyntaxKind.ExclamationEqualsEqualsToken) afterGuard = value;
          }
          const subject = expr.left.getText(file);
          if (!guarded && op === ts.SyntaxKind.EqualsEqualsEqualsToken && ['p', 'url.pathname', 'rest', 'view'].includes(subject)) {
            paths.push(prefix(subject) + value);
          }
        }
        condition(n.expression);
        for (const path of paths.filter((p) => p.startsWith('/v1/'))) {
          if (!(guarded ? afterGuard : positiveMethod)) throw new Error(`cannot determine HTTP method for ${path}`);
          routes.add(routeKey(guarded ? afterGuard : positiveMethod, path));
        }
        visit(n.thenStatement, positiveMethod);
        if (n.elseStatement) visit(n.elseStatement, method);
      } else {
        ts.forEachChild(n, (child) => { visit(child, method); });
      }
    }
    visit(node.body);
  }
  function walk(node) {
    if (ts.isMethodDeclaration(node) && node.body && ROUTERS.has(node.name.getText(file))) router(node);
    else ts.forEachChild(node, walk);
  }
  walk(file);
  return routes;
}
