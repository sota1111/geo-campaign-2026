// 元の静的アプリのデータを public/data/<id>/ にコピーする（.js 形式は JSON に変換）。
// 実行: npm run copy-data（build の前に自動実行）
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..') // contests/dashboard
const contests = path.resolve(root, '..') // contests

/** id -> { src: 元アプリのデータフォルダ, files: [...] }
 *  files の要素: 'name.json' | 'name.geojson'（そのままコピー）
 *               { js: 'name.js', global: 'WINDOW_VAR', out: 'name.json' }（JS→JSON） */
const SOURCES = {
  odpt: {
    src: 'odpt-2026/app/web/data',
    files: [
      'index.json',
      'iida.json', 'kumamoto.json', 'tokushima.json', 'tokyo.json', 'toyama.json',
      'whatif_iida.json', 'whatif_kumamoto.json', 'whatif_tokushima.json', 'whatif_tokyo.json', 'whatif_toyama.json',
    ],
  },
  'udc-moritsuchi': { src: 'udc-2026/app/moritsuchi-watch/data', files: ['fills.geojson'] },
  'sat-a': { src: 'satellite-2026/app/proposal-a/data', files: ['sample.json'] },
  'sat-b': {
    src: 'satellite-2026/app/proposal-b/data',
    files: [
      { js: 'real.js', global: 'REAL', out: 'real.json' },
      { js: 'sample.js', global: 'SAMPLE', out: 'sample.json' },
    ],
  },
  'biz-business': {
    src: 'ichibiz-2026/app/business/web/data',
    files: [
      'index.json',
      'iida.json', 'kumamoto.json', 'tokushima.json', 'tokyo.json', 'toyama.json',
      'whatif_iida.json', 'whatif_kumamoto.json', 'whatif_tokushima.json', 'whatif_tokyo.json',
      'whatif_toyama.json',
    ],
  },
  'biz-idea': { src: 'ichibiz-2026/app/idea/data', files: ['lore.json', 'samples.json'] },
  'biz-realestate': { src: 'ichibiz-2026/app/realestate/web/data', files: ['tokushima.json', 'reinfolib.json'] },
}

let count = 0
for (const [id, def] of Object.entries(SOURCES)) {
  const srcDir = path.join(contests, def.src)
  const outDir = path.join(root, 'public', 'data', id)
  fs.mkdirSync(outDir, { recursive: true })
  for (const f of def.files) {
    if (typeof f === 'string') {
      fs.copyFileSync(path.join(srcDir, f), path.join(outDir, f))
    } else {
      const code = fs.readFileSync(path.join(srcDir, f.js), 'utf8')
      const sandbox = { window: {} }
      vm.runInNewContext(code, sandbox)
      const value = sandbox.window[f.global]
      if (value === undefined) throw new Error(`${f.js}: window.${f.global} が見つかりません`)
      fs.writeFileSync(path.join(outDir, f.out), JSON.stringify(value))
    }
    count++
  }
}
console.log(`copy-data: ${count} files -> public/data/<id>/`)
