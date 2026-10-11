import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

function readLocalAccessToken() {
  const candidates = [resolve(process.cwd(), '.dev.vars'), resolve(process.cwd(), 'chat-ji-hoon', '.dev.vars')];
  for (const file of candidates) {
    try {
      const vars = readFileSync(file, 'utf8');
      const line = vars.split(/\r?\n/u).find((item) => /^\s*APP_ACCESS_TOKEN\s*=/u.test(item));
      const value = line?.slice(line.indexOf('=') + 1).trim();
      if (value) return value.replace(/^(?:"(.*)"|'(.*)')$/u, (_match, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
    } catch {
      // Try the repository root when previewing the app from its parent workspace.
    }
  }
  return '';
}

function localWorkerProxy(): Record<string, ProxyOptions> {
  const token = readLocalAccessToken();
  return {
    '/api': {
      target: 'http://127.0.0.1:8787',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/u, ''),
      configure(proxy) {
        proxy.on('proxyReq', (proxyRequest) => {
          if (token) proxyRequest.setHeader('Authorization', `Bearer ${token}`);
        });
      },
    },
  };
}

export default defineConfig({
  // Relative asset URLs work for both a custom domain and /<repository>/ Pages URL.
  base: './',
  plugins: [react()],
  server: { proxy: localWorkerProxy() },
  preview: { proxy: localWorkerProxy() },
});
