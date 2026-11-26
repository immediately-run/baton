import ts from 'typescript';

const METHOD = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/;
const ROUTERS = new Set(['route', 'runnerRoute', 'adminRoute', 'courierRoute', 'sequenceRoute']);
const METHOD_SUBJECTS = ['m', 'req.method'];
const unwrap = (expr) => ts.isParenthesizedExpression(expr) ? unwrap(expr.expression) : expr;

function methodTest(expr, operator, subjects) {
  return ts.isBinaryExpression(expr) && expr.operatorToken.kind === operator
    && ts.isStringLiteral(expr.right) && subjects.includes(expr.left.getText())
    && METHOD.test(expr.right.text) ? expr.right.text : null;
}

/** The read dispatcher's opening rejection guard is the source of the GET/HEAD expansion. */
export function readMethods(source) {
  const file = ts.createSourceFile('reads.ts', source, ts.ScriptTarget.Latest, true);
  const dispatch = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'dispatchRead');
  const guard = dispatch?.body?.statements[0];
  if (!guard || !ts.isIfStatement(guard) || !ts.isReturnStatement(guard.thenStatement)
      || guard.thenStatement.expression?.kind !== ts.SyntaxKind.NullKeyword) {
    throw new Error('cannot determine the methods accepted by dispatchRead');
  }
  function accepted(expr) {
    expr = unwrap(expr);
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return [...accepted(expr.left), ...accepted(expr.right)];
    }
    const method = methodTest(expr, ts.SyntaxKind.ExclamationEqualsEqualsToken, ['req.method']);
    if (!method) throw new Error(`unsupported dispatchRead method guard: ${expr.getText()}`);
    return [method];
  }
  return [...new Set(accepted(guard.expression))];
}

// Positive method predicates form sets. Reject disjunctions mixing unrestricted and
// method-restricted branches: collecting paths separately would lose their correlation.
function positiveMethods(expr) {
  expr = unwrap(expr);
  if (!ts.isBinaryExpression(expr)) return null;
  const op = expr.operatorToken.kind;
  if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
    const left = positiveMethods(expr.left), right = positiveMethods(expr.right);
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      return left && right ? left.filter((method) => right.includes(method)) : left ?? right;
    }
    if (!left && !right) return null;
    if (!left || !right || !methodOnly(expr)) throw new Error(`unsupported route method alternatives: ${expr.getText()}`);
    return [...new Set([...left, ...right])];
  }
  const method = methodTest(expr, ts.SyntaxKind.EqualsEqualsEqualsToken, METHOD_SUBJECTS);
  return method ? [method] : null;
}

function methodOnly(expr) {
  expr = unwrap(expr);
  if (methodTest(expr, ts.SyntaxKind.EqualsEqualsEqualsToken, METHOD_SUBJECTS)) return true;
  return ts.isBinaryExpression(expr)
    && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(expr.operatorToken.kind)
    && methodOnly(expr.left) && methodOnly(expr.right);
}

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
        const ownMethods = guarded ? null : positiveMethods(n.expression);
        const positive = method && ownMethods ? method.filter((m) => ownMethods.includes(m)) : ownMethods ?? method;
        const guardMethods = [];
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
          const rejected = guarded && methodTest(expr, ts.SyntaxKind.ExclamationEqualsEqualsToken, METHOD_SUBJECTS);
          if (rejected) guardMethods.push(rejected);
          const subject = expr.left.getText(file);
          if (!guarded && op === ts.SyntaxKind.EqualsEqualsEqualsToken && ['p', 'path', 'url.pathname', 'rest', 'view'].includes(subject)) {
            paths.push(prefix(subject) + value);
          }
        }
        condition(n.expression);
        for (const path of paths.filter((p) => p.startsWith('/v1/'))) {
          // The legacy early-return form is `if (!match || method !== 'POST') return null`.
          const guard = unwrap(n.expression);
          if (guarded && (guardMethods.length !== 1 || !ts.isBinaryExpression(guard)
            || guard.operatorToken.kind !== ts.SyntaxKind.BarBarToken)) throw new Error(`unsupported route method guard for ${path}`);
          const methods = guarded ? guardMethods : positive;
          if (!methods) throw new Error(`cannot determine HTTP method for ${path}`);
          for (const m of methods) routes.add(routeKey(m, path));
        }
        visit(n.thenStatement, positive);
        if (n.elseStatement) visit(n.elseStatement, method);
      } else {
        ts.forEachChild(n, (child) => { visit(child, method); });
      }
    }
    // B-272: a routes/ function may open with `if (!p.startsWith(…) || req.method !== 'POST')
    // return null`; the statements after it serve that one method.
    let method;
    for (const statement of node.body.statements) {
      if (ts.isIfStatement(statement) && ts.isReturnStatement(statement.thenStatement)
          && statement.thenStatement.expression?.kind === ts.SyntaxKind.NullKeyword) {
        const expr = unwrap(statement.expression);
        if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
          const rejected = methodTest(unwrap(expr.right), ts.SyntaxKind.ExclamationEqualsEqualsToken, METHOD_SUBJECTS);
          if (rejected && !ts.isIdentifier(unwrap(expr.left).operand ?? expr.left)) { method = [rejected]; continue; }
          // …or with `if (req.method !== 'POST' || url.pathname !== '/v1/…') return null`: one route.
          const left = methodTest(unwrap(expr.left), ts.SyntaxKind.ExclamationEqualsEqualsToken, METHOD_SUBJECTS);
          const right = unwrap(expr.right);
          if (left && ts.isBinaryExpression(right) && right.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
              && ts.isStringLiteral(right.right) && right.right.text.startsWith('/v1/') && ['p', 'url.pathname', 'path'].includes(right.left.getText(file))) {
            routes.add(routeKey(left, right.right.text));
            method = [left];
            continue;
          }
        }
      }
      visit(statement, method);
    }
  }
  function walk(node) {
    // B-272: the dispatchers are functions in src/core/routes/, beside any left as methods.
    const name = (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && node.body ? node.name?.getText(file) : null;
    if (name && (ROUTERS.has(name) || ts.isFunctionDeclaration(node) && /Route$/.test(name))) router(node);
    else ts.forEachChild(node, walk);
  }
  walk(file);
  return routes;
}
