import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { bundleSecretGuard } from './scripts/bundle-secret-guard.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), bundleSecretGuard()],
  envPrefix: ['VITE_'],
})
