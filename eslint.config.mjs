import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/prisma/migrations/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Prefixo "_" é o jeito padrão de marcar um parâmetro intencionalmente
    // não usado (ex.: o "next" de um error handler do Express, que precisa
    // existir pra Express reconhecer a função como error handler).
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['frontend/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly' },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['backend/**/*.ts'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    // Globals de extensão Chrome — nunca configurados desde que a pasta foi
    // adicionada (commit "Adiciona extensao Chrome de coleta"), por isso todo
    // arquivo aqui falhava no-undef pra document/chrome/fetch/etc.
    files: ['browser-extension/**/*.js'],
    languageOptions: {
      globals: {
        chrome: 'readonly',
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Blob: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        setTimeout: 'readonly',
        AbortSignal: 'readonly',
        TextEncoder: 'readonly',
      },
    },
  },
  prettier,
);
