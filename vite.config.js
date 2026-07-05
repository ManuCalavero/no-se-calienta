import { defineConfig } from 'vite'

// Use the repository name as base path only in CI (GitHub Pages).
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/no-se-calienta/' : '/',
})
