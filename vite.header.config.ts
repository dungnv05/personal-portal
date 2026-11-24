import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
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
