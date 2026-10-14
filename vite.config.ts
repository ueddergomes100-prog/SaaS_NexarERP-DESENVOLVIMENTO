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
            // So' o nucleo que TODA tela usa vai para o "vendor" comum. O resto
            // (jsPDF, pdf-lib, pdfjs, html2canvas, codigo de barras, lottie...)
            // fica sem grupo e o bundler o poe junto da tela que o importa --
            // antes um "return 'vendor'" generico juntava tudo num pacote de
            // 2,4 MB baixado ate' na tela de login, anulando os import()
            // dinamicos (Lighthouse de 14/10: app Vendas 59 no celular).
            if (/node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser)[\\/]/.test(id)) {
              return 'vendor';
            }
          }
        }
      }
    },
    chunkSizeWarningLimit: 1000
  }
})
