// 元の静的アプリのデータを public/data/<id>/ にコピーする（.js 形式は JSON に変換）。
// 実行: npm run copy-data（build の前に自動実行）
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..') // contests/dashboard
// 元アプリの置き場（contests/）。新しい案のソースがまだこのブランチに無い時は CONTESTS_ROOT で別の checkout の contests/ を指す
const contests = process.env.CONTESTS_ROOT ? path.resolve(process.env.CONTESTS_ROOT) : path.resolve(root, '..')

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

// ---- 新しい案（比較用・未選定）: 元の静的版を public/embedded/<id>/ にそのままコピーし、独立ページの iframe で開く ----
// 元の静的版は変更しない（コピーするだけ）。index.html だけ、unpkg の MapLibre（SRI付き）を同梱コピー
// （public/vendor/maplibre-gl/、node_modules の maplibre-gl）に差し替える。ネットに依存せず、バージョンも揃う。
/** id -> { src: 元アプリのフォルダ, files: ファイル／フォルダ（実行に要るものだけ。tests/・tools/・README は含めない） } */
const EMBEDS = {
  'sat-alpha': { src: 'satellite-2026/app/proposal-alpha', files: ['index.html', 'app.js', 'lib.js', 'style.css', 'data'] },
  'biz-business-nb': { src: 'ichibiz-2026/app/business-nb/web', files: ['index.html', 'app.js', 'lib.js', 'style.css', 'data'] },
  'biz-realestate-rn1': { src: 'ichibiz-2026/app/realestate-rn1/web', files: ['index.html', 'app.js', 'lib.js', 'style.css', 'data'] },
  'udc-aed': { src: 'udc-2026/app/aed-night', files: ['index.html', 'app.js', 'lib.js', 'style.css', 'data'] },
  'odpt-teiji': { src: 'odpt-2026/app-teiji/web', files: ['index.html', 'app.js', 'lib.js', 'style.css', 'data'] },
}
const vendorOut = path.join(root, 'public', 'vendor', 'maplibre-gl')
fs.mkdirSync(vendorOut, { recursive: true })
for (const f of ['maplibre-gl.js', 'maplibre-gl.css']) {
  fs.copyFileSync(path.join(root, 'node_modules', 'maplibre-gl', 'dist', f), path.join(vendorOut, f))
}
let embedCount = 0
for (const [id, def] of Object.entries(EMBEDS)) {
  const srcDir = path.join(contests, def.src)
  if (!fs.existsSync(srcDir)) throw new Error(`新しい案の元アプリが見つかりません: ${srcDir}（別 checkout にある場合は CONTESTS_ROOT=<その contests/> を指定）`)
  const outDir = path.join(root, 'public', 'embedded', id)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  for (const f of def.files) {
    const from = path.join(srcDir, f)
    const to = path.join(outDir, f)
    if (f === 'index.html') {
      let html = fs.readFileSync(from, 'utf8')
      html = html
        .replace(/<link rel="stylesheet" href="https:\/\/unpkg\.com\/maplibre-gl@[^"]*maplibre-gl\.css"[^>]*>/, '<link rel="stylesheet" href="../../vendor/maplibre-gl/maplibre-gl.css">')
        .replace(/<script src="https:\/\/unpkg\.com\/maplibre-gl@[^"]*maplibre-gl\.js"[^>]*><\/script>/, '<script src="../../vendor/maplibre-gl/maplibre-gl.js"></script>')
      // favicon の指定がない元ページは、favicon.ico の 404 が出るので空のアイコンを足す
      if (!/rel="icon"/.test(html)) html = html.replace('<head>', '<head>\n<link rel="icon" href="data:,">')
      fs.writeFileSync(to, html)
    } else {
      fs.cpSync(from, to, { recursive: true })
    }
    embedCount++
  }
}
console.log(`copy-data: ${embedCount} items -> public/embedded/<id>/（新しい案の静的版）`)

// ---- 提出文のみの案（IN1）: ポータルのカードから読めるよう、提出文を .txt にして public/submission/<id>/ に置く ----
const DOCS = { 'idea-in1': { src: 'ichibiz-2026/submission/idea-in1', files: ['title', 'problem', 'service', 'background'] } }
let docCount = 0
for (const [id, def] of Object.entries(DOCS)) {
  const outDir = path.join(root, 'public', 'submission', id)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  for (const f of def.files) {
    fs.copyFileSync(path.join(contests, def.src, `${f}.md`), path.join(outDir, `${f}.txt`))
    docCount++
  }
}
console.log(`copy-data: ${docCount} files -> public/submission/<id>/（提出文）`)
