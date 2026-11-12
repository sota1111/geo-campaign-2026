// 手動確認用: preview（http://127.0.0.1:8847/）に対し、ヘッドレスChromeで実操作→スクリーンショット・PDF・コンソールエラー確認。
// usage: node src/apps/biz-realestate/e2e-check.mjs <out_dir>
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9700 + Math.floor(Math.random() * 200)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'))
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ } await sleep(200) }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map(); const logs = []
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0])
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200))
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''))
  if (d.method === 'Fetch.requestPaused') onPaused(d.params)
}
// 印刷の固定ケース用: 国土地理院の地名検索・逆ジオコーダの応答だけを差し替える（外部へは送らない）。mock が null の間はそのまま通す
let mock = null
const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'application/json' }]
function onPaused({ requestId, request }) {
  if (!mock) return send('Fetch.continueRequest', { requestId })
  const body = request.url.includes('msearch.gsi.go.jp') ? mock.search : request.url.includes('mreversegeocoder') ? mock.rev : undefined
  if (body === undefined) return send('Fetch.continueRequest', { requestId })
  if (body === null) return send('Fetch.fulfillRequest', { requestId, responseCode: 503, responseHeaders: CORS, body: '' })
  return send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: CORS, body: Buffer.from(JSON.stringify(body)).toString('base64') })
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value
const shot = async (name, full = false) => {
  let clip
  if (full) {
    const h = await ev('document.documentElement.scrollHeight'); const w = await ev('window.innerWidth')
    clip = { x: 0, y: 0, width: w, height: Math.min(h, 6000), scale: 1 }
  }
  const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) })
  fs.writeFileSync(path.join(out, name), Buffer.from(r.result.data, 'base64'))
}
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
const click = async (x, y) => { for (const t of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const pages = (b) => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
// 印刷の余白: 1ページ目のいちばん下の文字の下端（pt）と、印刷範囲の下端（A4の高さ − @page の余白 6mm）との差。
// Windows・Mac のフォントで1〜2行増えても2ページにならないよう、約40pt（7.5ptの行で3〜4行分）以上を求める（デザイン再審査 r2 中C）
const PAGE_MARGIN_PT = 6 / 25.4 * 72
const MIN_BOTTOM_GAP_PT = 40
function bottomGap(file) {
  const html = execFileSync('pdftotext', ['-bbox', '-f', '1', '-l', '1', file, '-'], { encoding: 'utf8' })
  const pageH = +(/<page width="[\d.]+" height="([\d.]+)"/.exec(html)?.[1] ?? NaN)
  const yMax = Math.max(...[...html.matchAll(/<word [^>]*yMax="([\d.]+)"/g)].map((m) => +m[1]))
  return { bottom: Math.round(yMax), limit: Math.round(pageH - PAGE_MARGIN_PT), gap: Math.round(pageH - PAGE_MARGIN_PT - yMax) }
}

for (const [label, w, h, mobile] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true]]) {
  logs.length = 0
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: 'http://127.0.0.1:8847/apps/biz-realestate/' })
  await sleep(2500)
  await shot(`${label}-1-initial.png`, true)
  console.log(label, 'overflowX', await ev('document.documentElement.scrollWidth > window.innerWidth'))
  // 検索欄に「徳島駅」と入力して検索
  await ev(`document.querySelector('#rs-q').focus(); document.querySelector('#rs-q').select()`)
  await send('Input.insertText', { text: '徳島駅' })
  await ev(`document.querySelector('form[role=search] button[type=submit]').click()`)
  await sleep(3000)
  console.log(label, 'digest:', await ev(`document.querySelector('[data-testid=digest]')?.innerText`))
  console.log(label, 'status after search:', await ev(`document.querySelector('[data-testid=status]').textContent`))
  await ev(`document.querySelector('#rs-overlay').scrollIntoView({block:'center'})`)
  await ev(`document.querySelector('#rs-overlay').click()`); await sleep(500)
  await ev(`[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.includes('洪水')).click()`)
  await sleep(2500)
  await ev(`document.querySelector('[role=region][aria-label^=地図]').scrollIntoView({block:'center'})`)
  await sleep(500)
  await shot(`${label}-2-overlay.png`)
  const r = JSON.parse(await ev(`JSON.stringify(document.querySelector('[role=region][aria-label^=地図]').getBoundingClientRect())`))
  console.log(label, 'banner rect:', await ev(`JSON.stringify((({top,bottom})=>({top:Math.round(top),bottom:Math.round(bottom),vh:innerHeight}))(document.querySelector('[data-testid=use-hit]').getBoundingClientRect()))`))
  console.log(label, 'marker label:', await ev(`document.querySelector('.maplibregl-marker')?.textContent`))
  await shot(`${label}-2b-marker.png`)
  if (mobile) {
    await click(r.x + r.width / 2, r.y + r.height / 2)
  } else {
    await ev(`document.querySelector('[data-testid=use-hit] button').click()`)
  }
  for (let i = 0; i < 30 && !(await ev(`!!document.querySelector('[data-testid=digest]')`)); i++) await sleep(500)
  await sleep(2500)
  console.log(label, 'sheetTop after 2.5s', await ev(`Math.round(document.querySelector('[data-testid=sheet]').getBoundingClientRect().top)`))
  console.log(label, 'answers:', await ev(`document.querySelector('[data-testid=answers]')?.innerText`))
  console.log(label, 'glossary:', await ev(`document.querySelector('[data-testid=glossary]')?.innerText`))
  await sleep(2000)
  console.log(label, 'after choose: sheetTop', await ev(`Math.round(document.querySelector('[data-testid=sheet]').getBoundingClientRect().top)`), 'quick:', await ev(`document.querySelector('[data-testid=quick-result]')?.innerText`))
  await shot(`${label}-2c-after-choose.png`)
  console.log(label, 'digest:', await ev(`document.querySelector('[data-testid=digest]')?.innerText`))
  console.log(label, 'legend:', await ev(`document.querySelector('[data-testid=legend]')?.innerText.slice(0,80)`))
  console.log(label, 'meta:', await ev(`document.querySelector('[data-testid=sheet] p')?.innerText`))
  console.log(label, 'status after click:', await ev(`document.querySelector('[data-testid=status]').textContent`))
  await ev(`[...document.querySelectorAll('[role=radio]')].find(b=>b.textContent.trim()==='ある').click()`)
  await ev(`[...document.querySelectorAll('[role=radio]')].find(b=>b.textContent.trim()==='まだ').click()`)
  await sleep(500)
  console.log(label, 'summary:', await ev(`[...document.querySelectorAll('[data-testid=summary] > div')].map(d=>d.textContent).join(' | ')`))
  console.log(label, 'exit-sell:', await ev(`document.querySelector('[data-testid=exit-sell]').innerText.slice(0,300)`))
  // 不動産情報ライブラリ: 同梱の取得結果が読めていれば、シートに「ライブラリ由来」の行と規約のクレジットが出る
  console.log(label, 'lib rows:', await ev(`JSON.stringify([...document.querySelectorAll('[data-testid=sheet] [data-testid=lib-badge]')].map(b=>b.closest('div,li')?.innerText.replace(/\\s+/g,' ').slice(0,160)))`))
  console.log(label, 'lib credit in sheet:', await ev(`document.querySelector('[data-testid=lib-credit]')?.textContent.includes('API機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません')`))
  await ev(`document.querySelector('[data-step=conditions]')?.click()`); await sleep(800)
  console.log(label, 'step3 lib-box:', await ev(`document.querySelector('[data-testid=lib-status]')?.textContent.slice(0,120)`), '| short source:', await ev(`document.querySelector('[data-testid=lib-source-short]')?.textContent.slice(0,80)`))
  // 規約のクレジット（第7条）は、手順3の導線から開く「出典・ライセンス」にある（画面上で常に見つけられること）
  await ev(`document.querySelector('[data-testid=lib-terms-link]')?.click()`); await sleep(600)
  console.log(label, 'credit in dialog via step3 link:', await ev(`!![...document.querySelectorAll('[role=dialog]')].find(d=>d.textContent.includes('API機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません'))`))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(400)
  await shot(`${label}-3a-conditions.png`, true)
  await ev(`document.querySelector('[data-step=answers]')?.click()`); await sleep(500)
  await shot(`${label}-3-sheet.png`, true)
  if (!mobile) {
    for (const [name, act] of [['print', null], ['print-example', `document.querySelector('[data-step=place]').click()`]]) {
      if (act) { await ev(act); await sleep(800); await ev(`document.querySelector('[data-testid=use-example]').click()`); await sleep(6000); await ev(`document.querySelector('[data-step=print]').click()`); await sleep(800) }
      await send('Emulation.setEmulatedMedia', { media: 'print' })
      await sleep(500)
      const pdf = await send('Page.printToPDF', { paperWidth: 8.27, paperHeight: 11.69, preferCSSPageSize: true, printBackground: true })
      const buf = Buffer.from(pdf.result.data, 'base64')
      fs.writeFileSync(path.join(out, name + '.pdf'), buf)
      console.log(name, 'pdf pages:', pages(buf))
      await send('Emulation.setEmulatedMedia', { media: '' })
    }
  }
  console.log(label, 'console errors:', JSON.stringify(logs, null, 1))
}

