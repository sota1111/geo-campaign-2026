// 画面操作の通し確認（ヘッドレスChrome＋CDP）。要: npx vite preview --port 8842 --host 127.0.0.1、google-chrome、node 22+
// usage: node src/apps/udc-moritsuchi/e2e.mjs <outDir> <width> <height> <mobile:0|1>
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [outDir, w, h, mobileFlag] = process.argv.slice(2)
const mobile = mobileFlag === '1'
const URL0 = 'http://127.0.0.1:8842/apps/udc-moritsuchi/'
const MAP = '[role=region][aria-label=盛土ウォッチの地図]'
fs.mkdirSync(outDir, { recursive: true })
const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9700 + Math.floor(Math.random() * 200)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'))
const proxy = process.env.https_proxy || process.env.HTTPS_PROXY
const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`]
if (proxy) args.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=127.0.0.1;localhost')
args.push('about:blank')
const chrome = spawn('google-chrome', args, { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ }
  await sleep(200)
}
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
const logs = []
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0])
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200))
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''))
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300))
  return r.result.result.value
}
const shot = async (name, full = false) => {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full })
  fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64'))
}
const clickText = (sel, text) => ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.includes(${JSON.stringify(text)}));if(!e)return false;e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));e.click();return true})()`)
const mapCenter = async () => {
  await ev(`document.querySelector(${JSON.stringify(MAP)}).scrollIntoView({block:'center'})`)
  await sleep(500)
  return ev(`(()=>{const r=document.querySelector(${JSON.stringify(MAP)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
}
const tapMap = async () => {
  const p = await mapCenter()
  for (const t of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x: p.x, y: p.y, button: 'left', clickCount: 1 })
  await sleep(600)
}
const results = []
const check = (name, ok, extra = '') => { results.push([name, ok]); console.log(ok ? 'PASS' : 'FAIL', name, extra) }

await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl })
await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {})
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile })
await send('Page.navigate', { url: URL0 })
await sleep(4000)
await shot('01-initial')

check('初期表示: 地図とタブ', await ev(`!!document.querySelector(${JSON.stringify(MAP)} + ' canvas') && !![...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.includes('確かめる'))`))
const doneCount = async () => +(/(\d)\/5 完了/.exec(await ev(`document.querySelector('[data-testid=steps-topbar]').textContent`))?.[1] ?? -1)
const stepStatus = (id) => ev(`(document.querySelector('aside [data-step=${id}]') || document.querySelector('[data-testid=steps-topbar] [data-step=${id}]'))?.dataset.status ?? 'none'`)
const clickStep = async (id) => {
  if (mobile) {
    const open = await ev(`document.querySelector('[data-testid=steps-topbar] > button').getAttribute('aria-expanded')`)
    if (open !== 'true') await ev(`document.querySelector('[data-testid=steps-topbar] > button').click()`)
    await sleep(300)
    await ev(`document.querySelector('[data-testid=steps-topbar] [data-step=${id}]').click()`)
  } else {
    await ev(`document.querySelector('aside [data-step=${id}]').click()`)
  }
  await sleep(1200)
}
const typeInto = (sel, text) => ev(`(()=>{const t=document.querySelector(${JSON.stringify(sel)});const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(t,${JSON.stringify(text)});t.dispatchEvent(new Event('input',{bubbles:true}))})()`)

check('初期は「確かめる」画面で、手順1がいまここ・進捗0/5', (await ev(`document.querySelector('[role=tab][data-state=active]').innerText.includes('確かめる')`)) && (await stepStatus('place')) === 'current' && (await doneCount()) === 0)
if (!mobile) check('手順が5つ、上から順に登録されている', (await ev(`[...document.querySelectorAll('aside [data-step]')].map(e=>e.dataset.step).join(',')`)) === 'place,look,compare,rec,prep')
check('結論バナー: 初期は例と明示', (await ev(`document.querySelector('[data-testid=near-banner]').innerText`)).startsWith('熱海駅（例）からの結果です'))
// 手順1: 自宅の場所を入れる
await clickStep('place')
check('手順1を押すと住所入力欄にフォーカス', await ev(`document.activeElement?.id === 'mw-q'`))
await typeInto('#mw-q', '熱海駅')
await ev(`document.querySelector('form[role=search] button[type=submit]').click()`); await sleep(3500)
check('検索候補が出る', (await ev(`document.querySelectorAll('ul[aria-label="検索結果"] li').length`)) > 0)
await ev(`document.querySelector('ul[aria-label="検索結果"] li button').click()`); await sleep(1500)
check('手順1が済・手順2がいまここ', (await stepStatus('place')) === 'done' && (await stepStatus('look')) === 'current' && (await doneCount()) === 1)
check('検索地点の近くの造成地が距離順に出る', (await ev(`document.querySelectorAll('ul[aria-label="近い盛土造成地"] li').length`)) === 5)
const ns = await ev(`document.querySelector('[data-testid=near-summary]').innerText`)
check('最寄りまでの距離（直線）と近くの基準', ns.includes('（直線）') && ns.includes('500m以内'))
await shot('02b-search')
// 手順2: 近くの盛土造成地を確かめる
await clickStep('look')
const top1 = await ev(`document.querySelector('ul[aria-label="近い盛土造成地"] li:nth-child(2) button').getBoundingClientRect().top`)
await sleep(800)
const top2 = await ev(`document.querySelector('ul[aria-label="近い盛土造成地"] li:nth-child(2) button').getBoundingClientRect().top`)
check('手順2: 一覧へ移動し、動かない', Math.abs(top1 - top2) < 1 && top2 > 0 && top2 < +h, `${top1} ${top2}`)
const want = await ev(`document.querySelector('ul[aria-label="近い盛土造成地"] li:nth-child(2) button .font-medium').innerText`)
await ev(`document.querySelector('ul[aria-label="近い盛土造成地"] li:nth-child(2) button').click()`); await sleep(1500)
check('押した造成地が選ばれ型が出る', await ev(`/谷埋め型|腹付け型|区分なし/.test(document.querySelector('[data-testid=fill-info]').innerText) && document.querySelector('[data-testid=fill-info]').innerText.includes(${JSON.stringify(want)})`), want)
check('型の説明が凡例にある', await ev(`document.body.innerText.includes('谷を埋めた盛土') && document.body.innerText.includes('斜面に盛った盛土')`))
check('手順2が済・手順3がいまここ', (await stepStatus('look')) === 'done' && (await stepStatus('compare')) === 'current' && (await doneCount()) === 2)
await shot('02-fill-selected')
// 手順3: 昔の写真と見比べる
await clickStep('compare'); await sleep(1500)
check('手順3: 昔の写真に切り替わり見比べ画面', await ev(`location.hash.includes('old=ort_old10') && document.querySelector('[role=tab][data-state=active]').innerText.includes('見比べる')`), await ev('location.hash'))
check('見るポイントと今/昔のラベル', (await ev(`document.querySelector('[data-testid=look-points]').innerText.includes('判定しません')`)) && (await ev(`document.querySelector('[data-testid=compare-badge]')?.innerText || ''`)).includes('左＝今'))
check('手順3が済・手順4がいまここ', (await stepStatus('compare')) === 'done' && (await stepStatus('rec')) === 'current' && (await doneCount()) === 3)
await shot('03-old-photo')
await clickText('button', '航空写真(現在)'); await sleep(300)
await ev(`[...document.querySelectorAll('button[role=radio]')].find(x=>x.textContent.trim()==='1974〜78年').click()`); await sleep(1500)
check('1974〜78年に切替', await ev(`location.hash.includes('old=gazo1')`))
await shot('03b-compare-1974')
await ev(`[...document.querySelectorAll('button[role=radio]')].find(x=>x.textContent.trim()==='なし').click()`); await sleep(300)
// 手順4: 気づいたことを記録する
await clickStep('rec')
check('位置は未選択から始まる（初期座標なし）', (await ev(`document.querySelector('[data-testid=pick-pos]').innerText`)).includes('未選択') && (await ev(`document.body.innerText.includes('地図をタップして位置を決めてください')`)))
check('位置未選択では保存ボタンが無効', await ev(`[...document.querySelectorAll('button[type=submit]')].find(b=>b.textContent.includes('記録する')).disabled`))
await tapMap()
const pos = await ev(`document.querySelector('[data-testid=pick-pos]').innerText`)
check('地図クリックで位置が決まる', /\d+\.\d+, \d+\.\d+/.test(pos), pos)
await ev(`document.querySelector('#mw-kind').click()`); await sleep(300)
await clickText('[role=option]', '湧水・水の濁り'); await sleep(300)
await ev(`(()=>{const t=document.querySelector('#mw-memo');const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;s.call(t,'擁壁の下から水がにじんでいる（テスト）');t.dispatchEvent(new Event('input',{bubbles:true}))})()`)
await clickText('label', '位置を約100m'); await sleep(200)
await shot('04-record-form')
await ev(`[...document.querySelectorAll('button[type=submit]')].find(b=>b.textContent.includes('記録する')).click()`); await sleep(1000)
check('保存後に記録1件', (await ev(`document.querySelector('[data-testid=rec-count]').innerText`)) === '1')
check('手順4が済・手順5がいまここ・バッジ「記録1件」', (await stepStatus('rec')) === 'done' && (await stepStatus('prep')) === 'current' && (await doneCount()) === 4 && (await ev(`document.querySelector('[role=tab][data-state=active]').innerText.includes('記録1件')`)))
await sleep(1200)
check('保存後に通報文カードへ自動スクロール', await ev(`(()=>{const r=document.querySelector('[data-testid=report-text]').getBoundingClientRect();return r.top>=0&&r.top<window.innerHeight})()`))
const rep = await ev(`document.querySelector('[data-testid=report-text]').value`)
check('通報文に500m以内の一文と通報先案内', rep.includes('500m以内に登録された大規模盛土造成地:') && (await ev(`document.body.innerText.includes('熱海市・伊東市の担当窓口')`)))
check('通報文のたたき台が出る（ぼかし・湧水・メモ）', rep.includes('ぼかした位置') && rep.includes('湧水') && rep.includes('擁壁の下から'))
console.log(rep)
check('localStorage に保存', (await ev(`JSON.parse(localStorage.getItem('udc-moritsuchi:records')).length`)) === 1)
await clickText('button', '文面をコピー'); await sleep(600)
const clip = await ev(`navigator.clipboard.readText().catch(e=>'ERR '+e.message)`)
check('通報文がクリップボードにコピーされる', clip.startsWith('【盛土の変化'), clip.slice(0, 30))
check('手順5が済・5/5完了・完了メッセージ', (await stepStatus('prep')) === 'done' && (await doneCount()) === 5 && (await ev(`document.querySelector('[data-testid=steps-topbar]').textContent.includes('すべて完了')`)))
await shot('05-out', true)

await clickText('button', 'GeoJSONで書き出す'); await sleep(800)
await clickText('button', 'CSVで書き出す'); await sleep(800)
const files = fs.readdirSync(dl)
console.log(files)
check('GeoJSON/CSVが書き出される', files.some((f) => f.endsWith('.geojson')) && files.some((f) => f.endsWith('.csv')))
const gj = files.find((f) => f.endsWith('.geojson'))
if (gj) {
  const j = JSON.parse(fs.readFileSync(path.join(dl, gj), 'utf8'))
  check('GeoJSONに1件', j.features.length === 1)
  j.features[0].properties.id = 'import-1'
  const text = JSON.stringify(j)
  await ev(`(()=>{const i=document.querySelector('#mw-import');const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(text)}],'x.geojson',{type:'application/json'}));i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await sleep(800)
  check('GeoJSON読み込みで2件', (await ev(`document.querySelector('[data-testid=rec-count]').innerText`)) === '2', await ev(`document.querySelector('[data-testid=io-msg]').innerText`))
}

