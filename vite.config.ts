// Build do front-end (sem framework: HTML + CSS + módulos ES). O Vite empacota e minifica app.js e os
// módulos, põe hash nos nomes e copia public/ (dados do TSE, área protegida, bibliotecas, ícones) como está.
import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'

// versão do build: data + commit curto (entra em <meta name="versao"> e na constante __VERSAO__ do app)
function versaoDoBuild() {
  let sha = ''
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {}
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${sha ? `-${sha}` : ''}`
}
const VERSAO = process.env.VERSAO || versaoDoBuild()

export default defineConfig({
  // caminhos relativos: o mesmo build serve no Vercel (raiz) e no GitHub Pages (/resultadoeleicao/)
  base: './',
  publicDir: 'public',
  define: { __VERSAO__: JSON.stringify(VERSAO) },
  plugins: [
    {
      name: 'meta-versao',
      transformIndexHtml: (html) => html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta name="versao" content="${VERSAO}">`),
    },
  ],
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    rollupOptions: { output: { manualChunks: { regioes: ['./regioes.js', './floripa.js'] } } },
  },
  server: {
    port: 5173,
    // a API roda à parte no desenvolvimento (npm run dev:api); no Vercel, /api é uma função serverless
    proxy: { '^/api/': { target: `http://localhost:${process.env.PORT || 8787}`, changeOrigin: true } },
  },
  preview: { port: 8765 },
})
