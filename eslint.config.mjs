import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
    {
        ignores: [
            'out/**',
            'node_modules/**',
            'models/**',
            '*.vsix',
        ],
    },
    js.configs.recommended,
    {
        languageOptions: {
            globals: {
                console: 'readonly',
                process: 'readonly',
            },
        },
    },
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
            'no-useless-escape': 'off',
        },
    },
];
