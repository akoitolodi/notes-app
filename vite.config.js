import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const noopPath = path.resolve(__dirname, 'src/lib/noopModule.js');

/** Keep only modern .woff2 KaTeX fonts (strips redundant ~798 KB .woff and .ttf assets). */
function katexWoff2OnlyPlugin() {
  return {
    name: 'katex-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (id.replace(/\\/g, '/').endsWith('/katex/dist/katex.min.css')) {
        return {
          code: code.replace(/,url\([^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g, ''),
          map: null,
        };
      }
      return null;
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), katexWoff2OnlyPlugin()],
  resolve: {
    alias: {
      html2canvas: noopPath,
      canvg: noopPath,
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.PORT || 8080}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    minify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          dexie: ['dexie'],
          katex: ['katex'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
