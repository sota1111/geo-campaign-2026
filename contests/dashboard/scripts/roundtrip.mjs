// ポータル→各アプリ→「← 統合ダッシュボード」の往復を確認する。戻ったら全行が閉じた一覧（openRows=0、ハッシュなし）になること。
// usage: node scripts/roundtrip.mjs <base_url>   （例: http://127.0.0.1:8840/）要 google-chrome, node 22+
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2]
const ids = ['odpt', 'udc-moritsuchi', 'sat-a', 'sat-b', 'biz-business', 'biz-idea', 'biz-realestate',
  // 新しい案（比較用・未選定）
  'sat-alpha', 'biz-business-nb', 'biz-realestate-rn1', 'biz-realestate-a4', 'odpt-teiji', 'udc-aed',
  // 審査待ちだった案（ソースが無いビルドでは「審査待ち」の案内ページ。ある checkout を CONTESTS_ROOT で指したビルドでは実物）
  'sat-yabu', 'sat-sugi', 'odpt-kankou', 'odpt-kansui', 'odpt-kodure', 'biz-solar-guard']
// ポータルは選んだ1コンペの詳細だけを出す。アプリのカードがあるコンペを開いて始める
const contestOf = { odpt: 'odpt-2026', 'udc-moritsuchi': 'udc-2026', 'sat-a': 'satellite-2026', 'sat-b': 'satellite-2026', 'biz-business': 'ichibiz-2026', 'biz-idea': 'ichibiz-2026', 'biz-realestate': 'ichibiz-2026', 'sat-alpha': 'satellite-2026', 'biz-business-nb': 'ichibiz-2026', 'biz-realestate-rn1': 'ichibiz-2026', 'biz-realestate-a4': 'ichibiz-2026', 'odpt-teiji': 'odpt-2026', 'udc-aed': 'ichibiz-2026', 'sat-yabu': 'satellite-2026', 'sat-sugi': 'satellite-2026', 'odpt-kankou': 'odpt-2026', 'odpt-kansui': 'odpt-2026', 'odpt-kodure': 'odpt-2026', 'biz-solar-guard': 'ichibiz-2026' }
const contests = ['udc-2026', 'satellite-2026', 'ichibiz-2026', 'odpt-2026']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'))
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
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''))
}
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
const out = []
for (const id of ids) {
  await send('Page.navigate', { url: base + '#open=' + contestOf[id] })
  await sleep(1500)
  await ev(`document.querySelector('a[data-app-link="${id}"]').click()`)
  await sleep(2500)
  const url1 = await ev('location.pathname + location.hash')
  await ev(`document.querySelector('header a[href*="index.html"]').click()`)
  await sleep(1500)
  const url2 = await ev('location.pathname + location.hash'); const openRows = await ev("document.querySelectorAll('[data-testid^=row-][aria-expanded=true]').length")
  out.push({ id, opened: url1, back: url2, openRows, errs: errs.splice(0) })
}
// サイドバーのコンペ名 → コンペ画面 → アプリカード → アプリ → 「○○の概要」 → 戻る
const cout = []
for (const c of contests) {
  await send('Page.navigate', { url: base })
  await sleep(1500)
  await ev(`document.querySelector('[data-testid=row-${c}]').click()`)
  await sleep(1500)
  const page = await ev('location.pathname')
  const apps = await ev("document.querySelectorAll('[data-app-card]').length")
  const sidebar = await ev("document.querySelectorAll('[data-contest-link]').length")
  const first = await ev("document.querySelector('[data-app-card] a[data-app-link]').dataset.appLink")
  await ev(`document.querySelector('[data-app-card] a[data-app-link]').click()`)
  await sleep(2500)
  const appPage = await ev('location.pathname')
  await ev(`document.querySelector('[data-testid=contest-link]').click()`)
  await sleep(1500)
  const back = await ev('location.pathname')
  await ev(`document.querySelector('[data-testid=back-portal]').click()`)
  await sleep(1500)
  const portal = await ev('location.pathname')
  const sw = await ev('document.documentElement.scrollWidth <= window.innerWidth')
  cout.push({ c, page, apps, sidebar, first, appPage, back, portal, noHScroll: sw, errs: errs.splice(0) })
}
console.log(JSON.stringify({ out, cout, errs }, null, 2))
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
