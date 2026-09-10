import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  base: './',
  build: {
    rollupOptions: { input: { worksheet: path.resolve(__dirname, 'index.html'), workbench: path.resolve(__dirname, 'workbench.html') } },
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
