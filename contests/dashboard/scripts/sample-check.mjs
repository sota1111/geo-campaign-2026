// 実行サンプル（?sample=1）の確認。1) 帯・ノートの有無とページのはみ出し 2) 全アプリ全手順で、サンプル中もページスクロール0・
// ノートが2行省略・帯が1行 3) 各手順の画面に、sample.ts の notes に書かれた主要な数値が出ていること（NUMBERS の表）。
// usage: node scripts/sample-check.mjs <base_url>   要: google-chrome, vite preview など。失敗があれば exit 1
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base] = process.argv.slice(2)
let failed = 0
const fail = (m) => { failed++; console.log('FAIL', m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-'))
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
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 765, deviceScaleFactor: 1, mobile: false })
const apps = ['odpt','udc-moritsuchi','sat-a','sat-b','biz-business','biz-idea','biz-realestate']

// 手順 id → その手順の画面（本文・地図の凡例など body 全体）に出ているはずの文字列。出典は各 src/apps/<id>/sample.ts の notes。
// sat-b の点数内訳（型+25 など）は記述の修正待ちのため入れない。
const NUMBERS = {
  'odpt': { verdict: ['469', '1138'], last: ['堀川南大町', '20:44', '20:45'] },
  'udc-moritsuchi': { place: ['0012', '1100'], look: ['1100', '1150', '1250', '1350', '1400'] },
  'sat-a': { top: ['S021', '0.94', '19.6'], pick: ['22区間', '2.9'], scan: ['7区間'], apply: ['0.66', '0.65', '0.70'], round2: ['S033', '0.75', '0.73'] },
  'sat-b': { plan: ['17.4'] },
  'biz-business': { planA: ['6,380', '1,740'], planB: ['2,190', '797'] },
  'biz-idea': { cross: ['大禹謨', '350'] },
  'biz-realestate': { conditions: ['商業地域', '80%', '600%'] },
}

for (const a of apps) for (const q of ['', '?sample=1']) {
  await send('Page.navigate', { url: `${base}apps/${a}/index.html${q}#/` }); await sleep(3000)
  const r = await ev(`({over: document.documentElement.scrollHeight - innerHeight, bar: !!document.querySelector('[data-testid=sample-bar]'), open: !!document.querySelector('[data-testid=sample-open]'), ls: (localStorage.clear(), 0), prog: document.querySelector('aside')?.innerText.match(/[0-9]+ のうち [0-9]+ 完了|すべて完了/)?.[0], note: !!document.querySelector('[data-testid=sample-step-note]')})`)
  console.log(a, q || 'normal', JSON.stringify(r))
  if (q && (!r.bar || r.over > 0)) fail(`${a} sample: bar=${r.bar} over=${r.over}`)
  if (!q && (r.bar || r.note)) fail(`${a} normal mode shows sample UI`)
  if (a === 'sat-a' && q && process.env.OUT) { const s = await send('Page.captureScreenshot'); fs.writeFileSync(process.env.OUT, Buffer.from(s.result.data, 'base64')) }
}

// 全手順: ページスクロール0・帯1行・ノート省略・サイドバー下端が画面内・主要な数値
for (const a of apps) {
  await send('Page.navigate', { url: `${base}apps/${a}/index.html?sample=1#/` }); await sleep(3000)
  const ids = await ev(`[...document.querySelectorAll('aside [data-step]')].map(b => b.dataset.step)`)
  for (const id of ids) {
    await ev(`document.querySelector('aside [data-step="${id}"]').click()`); await sleep(1200)
    const r = await ev(`(() => { const bar = document.querySelector('[data-testid=sample-bar]'); const note = document.querySelector('[data-testid=sample-step-note] p'); const aside = document.querySelector('aside'); return {
      over: document.documentElement.scrollHeight - innerHeight,
      barH: bar?.getBoundingClientRect().height, asideBottom: aside ? Math.round(aside.getBoundingClientRect().bottom) : null, vh: innerHeight,
      noteH: note ? Math.round(note.getBoundingClientRect().height) : null, hasNote: !!note,
      text: document.body.innerText } })()`)
    const want = NUMBERS[a]?.[id] ?? []
    const miss = want.filter((w) => !r.text.includes(w))
    const bad = []
    if (r.over > 0) bad.push(`pageScroll=${r.over}`)
    if (r.barH > 40) bad.push(`barH=${r.barH}`)
    if (r.asideBottom != null && r.asideBottom > r.vh) bad.push(`asideBottom=${r.asideBottom}>${r.vh}`)
    if (r.noteH != null && r.noteH > 40) bad.push(`noteH=${r.noteH}`)
    if (miss.length) bad.push(`missing=${miss.join('|')}`)
    console.log(a, id, bad.length ? 'NG ' + bad.join(' ') : 'ok', `barH=${r.barH} noteH=${r.noteH}${want.length ? ' nums=' + want.length : ''}`)
    if (bad.length) fail(`${a}/${id}: ${bad.join(' ')}`)
  }
}
await send('Page.navigate', { url: `${base}index.html` }); await sleep(1500)
console.log('portal sample links', await ev(`[...document.querySelectorAll('a')].filter(x=>x.href.includes('sample=1')).length`))
ws.close(); chrome.kill()
console.log(failed ? `${failed} 件の失敗` : 'すべて通過')
process.exit(failed ? 1 : 0)
