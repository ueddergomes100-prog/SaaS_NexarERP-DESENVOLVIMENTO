import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Duas entradas HTML pro mesmo app React (src/main.tsx): vendedor.html
      // e' o shell estatico proprio do app do vendedor externo, com
      // manifest/icone/apple-meta-tags DELE desde a primeira linha do HTML
      // -- ver o comentario no proprio arquivo pro motivo. firebase.json
      // reescreve /vendedor/** pra servir este arquivo em vez do index.html
      // padrao.
      input: {
        main: resolve(__dirname, 'index.html'),
        vendedor: resolve(__dirname, 'vendedor.html'),
      },
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
            if (id.includes('/xlsx/')) {
              // So a tela de Importar Produtos usa isso, e ela ja e'
              // lazy-loaded (appRoutesConfig.tsx) -- sem chunk proprio, o
              // fallback "vendor" abaixo juntaria essa lib pesada (~330KB)
              // no bundle que TODA pagina carrega, mesmo quem nunca abre
              // a importacao.
              return 'vendor-xlsx';
            }
            return 'vendor'; // other third-party dependencies
          }
        }
      }
    },
    chunkSizeWarningLimit: 1000
  }
})
