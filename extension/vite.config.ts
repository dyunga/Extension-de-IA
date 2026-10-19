import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createManifest } from './manifest.config.js';
import { isCanonicalLocalClientToken } from './local-client-token.js';

function manifestPlugin(apiOrigin: string): Plugin {
  return {
    name: 'emit-manifest',
    generateBundle() {
      const manifest = createManifest(apiOrigin);
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(manifest, null, 2) });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiOrigin = env.VITE_API_ORIGIN;
  const localClientToken = env.VITE_LOCAL_CLIENT_TOKEN;
  if (!apiOrigin) throw new Error('VITE_API_ORIGIN is required');
  if (!localClientToken) throw new Error('VITE_LOCAL_CLIENT_TOKEN is required');
  if (!isCanonicalLocalClientToken(localClientToken)) {
    throw new Error('VITE_LOCAL_CLIENT_TOKEN must be the canonical unpadded base64url encoding of exactly 32 bytes');
  }
  return {
  plugins: [react(), manifestPlugin(apiOrigin)],
  define: {
    'import.meta.env.VITE_API_ORIGIN': JSON.stringify(apiOrigin),
    'import.meta.env.VITE_LOCAL_CLIENT_TOKEN': JSON.stringify(localClientToken)
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'service-worker': 'src/service-worker.ts',
        content: 'src/content/index.tsx'
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
};
});
