import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true // Allows any host domain (or use ['zerogaurd-aupz.onrender.com'])
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true // Allows Render public domains during preview mode
  }
});
