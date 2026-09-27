import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    root: 'src/client',
    plugins: [react()],
    build: {
      outDir: '../../out/client',
      emptyOutDir: true,
    },
    server: {
      proxy: {
        '^/api/': `http://${env.HOST ?? '127.0.0.1'}:${env.PORT ?? 3000}`,
      },
    },
  };
});
