// 画面操作の通し確認（ヘッドレスChrome＋CDP）。サイドバー（スマホは上部ステッパー）を上から順に押して全手順を済にする。
// 要: npx vite preview --port 8842 --host 127.0.0.1、google-chrome、node 22+
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
const tapMap = async () => {
  await ev(`document.querySelector(${JSON.stringify(MAP)}).scrollIntoView({block:'center'})`)
  await sleep(400)
  const p = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(MAP)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  for (const t of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x: p.x, y: p.y, button: 'left', clickCount: 1 })
  await sleep(600)
}
const doneCount = async () => +(/必須 5 のうち (\d) 完了/.exec(await ev(`document.querySelector('[data-testid=steps-topbar]').textContent`))?.[1] ?? -1)
const stepAttr = (sid, a) => ev(`(document.querySelector('aside [data-step=${sid}]') || document.querySelector('[data-testid=steps-topbar] [data-step=${sid}]'))?.${a} ?? 'none'`)
const stepStatus = (sid) => stepAttr(sid, 'dataset.status')
const isActive = async (sid) => (await stepAttr(sid, "dataset.active")) === 'true'
const clickStep = async (sid) => {
  if (mobile) {
    const open = await ev(`document.querySelector('[data-testid=steps-topbar] > button').getAttribute('aria-expanded')`)
    if (open !== 'true') await ev(`document.querySelector('[data-testid=steps-topbar] > button').click()`)
    await sleep(300)
    await ev(`document.querySelector('[data-testid=steps-topbar] [data-step=${sid}]').click()`)
  } else {
    await ev(`document.querySelector('aside [data-step=${sid}]').click()`)
  }
  await sleep(1000)
}
const typeInto = (sel, text) => ev(`(()=>{const t=document.querySelector(${JSON.stringify(sel)});const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(t,${JSON.stringify(text)});t.dispatchEvent(new Event('input',{bubbles:true}))})()`)
const docScroll = () => ev(`({sh: document.documentElement.scrollHeight, bh: document.body.scrollHeight, ih: window.innerHeight})`)
const results = []
const check = (name, ok, extra = '') => { results.push([name, ok]); console.log(ok ? 'PASS' : 'FAIL', name, extra) }

await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl })
await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {})
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile })
await send('Page.navigate', { url: URL0 })
await sleep(4000)
await shot('01-initial')

check('初期表示: 地図がある', await ev(`!!document.querySelector(${JSON.stringify(MAP)} + ' canvas')`))
check('初期は手順1が表示中・いまここ・進捗0/5', (await isActive('place')) && (await stepStatus('place')) === 'current' && (await doneCount()) === 0)
check('ページ内にタブ・チェックリスト・次へボタンがない', await ev(`!document.querySelector('[role=tab]') && !document.querySelector('[data-testid=checklist]') && !document.querySelector('[data-testid=next-action]')`))
if (!mobile) {
  check('サイドバーに手順が上から place,look,compare,rec,prep,ref', (await ev(`[...document.querySelectorAll('aside [data-step]')].map(e=>e.dataset.step).join(',')`)) === 'place,look,compare,rec,prep,ref')
  // (1) 全手順を表示してもページ全体はスクロールしない
  let worst = 0
  for (const sid of ['place', 'look', 'compare', 'rec', 'prep', 'ref']) {
    await clickStep(sid)
    const d = await docScroll()
    worst = Math.max(worst, d.sh - d.ih, d.bh - d.ih)
    check(`手順 ${sid}: documentのスクロール高さ ≤ ビューポート (${d.sh} / ${d.ih})`, d.sh <= d.ih && d.bh <= d.ih)
  }
  console.log('worst overflow px:', worst)
  await clickStep('place')
}

