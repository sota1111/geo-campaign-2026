// 「行けません」のときの次の一歩の確認（ヘッドレスChrome）。富山の実データから「平日朝30分で病院へ行けない」区画を探して開く。
//   node src/apps/odpt/verify-ng.mjs http://127.0.0.1:8871/ <スクリーンショットの出力先>
import fs from 'node:fs'
import path from 'node:path'
import { open } from './cdp.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:8871/'
const out = process.argv[3] ?? 'shots'
const d = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../../public/data/odpt/toyama.json'), 'utf8'))
// メッシュコード -> 中心の緯度経度（lib.ts の meshBounds と同じ式）
const center = (code) => {
  const p = +code.slice(0, 2), q = +code.slice(2, 4), r = +code[4], s = +code[5], t = +code[6], u = +code[7], m = +code[8] - 1
  const lat = (p * 2) / 3 + r / 12 + t / 120 + Math.floor(m / 2) / 240
  const lon = 100 + q + s / 8 + u / 80 + (m % 2) / 160
  return [lon + 1 / 320, lat + 1 / 480]
}
// 平日・朝(index 0)・病院(fi 0)・30分(need 3 of [20,30,45,60]→水準3)で行けず、人口が多く、ほかの時間帯か長い許容時間で行けるものを優先
const pick = (wantAlt) => d.cells.find((c) => +c[4][0] < 3 && +c[3][0] < 3 && c[1] > 100 && (!wantAlt || +c[3][1] >= 3 || +c[3][2] >= 3))
for (const [label, c] of [['alt', pick(true)], ['none', pick(false)]]) {
  if (!c) { console.log(label, 'no cell'); continue }
  const [lon, lat] = center(c[0])
  const b = await open(1280, 800, false, out)
  await b.goto(`${base}apps/odpt/#/?region=toyama&f=0&d=wd&p=m&w=30&pt=${lon.toFixed(5)},${lat.toFixed(5)}`)
  await b.sidebar('行けるか結論を見る')
  await b.sleep(800)
  console.log(label, c[0], await b.ev(`document.querySelector('[data-testid=verdict-main]')?.innerText`))
  console.log(await b.ev(`document.querySelector('[data-testid=next-steps]')?.innerText.replace(/\\n/g, ' / ')`))
  await b.shot(`odpt-ng-${label}`)
  console.log('errors', b.logs)
  b.close()
}
