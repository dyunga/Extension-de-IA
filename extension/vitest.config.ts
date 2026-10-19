import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    css: { include: /\.css\?inline$/ },
    globals: true,
    setupFiles: ['test/setup.ts']
  }
});
