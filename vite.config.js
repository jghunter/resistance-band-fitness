import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // Cache all JS/CSS/HTML so the app works offline
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
      manifest: {
        name: 'Resistance Band Training',
        short_name: 'RB Fitness',
        description: 'Resistance band workout tracker',
        theme_color: '#050810',
        background_color: '#050810',
        display: 'standal