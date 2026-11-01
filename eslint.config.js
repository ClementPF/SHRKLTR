import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      'SHRKLTR-BCKND/**',
      'elo/**',
      'apps/backend/drizzle/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
