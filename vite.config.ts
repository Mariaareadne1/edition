/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// EDITION_BASE lets the GitHub Pages workflow serve from /edition/.
export default defineConfig({
  base: process.env.EDITION_BASE ?? '/',
  plugins: [react()],
  worker: { format: 'es' },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
})