// 手順1: 自宅の場所を入れる
await ev(`document.getElementById('mw-q').focus()`)
await typeInto('#mw-q', '熱海駅')
await ev(`document.querySelector('form[role=search] button[type=submit]').click()`); await sleep(3500)
check('検索候補が出る', (await ev(`document.querySelectorAll('ul[aria-label="検索結果"] li').length`)) > 0)
await shot('02a-search')
await ev(`document.querySelector('ul[aria-label="検索結果"] li button').click()`); await sleep(1500)
check('手順1が済・手順2がいまここ・表示は自動で切り替わらない', (await stepStatus('place')) === 'done' && (await stepStatus('look')) === 'current' && (await isActive('place')) && (await doneCount()) === 1)

// 手順2: 近くの盛土造成地を確かめる
await clickStep('look')
check('手順2のパネル: 結論・一覧5件', (await ev(`document.querySelector('[data-testid=near-summary]').innerText`)).includes('（直線）') && (await ev(`document.querySelectorAll('ul[aria-label="近い盛土造成地"] li').length`)) === 5)
const want = await ev(`document.querySelector('ul[aria-label="近い盛土造成地"] li:nth-child(2) button .font-medium').innerText`)
await ev(`document.querySelector('ul[aria-label="近い盛土造成地"] li:nth-child(2) button').click()`); await sleep(1500)
check('押した造成地が選ばれ型が出る', await ev(`/谷埋め型|腹付け型|区分なし/.test(document.querySelector('[data-testid=fill-info]').innerText) && document.querySelector('[data-testid=fill-info]').innerText.includes(${JSON.stringify(want)}) && document.querySelector('ul[aria-label="近い盛土造成地"] li:nth-child(2) button').getAttribute('aria-pressed')==='true'`), want)
check('型の説明が出る', await ev(`document.body.innerText.includes('谷を埋めた盛土') && document.body.innerText.includes('斜面に盛った盛土')`))
check('手順2が済・手順3がいまここ', (await stepStatus('look')) === 'done' && (await stepStatus('compare')) === 'current' && (await doneCount()) === 2)
await shot('02-fill-selected')

// 手順3: 昔の写真と見比べる
await clickStep('compare')
await ev(`[...document.querySelectorAll('button[role=radio]')].find(x=>x.textContent.trim()==='1961〜69年').click()`); await sleep(2500)
check('昔の写真に切り替わる', await ev(`location.hash.includes('old=ort_old10')`), await ev('location.hash'))
check('見るポイントと今/昔のラベル', (await ev(`document.querySelector('[data-testid=look-points]').innerText.includes('判定しません')`)) && (await ev(`document.querySelector('[data-testid=compare-badge]')?.innerText || ''`)).includes('左＝今'))
check('手順3が済・手順4がいまここ', (await stepStatus('compare')) === 'done' && (await stepStatus('rec')) === 'current' && (await doneCount()) === 3)
await shot('03-old-photo')
await ev(`[...document.querySelectorAll('button[role=radio]')].find(x=>x.textContent.trim()==='航空写真(現在)').click()`); await sleep(300)
await ev(`[...document.querySelectorAll('button[role=radio]')].find(x=>x.textContent.trim()==='1974〜78年').click()`); await sleep(1500)
check('1974〜78年に切替', await ev(`location.hash.includes('old=gazo1')`))
await shot('03b-compare-1974')
await ev(`[...document.querySelectorAll('button[role=radio]')].find(x=>x.textContent.trim()==='なし').click()`); await sleep(300)

