// 手動確認用: preview（http://127.0.0.1:8847/）に対し、ヘッドレスChromeで実操作→スクリーンショット・PDF・コンソールエラー確認。
// usage: node src/apps/biz-realestate/e2e-check.mjs <out_dir>
import { spawn } from 'node:child_process'
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

for (const [label, w, h, mobile] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true]]) {
  logs.length = 0
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: 'http://127.0.0.1:8847/#/apps/biz-realestate' })
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
  await shot(`${label}-3-sheet.png`, true)
  if (!mobile) {
    for (const [name, act] of [['print', null], ['print-sample', `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('サンプル（架空）の土地')).click()`]]) {
      if (act) { await ev(act); await sleep(800) }
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
ws.close(); chrome.kill()
