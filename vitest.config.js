import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{js,jsx,ts,tsx}'],
      exclude: ['src/main.tsx'],
    },
  },
});
