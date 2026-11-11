// 診断マップの改修確認（ヘッドレスChrome）。使い方:
//   npx vite preview --port 8871 --host 127.0.0.1 &
//   node src/apps/odpt/verify-fixes.mjs http://127.0.0.1:8871/ <スクリーンショットの出力先>
// 「富山駅」→ 完全一致が選ばれる → 結論 → 休日（枠を押して切替）→ 最終便 → コピー → 戻ってもコピー済み、を上から通す。
import { open } from './cdp.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:8871/'
const out = process.argv[3] ?? 'shots'
const b = await open(1280, 800, false, out)
const { ev, click, sleep, shot, sidebar, progress } = b
await b.goto(base + 'apps/odpt/')
console.log('progress0', await progress())
console.log('legend-compact', await ev(`document.querySelector('[data-testid=legend-compact]')?.innerText.replace(/\\n/g,' ')`))
console.log('click 富山駅', await click('button', '富山駅'))
await sleep(3500)
console.log('chosen', await ev(`document.querySelector('[data-testid=chosen-place]')?.innerText`))
console.log('msg', await ev(`document.querySelector('[data-testid=search-msg]')?.innerText.slice(0, 200)`))
await shot('odpt-toyama-selected')
console.log('step2', await sidebar('行けるか結論を見る'))
await sleep(600)
console.log(await ev(`document.querySelector('[data-testid=verdict-main]')?.innerText`))
console.log('next-steps', await ev(`document.querySelector('[data-testid=next-steps]')?.innerText.replace(/\\n/g,' / ')`))
console.log('progress', await progress())
await shot('odpt-verdict')
console.log('step3', await sidebar('休日（日曜ダイヤ）と比べる'))
await sleep(600)
console.log('progress after view only (expect 2 of 5)', await progress())
await shot('odpt-hol')
console.log('pick other', await click('[data-testid=pick-hol]'))
await sleep(500)
console.log('progress after pick (expect 3)', await progress())
console.log('step4', await sidebar('最終便を見る'))
await sleep(600)
console.log('progress', await progress())
console.log('step5', await sidebar('結論とリンクをコピーして送る'))
await sleep(600)
console.log('copy', await click('[data-testid=copy-conclusion]'))
await sleep(800)
console.log('progress (expect 5 of 5)', await progress())
await shot('odpt-copy')
await sidebar('場所を決める')
await sleep(400)
await sidebar('結論とリンクをコピーして送る')
await sleep(500)
console.log('copy btn after return', await ev(`document.querySelector('[data-testid=copy-conclusion]')?.innerText`))
console.log('page scroll [scrollHeight, innerHeight]', await ev(`[document.documentElement.scrollHeight, innerHeight]`))
console.log('errors', b.logs)
b.close()
