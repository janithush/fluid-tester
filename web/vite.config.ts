import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Replace html2canvas with an empty stub. jspdf dynamic-imports
      // it lazily but we never call the raster path, so the ~200KB
      // html2canvas + purify-dom chain is dead weight for the ESP32.
      'html2canvas': path.resolve(__dirname, './src/lib/html2canvas-stub.ts'),
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2019',
    cssCodeSplit: true,
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split the heavy pdf vendor code into its own chunk so the
        // initial app JS stays small for the ESP32 LittleFS flash.
        // The device loads index.html first; pdf-report is only
        // needed when the user clicks "Print Report".
        manualChunks: {
          react: ['react', 'react-dom'],
          pdf: ['jspdf', 'jspdf-autotable'],
        },
      },
    },
  },
})
