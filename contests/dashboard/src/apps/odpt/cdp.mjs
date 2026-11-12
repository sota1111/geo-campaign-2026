// 画面確認スクリプト共通の小さなヘッドレスChrome操作ライブラリ（verify-fixes.mjs などから使う）。要: google-chrome, node 22+
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export async function open(w, h, mobile, outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const port = 9300 + Math.floor(Math.random() * 500)
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'drv-'))
  const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
  let targets
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ } await sleep(200) }
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
  }
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
    return r.result?.exceptionDetails ? 'EVALERR ' + JSON.stringify(r.result.exceptionDetails.exception?.description) : r.result?.result?.value
  }
  await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {})
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(s.result.data, 'base64'))
  }
  const click = (sel, text = '') => ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>!${JSON.stringify(text)}||x.textContent.trim().includes(${JSON.stringify(text)}));if(!e)return 'notfound:'+${JSON.stringify(sel + text)};e.click();return 'ok'})()`)
  const sidebar = (t) => ev(`(()=>{const e=[...document.querySelectorAll('button[data-step]')].find(x=>x.textContent.includes(${JSON.stringify(t)}));if(!e)return 'nf';e.click();return 'ok'})()`)
  const progress = () => ev(`document.body.innerText.match(/必須 ?\\d+ ?のうち ?\\d+ ?完了/)?.[0]`)
  const goto = async (url) => { await send('Page.navigate', { url }); await sleep(3500) }
  const close = () => { ws.close(); chrome.kill() }
  return { send, ev, shot, click, sidebar, progress, goto, sleep, logs, close }
}
