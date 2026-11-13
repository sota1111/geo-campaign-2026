// 第3回評価の集計: reports/ops/dashboard-eval-20261113/eval-01.json〜eval-10.json を読み、
// src/data/eval-r3.json に書く。JSON が1件も無い／使えない時は「未集計」（collected:false）を書く。
// usage: npm run eval3   （または node scripts/aggregate-eval3.mjs [評価JSONのフォルダ] [出力先]）
import fs from 'node:fs'
import path from 'node:path'
import { aggregate } from './eval3-lib.mjs'

const root = path.resolve(import.meta.dirname, '../../..')
const dir = path.resolve(process.argv[2] ?? path.join(root, 'reports/ops/dashboard-eval-20261113'))
const out = path.resolve(process.argv[3] ?? path.join(import.meta.dirname, '../src/data/eval-r3.json'))
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => /^eval-\d+\.json$/.test(f)).sort().map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') }))
  : []
const data = aggregate(files)
fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n')
console.log(`${data.collected ? '集計' : '未集計'}: 評価者 ${data.evaluatorCount}名（ファイル ${files.length}件）→ ${path.relative(process.cwd(), out)}`)
for (const w of data.warnings) console.warn('警告:', w)