// ---- 印刷の固定ケース（A4・1ページに収まること。デザイン審査 api-integration-20261112 の重大1） ----
// 4問回答・3問回答、取引価格の行あり（逆ジオコーダの応答を差し替え）、市街化調整区域の地点（区域区分が「売る」「活かす」にも出る、いちばん長いケース）
const ALL4 = { '土地に建物はありますか': 'ある', '地目（登記上の種類）': '田・畑（農地）', '道路に接していますか': '接していない・不明確', '相続登記は済んでいますか': 'まだ' }
const ANS3 = { ...ALL4, '道路に接していますか': '分からない' }
const rev = (town) => ({ results: { muniCd: '36201', lv01Nm: town } })
const CASES = [
  // [名前, 地点（null＝徳島駅付近の例）, 逆ジオコーダの応答（null＝応答なし）, 回答, 期待する取引の行]
  ['ex-4ans-noaddr', null, null, ALL4, 'none'],
  ['ex-4ans-addr', null, rev('寺島本町西一丁目'), ALL4, 'trade'],
  ['ex-3ans-addr', null, rev('寺島本町西一丁目'), ANS3, 'trade'],
  ['chosei-4ans-trade', [134.5352, 34.0245], rev('方上町'), ALL4, 'trade'], // 市街化調整区域（方上町・標準地 徳島-20 の近く）
  ['chosei-3ans-trade', [134.5352, 34.0245], rev('方上町'), ANS3, 'trade'],
  ['hachiman-4ans-trade', [134.5292, 34.0445], rev('八万町'), ALL4, 'trade'],
]
await send('Fetch.enable', { patterns: [{ urlPattern: '*msearch.gsi.go.jp*' }, { urlPattern: '*mreversegeocoder.gsi.go.jp*' }] })
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
let ng = 0
for (const [name, pt, revBody, ans, expectTrade] of CASES) {
  logs.length = 0
  mock = { search: pt ? [{ geometry: { coordinates: pt }, properties: { title: 'テスト地点（差し替え）' } }] : [], rev: revBody }
  await send('Page.navigate', { url: 'http://127.0.0.1:8847/apps/biz-realestate/' })
  await sleep(2500)
  if (pt) {
    await ev(`document.querySelector('#rs-q').focus()`); await send('Input.insertText', { text: 'テスト地点' })
    await ev(`document.querySelector('form[role=search] button[type=submit]').click()`); await sleep(1500)
    await ev(`document.querySelector('[data-testid=use-hit] button').click()`)
  } else {
    await ev(`document.querySelector('[data-testid=use-example]').click()`)
  }
  for (let i = 0; i < 40 && !(await ev(`!!document.querySelector('[data-testid=sheet]') && !document.querySelector('[data-testid=status]')?.textContent.includes('集めています')`)); i++) await sleep(500)
  await sleep(1500)
  await ev(`document.querySelector('[data-step=answers]').click()`); await sleep(500)
  for (const [g, v] of Object.entries(ans)) {
    // 既に選ばれている選択肢を押すと解除されるので、選ばれていない時だけ押す
    await ev(`(b => b.getAttribute('aria-checked') === 'true' || b.click())([...document.querySelector('[role=group][aria-label="${g}"]').querySelectorAll('[role=radio]')].find(b=>b.textContent.trim()===${JSON.stringify(v)}))`)
    await sleep(150)
  }
  await ev(`document.querySelector('[data-step=print]').click()`); await sleep(800)
  const info = JSON.parse(await ev(`JSON.stringify({
    division: [...document.querySelectorAll('[data-testid=sheet] dt')].find(d=>d.textContent==='区域区分')?.nextElementSibling?.textContent ?? null,
    trade: !![...document.querySelectorAll('[data-testid=sheet] dt')].find(d=>d.textContent==='取引価格の傾向' && /中央値/.test(d.nextElementSibling.textContent)),
    tradeNone: !![...document.querySelectorAll('[data-testid=sheet] dt')].find(d=>d.textContent==='取引価格の傾向' && /照合/.test(d.nextElementSibling.textContent)),
    printRow: document.querySelector('[data-testid=lib-print-row]')?.textContent ?? null,
    credit: !!document.querySelector('[data-testid=lib-credit]')?.textContent.includes('API機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません'),
    answers: document.querySelector('[data-testid=answers]')?.innerText.replace(/\s+/g,' '),
  })`))
  await send('Emulation.setEmulatedMedia', { media: 'print' }); await sleep(500)
  const pdf = await send('Page.printToPDF', { paperWidth: 8.27, paperHeight: 11.69, preferCSSPageSize: true, printBackground: true })
  await send('Emulation.setEmulatedMedia', { media: '' })
  const buf = Buffer.from(pdf.result.data, 'base64')
  fs.writeFileSync(path.join(out, `case-${name}.pdf`), buf)
  const n = pages(buf)
  const g = bottomGap(path.join(out, `case-${name}.pdf`))
  const tradeOk = expectTrade === 'trade' ? info.trade : info.tradeNone
  const ok = n === 1 && g.gap >= MIN_BOTTOM_GAP_PT && info.credit && tradeOk && !logs.some((l) => l.startsWith('EXC'))
  if (!ok) ng++
  console.log(`PRINT-CASE ${name}: pages=${n} bottom=${g.bottom}pt limit=${g.limit}pt gap=${g.gap}pt(>=${MIN_BOTTOM_GAP_PT}) credit=${info.credit} trade=${info.trade} tradeNone=${info.tradeNone} division=${info.division} ${ok ? 'OK' : 'NG'}`)
  console.log(`  answers: ${info.answers}`)
  console.log(`  print row: ${info.printRow}`)
  if (logs.length) console.log('  console errors:', JSON.stringify(logs))
}
mock = null
console.log(ng ? `PRINT-CASES: ${ng} NG` : `PRINT-CASES: all 1 page, bottom gap >= ${MIN_BOTTOM_GAP_PT}pt`)
if (ng) process.exitCode = 1

ws.close(); chrome.kill()
