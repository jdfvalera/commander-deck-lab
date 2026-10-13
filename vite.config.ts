/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project site lives at /<repo-name>/
export default defineConfig({
  base: '/commander-deck-lab/',
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
});
