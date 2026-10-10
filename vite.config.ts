import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  // Relative asset URLs work for both a custom domain and /<repository>/ Pages URL.
  base: './',
  plugins: [react()],
});
