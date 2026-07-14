import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('firebase/')) {
              return 'vendor-firebase';
            }
            if (id.includes('recharts/') || id.includes('d3-') || id.includes('d3/')) {
              return 'vendor-recharts';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-lucide';
            }
            return 'vendor'; // other third-party dependencies
          }
        }
      }
    },
    chunkSizeWarningLimit: 1000
  }
})
