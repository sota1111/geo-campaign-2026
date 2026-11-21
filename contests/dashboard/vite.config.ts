import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

const APP_IDS = [
  'odpt', 'udc-moritsuchi', 'sat-a', 'sat-b', 'biz-business', 'biz-idea', 'biz-realestate',
  // 新しい案（比較用・未選定。元の静的版を埋め込む）
  'sat-alpha', 'biz-business-nb', 'biz-realestate-rn1', 'odpt-teiji', 'udc-aed',
  // 審査待ちの案（元のソースが PR にだけある。ソースが無いビルドでは「審査待ち」の案内を出す）
  'sat-yabu', 'sat-sugi', 'odpt-kankou', 'odpt-kansui', 'odpt-kodure', 'biz-solar-guard',
]
const CONTEST_IDS = ['udc-2026', 'satellite-2026', 'ichibiz-2026', 'odpt-2026']
const root = import.meta.dirname

// マルチページ: ポータル index.html ＋ apps/<id>/index.html（別エントリ・別バンドル）
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(root, './src') } },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: path.resolve(root, 'index.html'),
        ...Object.fromEntries(CONTEST_IDS.map((id) => [`contest-${id}`, path.resolve(root, `contest/${id}/index.html`)])),
        ontology: path.resolve(root, 'ontology/index.html'),
        ...Object.fromEntries(APP_IDS.map((id) => [id, path.resolve(root, `apps/${id}/index.html`)])),
      },
    },
  },
  test: { environment: 'jsdom', globals: true },
})
