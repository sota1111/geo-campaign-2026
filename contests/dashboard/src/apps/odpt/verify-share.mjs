// 診断マップの通し確認＋共有リンクを新しいタブで開く確認（ヘッドレスChrome）。
//   npx vite preview --port 8842 --host 127.0.0.1 &
//   node src/apps/odpt/verify-share.mjs http://127.0.0.1:8842/ <outDir>
// 1) 手順を上から押して全部「済」になる  2) コピーされた文面のリンクを別のブラウザプロファイル（＝新しいタブ相当）で開き、結論が直接出る
//  3) 範囲外の地点では手順1が済にならない
import { open } from './cdp.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:8842/'
const out = process.argv[3] ?? 'src/apps/odpt/screenshots'
const results = []
const check = (name, ok, extra = '') => { results.push([name, !!ok]); console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const stepStatus = (b, sid) => b.ev(`document.querySelector('aside [data-step=${sid}]')?.dataset.status`)

const b = await open(1280, 800, false, out)
await b.goto(base + 'apps/odpt/')
check('初期は進捗0/5', (await b.progress())?.includes('0 完了'))
// 範囲外（山の中）をURLで開く → 手順1は済にならない
await b.goto(base + 'apps/odpt/#/?region=toyama&f=0&d=wd&p=m&w=30&pt=137.30000%2C36.50000')
check('範囲外の地点: 手順1は済にならない', (await stepStatus(b, 'place')) !== 'done', await stepStatus(b, 'place'))
check('範囲外の地点: 結論の代わりに範囲外と出る', await b.ev(`document.body.innerText.includes('診断範囲外')`))

await b.goto(base + 'apps/odpt/')
await b.click('button', '富山駅'); await b.sleep(2500)
check('富山駅を選ぶと手順1が済', (await stepStatus(b, 'place')) === 'done')
await b.sidebar('条件を確認'); await b.sleep(300)
await b.sidebar('行けるか結論'); await b.sleep(500)
check('結論の1枚が出る', await b.ev(`!!document.querySelector('[data-testid=family-sheet]')`))
check('使ったデータの一行（事業者名つき）', (await b.ev(`document.querySelector('[data-testid=data-used]')?.innerText`))?.includes('使ったデータ: 富山'), await b.ev(`document.querySelector('[data-testid=data-used]')?.innerText`))
await b.shot('odpt-sheet')
await b.sidebar('休日'); await b.sleep(300)
await b.click('[data-testid=pick-hol]'); await b.sleep(400)
await b.sidebar('最終便'); await b.sleep(500)
await b.sidebar('1枚をコピー'); await b.sleep(500)
await b.click('[data-testid=copy-conclusion]'); await b.sleep(800)
const clip = await b.ev(`navigator.clipboard.readText().catch(e=>'ERR '+e.message)`)
check('コピー文に結論・使ったデータ・リンクがある', clip.includes('富山駅') && clip.includes('使ったデータ') && /https?:\/\/\S+pt=/.test(clip), clip)
check('全手順が済', (await b.progress())?.includes('5 のうち 5'), await b.progress())
const link = (clip.match(/https?:\/\/\S+/) ?? [''])[0]
console.log('link:', link)
b.close()

// 新しいブラウザ（別プロファイル）でリンクを開く
const b2 = await open(1280, 800, false, out)
await b2.goto(link)
await b2.sleep(1500)
check('共有リンク: 結論が直接表示される（手順3）', await b2.ev(`!!document.querySelector('[data-testid=family-sheet]') && document.querySelector('[data-testid=verdict-main]')?.innerText.length > 0`), await b2.ev(`document.querySelector('[data-testid=verdict-main]')?.innerText`))
check('共有リンク: 共有リンクから開いたと出る', await b2.ev(`!!document.querySelector('[data-testid=from-link]')`))
check('共有リンク: 条件（休日）と地点が復元されている', (await b2.ev(`document.querySelector('[data-testid=sheet-cond]')?.innerText`))?.includes('日曜') && (await b2.ev(`document.querySelector('[data-testid=sheet-cond]')?.innerText`))?.startsWith('富山駅から'), await b2.ev(`document.querySelector('[data-testid=sheet-cond]')?.innerText`))
check('共有リンク: アドレスにptが残る', (await b2.ev(`location.href`)).includes('pt='))
await b2.shot('odpt-shared-link')
// 同じタブでアドレスだけ変えても追従する
await b2.ev(`location.hash = '#/?region=toyama&f=0&d=wd&p=m&w=30&pt=137.109375%2C36.722917'`)
await b2.sleep(1500)
check('同じタブでリンクを貼り直しても、その地点の結論になる', (await b2.ev(`document.querySelector('[data-testid=verdict-main]')?.innerText`))?.includes('行けません'), await b2.ev(`document.querySelector('[data-testid=verdict-main]')?.innerText`))
await b2.shot('odpt-ng-sheet')
b2.close()
console.log('FAILS:', results.filter((r) => !r[1]).map((r) => r[0]))
process.exit(0)
