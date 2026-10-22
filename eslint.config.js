import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '.data/**'] },
  js.configs.recommended, ...tseslint.configs.recommended,
  { files: ['**/*.{js,ts,tsx}'], languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', setTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly' } } },
  { files: ['apps/admin-console/**/*.tsx'], plugins: { 'react-hooks': hooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' } },
);
