// つながり図（ontology/）の状態別スクリーンショットと確認（1280×800・390×844）。
// 状態: 既定／アプリを選んだカード／次の行動から応募を選ぶ／データが使えなければ／近傍だけ表示／検索／一覧からキーボードで選ぶ
// usage: node scripts/ontology-shots.mjs <base_url> <out_dir>   （要 preview 起動・google-chrome）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'oshots-'))
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ } await sleep(200) }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let n = 0
const pend = new Map()
const errs = []
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) }
  if (d.method === 'Runtime.exceptionThrown') errs.push('EXC ' + d.params.exceptionDetails.text)
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200))
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''))
}
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
const shot = async (name) => fs.writeFileSync(path.join(outDir, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`)
const result = []
for (const [label, w, h, mobile] of [['desktop', 1280, 800, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: base + 'ontology/' })
  await sleep(3500)
  const r = { viewport: label }
  r.hscroll = await ev('document.documentElement.scrollWidth > window.innerWidth')
  r.shown = await ev(`document.querySelector('[data-testid=onto-shown]').textContent`)
  await shot(`${label}-1-default.png`)
  // アプリを選ぶ → カード
  await click('[data-node-type=App]')
  await sleep(700)
  r.card = await ev(`document.querySelector('[data-testid=node-card-title]')?.textContent`)
  r.appLink = await ev(`document.querySelector('[data-testid=card-app-link]')?.getAttribute('href')`)
  await ev(`document.querySelector('[data-testid=node-card]').scrollIntoView()`)
  await sleep(400)
  await shot(`${label}-2-card-app.png`)
  // 近傍を展開
  await click('[data-testid=expand-btn]')
  await sleep(900)
  r.afterExpand = await ev(`document.querySelector('[data-testid=onto-shown]').textContent.slice(0, 40)`)
  // 次の行動 → 応募
  await click('[data-testid=sub-item] button')
  await sleep(700)
  r.afterSub = await ev(`document.querySelector('[data-testid=node-card-title]')?.textContent`)
  await shot(`${label}-3-next-sub.png`)
  // 総司令官の判断待ち
  await click('#tab-gates')
  await sleep(300)
  await click('[data-testid=gate-item] button')
  await sleep(700)
  r.gateNote = await ev(`!!document.querySelector('[data-testid=gate-note]')`)
  await shot(`${label}-4-gate.png`)
  // データが使えなければ
  await click('#tab-impact')
  await ev(`(() => { const s = document.querySelector('[data-testid=impact-select]'); const o = [...s.options].find((x) => /国土数値情報 都市公園/.test(x.textContent)) || s.options[1]; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(1200)
  r.impactBadges = await ev(`document.querySelectorAll('[data-node-id]').length + ' nodes / ' + [...document.querySelectorAll('[data-node-id]')].filter((x) => x.getAttribute('aria-label').includes('影響を受ける')).length + ' impacted'`)
  await shot(`${label}-5-impact.png`)
  // 近傍だけ表示
  await click('[data-testid=focus-btn]')
  await sleep(900)
  r.focusShown = await ev(`document.querySelector('[data-testid=onto-shown]').textContent.slice(0, 60)`)
  await shot(`${label}-6-focus.png`)
  await click('[data-testid=focus-btn]')
  // 検索
  await ev(`(() => { const i = document.querySelector('[data-testid=onto-search]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '盛土'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(400)
  r.search = await ev(`document.querySelector('[data-testid=onto-list-count]').textContent`)
  await ev(`document.querySelector('#onto-list').scrollIntoView()`)
  await sleep(300)
  await shot(`${label}-7-search.png`)
  r.hscrollEnd = await ev('document.documentElement.scrollWidth > window.innerWidth')
  r.errors = errs.splice(0)
  result.push(r)
}
console.log(JSON.stringify(result, null, 2))
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
process.exit(result.some((r) => r.errors.length || r.hscroll || r.hscrollEnd) ? 1 : 0)
