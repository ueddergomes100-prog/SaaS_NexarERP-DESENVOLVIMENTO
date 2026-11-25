import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-empty': 'off',
      'no-unused-vars': 'off',
      'prefer-const': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      'react-refresh/only-export-components': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
      // Bloco B de seguranca (25/11/2026): pop-up so' pelo NexusSwal de
      // src/utils/alerts.ts (titulo e opcoes de selecao como texto, mensagem de
      // validacao escapada). O SweetAlert2 cru monta tudo como HTML.
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'sweetalert2',
          message: 'Use NexusSwal (e escaparHtml nos dados de cadastro dentro de html:) de src/utils/alerts.ts.',
          allowTypeImports: true,
        }],
      }],
    },
  },
  {
    files: ['src/utils/alerts.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // Backend (CommonJS). So' no-undef: nome usado sem existir derruba a rota
  // em produção sem resposta nenhuma -- foi o que aconteceu com
  // requirePlatformAdmin (2026-09-30 a 2026-10-05) sem nenhum gate acusar.
  {
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      'no-undef': 'error',
    },
  },
])
