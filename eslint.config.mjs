import { basename } from 'node:path';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import manifest from './src/shared/manifest.json' with { type: 'json' };

const fileName = {
  meta: { schema: [{ type: 'string' }] },
  create(context) {
    const pattern = new RegExp(`^(?:${context.options[0]})(?:\\.(?:test|config|d))?\\.(?:[cm]?[jt]s|[jt]sx)$`);
    return {
      Program(node) {
        const name = basename(context.filename);
        if (!pattern.test(name)) context.report({ node, message: `File name '${name}' must match ${pattern.source}.` });
      },
    };
  },
};

const camel = '[a-z][a-zA-Z0-9]*';
const kebab = '[a-z0-9]+(?:-[a-z0-9]+)*';
const markup = {
  selector: 'MemberExpression[computed=false][property.name="innerHTML"], MemberExpression[computed=true][property.value="innerHTML"], JSXAttribute[name.name="dangerouslySetInnerHTML"]',
  message: 'Render text, not markup; use textContent or React text nodes.',
};

export default defineConfig([
  globalIgnores([
    '**/dist/', '.wrangler/', '.local/', '_apalache-out/', 'test/.traces/', 'test/fixtures/',
    // Checked-in esbuild bundles: lint the source that produces them.
    '.baton/tickets.mjs', '.baton/courses/create-pr/legs/*.mjs',
    ...Object.keys(manifest.files).map((file) => `src/shared/${file}`),
  ]),
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
    plugins: { baton: { rules: { 'file-name': fileName } } },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-restricted-syntax': ['error', markup],
      'baton/file-name': ['error', camel],
    },
  },
  {
    files: ['**/*.{ts,mts,cts,tsx,jsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    // ESLint's suppression file caps existing explicit any uses without disabling the rule.
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: ['src/core/**/*'],
    rules: {
      'no-restricted-syntax': ['error', markup, {
        selector: 'MemberExpression[object.name="Date"][computed=false][property.name="now"], MemberExpression[object.name="Date"][computed=true][property.value="now"]',
        message: 'Use the injected clock (R-BTN-32), not Date.now.',
      }],
    },
  },
  { files: ['src/dashboard/**/*.tsx'], rules: { 'baton/file-name': ['error', '[a-zA-Z][a-zA-Z0-9]*'] } },
  { files: ['src/defaults/**/*', 'scripts/**/*', '.baton/**/*'], rules: { 'baton/file-name': ['error', kebab] } },
  { files: ['test/**/*'], rules: { 'baton/file-name': ['error', `${camel}|${kebab}`] } },
  { files: ['test/{integration,ui}/**/*'], rules: { 'baton/file-name': ['error', `(?:S-BTN|B)-[0-9]+\\.${kebab}|${camel}|${kebab}`] } },
  { files: ['scripts/lib/**/*'], rules: { 'baton/file-name': ['error', camel] } },
]);
