module.exports = {
    root: true,
    env: {
        browser: true,
        es2021: true,
    },
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
    plugins: ['@typescript-eslint'],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
    ],
    ignorePatterns: ['dist/', 'wailsjs/', 'src/**/*.d.ts'],
    rules: {
        'no-console': 'off',
        'no-control-regex': 'off',
        'no-undef': 'off',
        'no-mixed-spaces-and-tabs': 'off',
        'no-constant-condition': ['error', { checkLoops: false }],
        'prefer-const': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
    },
};