// 手順4: 気づいたことを記録する
await clickStep('rec')
check('位置は未選択から始まる', (await ev(`document.querySelector('[data-testid=pick-pos]').innerText`)).includes('未選択') && (await ev(`document.body.innerText.includes('地図をタップして位置を決めてください')`)))
check('位置未選択では保存ボタンが無効', await ev(`[...document.querySelectorAll('button[type=submit]')].find(b=>b.textContent.includes('記録する')).disabled`))
await tapMap()
check('地図クリックで位置が決まる', /\d+\.\d+, \d+\.\d+/.test(await ev(`document.querySelector('[data-testid=pick-pos]').innerText`)))
await ev(`document.querySelector('#mw-kind').click()`); await sleep(300)
await clickText('[role=option]', '湧水・水の濁り'); await sleep(300)
await ev(`(()=>{const t=document.querySelector('#mw-memo');const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;s.call(t,'擁壁の下から水がにじんでいる（テスト）');t.dispatchEvent(new Event('input',{bubbles:true}))})()`)
await clickText('label', '位置を約100m'); await sleep(200)
await shot('04-record-form')
await ev(`[...document.querySelectorAll('button[type=submit]')].find(b=>b.textContent.includes('記録する')).click()`); await sleep(1000)
check('保存後に手順4が済・手順5がいまここ・表示は切り替わらない', (await stepStatus('rec')) === 'done' && (await stepStatus('prep')) === 'current' && (await isActive('rec')) && (await doneCount()) === 4)
check('localStorage に保存', (await ev(`JSON.parse(localStorage.getItem('udc-moritsuchi:records')).length`)) === 1)

// 手順5: 市に伝える文面を用意する
await clickStep('prep')
const rep = await ev(`document.querySelector('[data-testid=report-text]').value`)
check('通報文（ぼかし・湧水・メモ・500m以内の一文）', rep.includes('ぼかした位置') && rep.includes('湧水') && rep.includes('擁壁の下から') && rep.includes('500m以内に登録された大規模盛土造成地:'))
check('通報先案内と「コピーで準備完了」', await ev(`document.body.innerText.includes('熱海市・伊東市の担当窓口') && document.body.innerText.includes('この文面をコピーすると準備完了です')`))
if (!mobile) { const d = await docScroll(); check(`手順5（記録あり）でもページはスクロールしない (${d.sh}/${d.ih})`, d.sh <= d.ih) }
await shot('05-prep')
await clickText('button', '文面をコピー'); await sleep(600)
const clip = await ev(`navigator.clipboard.readText().catch(e=>'ERR '+e.message)`)
check('通報文がクリップボードにコピーされる', clip.startsWith('【盛土の変化'), clip.slice(0, 30))
check('手順5が済・5/5完了', (await stepStatus('prep')) === 'done' && (await doneCount()) === 5 && (await ev(`document.querySelector('[data-testid=steps-topbar]').textContent.includes('すべて完了')`)))

await clickText('button', 'GeoJSON'); await sleep(800)
await clickText('button', 'CSV'); await sleep(800)
const files = fs.readdirSync(dl)
check('GeoJSON/CSVが書き出される', files.some((f) => f.endsWith('.geojson')) && files.some((f) => f.endsWith('.csv')), files.join(' '))
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

// 参考（任意）
await clickStep('ref')
check('参考: 出典・注意が出る', await ev(`document.body.innerText.includes('CC BY 4.0') && document.body.innerText.includes('直ちに危険な場所ではありません')`))

// 範囲外（東京）を開き、記録手順で地図をタップ
await send('Page.navigate', { url: URL0 + '#/?z=12&lat=35.68&lng=139.76' })
await sleep(800); await send('Page.reload'); await sleep(4000)
await clickStep('rec')
await tapMap()
check('範囲外の警告が出る', await ev(`!!document.querySelector('[data-testid=out-of-coverage]')`))
check('リロード後も記録が残る', (await ev(`JSON.parse(localStorage.getItem('udc-moritsuchi:records')).length`)) === 2)
await shot('06-out-of-coverage')

await clickStep('prep')
await clickText('button', '全記録を消す'); await sleep(400)
await clickText('[role=dialog] button', '消す'); await sleep(500)
check('全記録を消せる', (await ev(`document.querySelector('[data-testid=rec-count]').innerText`)) === '0')

const overflow = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)
check('横スクロールなし', overflow <= 0, String(overflow))
const errs = logs.filter((l) => !/Failed to load resource/.test(l))
check('コンソールエラーなし', errs.length === 0, JSON.stringify(logs.slice(0, 5)))
console.log('FAILS:', results.filter((r) => !r[1]).map((r) => r[0]))
chrome.kill()
ws.close()
process.exit(0)
