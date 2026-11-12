// Tab キーでフォーカスを進め、フォーカス中の要素の outline（幅・スタイル・色）を確認する。390px の上部バーの手順名が切れていないかも確認。
// usage: node scripts/focus-check.mjs <base_url> <out_dir> [path]   既定 path は apps/odpt/
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir, route = 'apps/odpt/'] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-'))
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ } await sleep(200) }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let n = 0
const pend = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value
const key = async (k, code) => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: 9 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: 9 })
}
await send('Runtime.enable'); await send('Page.enable')
const out = {}
for (const [label, w, h, mobile] of [['desktop', 1280, 765, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300)
  await send('Page.navigate', { url: `${base}${route}` }); await sleep(3500)
  const seen = []
  for (let i = 0; i < 8; i++) {
    await key('Tab', 'Tab'); await sleep(120)
    seen.push(await ev(`(() => { const e = document.activeElement; const c = getComputedStyle(e); return { tag: e.tagName, text: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 20), outline: c.outlineWidth + ' ' + c.outlineStyle + ' ' + c.outlineColor, shadow: c.boxShadow.slice(0, 30), visible: e.matches(':focus-visible') } })()`))
  }
  await send('Page.captureScreenshot', { format: 'png' }).then((r) => fs.writeFileSync(path.join(outDir, `focus-${label}.png`), Buffer.from(r.result.data, 'base64')))
  const topbar = mobile ? await ev(`(() => { const e = document.querySelector('[data-testid=steps-topbar-main]'); return e ? { text: e.textContent, clipped: e.scrollWidth > e.clientWidth } : null })()`) : null
  out[label] = { seen, topbar }
}
console.log(JSON.stringify(out, null, 1))
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
