import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vercel and local dev serve from root; GitHub Pages serves from /arr-flow/
  base: process.env.GITHUB_PAGES ? '/arr-flow/' : '/',
  server: {
    proxy: {
      '/hubspot-api': {
        target: 'https://api.hubapi.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hubspot-api/, ''),
      },
      '/api/fireflies': {
        target: 'https://api.fireflies.ai',
        changeOrigin: true,
        rewrite: () => '/graphql',
      },
    },
  },
})
