// トップ画面の一覧（カード／タブ）と詳細欄の大きさを数値で測り、カードを押す前後を撮る。
// usage: node scripts/allapps-measure.mjs <base_url> <out_dir>   （要 preview 起動・google-chrome）
// 合格基準（デザイン審査 S1）: どの大きさでも、カードを押した後に詳細欄の中身が画面の高さの半分以上見える。
// 一覧の位置・高さ・scrollY は、押す前後で変わらない。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-'))
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
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
}
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable')

const measure = `(() => {
  const list = document.querySelector('[data-testid=contest-list]').getBoundingClientRect()
  const pane = document.querySelector('[data-testid=detail-pane]').getBoundingClientRect()
  const box = document.querySelector('[role=region][id^=detail-]')
  const b = box.getBoundingClientRect()
  return { vh: innerHeight, scrollY, sw: document.documentElement.scrollWidth, listTop: Math.round(list.top), listH: Math.round(list.height),
    paneH: Math.round(pane.height), contentH: Math.round(b.height), half: Math.round(b.height) >= innerHeight / 2,
    title: document.querySelector('[data-testid=detail-title]').textContent }
})()`
const out = []
for (const [w, h] of [[1280, 800], [1024, 768], [768, 1024], [640, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 })
  await send('Page.navigate', { url: base })
  await sleep(2500)
  const before = await ev(measure)
  let shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(outDir, `size-${w}x${h}-before.png`), Buffer.from(shot.result.data, 'base64'))
  await ev(`document.querySelector('[data-testid=row-ichibiz-2026]').click()`)
  await sleep(800)
  const after = await ev(measure)
  shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(outDir, `size-${w}x${h}-after.png`), Buffer.from(shot.result.data, 'base64'))
  out.push({ size: `${w}x${h}`, before, after, listSame: before.listTop === after.listTop && before.listH === after.listH && after.scrollY === 0 })
}
console.log(JSON.stringify({ out, errs }, null, 1))
ws.close(); chrome.kill()
