const js = require( '@eslint/js');
const { FlatCompat } = require('@eslint/eslintrc');
const globals = require('globals');


const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

module.exports = [...compat.extends('eslint:recommended'), {
    languageOptions: {
        globals: {
            Atomics: 'readonly',
            SharedArrayBuffer: 'readonly',
            ...globals.node,
        },

        ecmaVersion: 2018,
        sourceType: 'commonjs',
    },

    rules: {
        indent: ['error', 4],
        'linebreak-style': ['error', 'unix'],
        quotes: ['error', 'single'],
        semi: ['error', 'always'],
        'no-console': 'off',
        'no-unused-vars': ['error', { caughtErrors: 'none' }],
    },
}];