// 範囲外（東京）を開き、記録タブで地図をタップ
await send('Page.navigate', { url: URL0 + '#/?z=12&lat=35.68&lng=139.76' })
await sleep(800); await send('Page.reload'); await sleep(4000)
await clickText('[role=tab]', '記録する'); await sleep(300)
await tapMap()
check('範囲外の警告が出る', await ev(`!!document.querySelector('[data-testid=out-of-coverage]')`))
check('リロード後も記録が残る', (await ev(`JSON.parse(localStorage.getItem('udc-moritsuchi:records')).length`)) === 2)
await shot('06-out-of-coverage')

await clickText('[role=tab]', '届ける'); await sleep(300)
await clickText('button', '全記録を消す'); await sleep(400)
await clickText('[role=dialog] button', '消す'); await sleep(500)
check('全記録を消せる', (await ev(`document.querySelector('[data-testid=rec-count]').innerText`)) === '0')

const overflow = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)
check('横スクロールなし', overflow <= 0, String(overflow))
const errs = logs.filter((l) => !/Failed to load resource/.test(l))
check('コンソールエラーなし', errs.length === 0, JSON.stringify(logs.slice(0, 5)))
console.log('console logs (all):', JSON.stringify(logs.slice(0, 5)))
console.log('FAILS:', results.filter((r) => !r[1]).map((r) => r[0]))
chrome.kill()
ws.close()
process.exit(0)
