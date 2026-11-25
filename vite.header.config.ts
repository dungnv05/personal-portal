import { defineConfig } from 'vite'
import { bundleSecretGuard } from './scripts/bundle-secret-guard.mjs'

export default defineConfig({
  publicDir: false,
  plugins: [bundleSecretGuard()],
  define: {
    'import.meta.env.DEV': 'false',
  },
  build: {
    lib: {
      entry: 'src/yun-header/index.ts',
      formats: ['es'],
      fileName: 'yun-header',
    },
    outDir: 'public/vendor',
    emptyOutDir: false,
  },
})
