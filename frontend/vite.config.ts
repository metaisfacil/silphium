import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['src/**/*.test.ts'],
        clearMocks: true,
        restoreMocks: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: [
                'src/**/*.d.ts',
                'src/**/*.test.ts',
                'src/main.ts',
                'wailsjs/**',
            ],
        },
    },
});