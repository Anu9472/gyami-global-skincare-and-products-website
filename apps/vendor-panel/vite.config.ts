import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: mode === 'production' ? '/vendor/' : '/',
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'data-vendor': ['@tanstack/react-query'],
            'forms-vendor': ['react-hook-form', '@hookform/resolvers', 'zod'],
            'icons-vendor': ['lucide-react'],
          },
        },
      },
    },
    server: {
      port: 5174,
      proxy: {
        '/api': {
          target: environment.VITE_DEV_API_TARGET || 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      globals: true,
    },
  };
});
