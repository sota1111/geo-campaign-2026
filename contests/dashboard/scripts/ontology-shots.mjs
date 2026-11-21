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
const sizes = process.env.SIZES ? JSON.parse(process.env.SIZES) : [['d1280', 1280, 800, false], ['d1513', 1513, 784, false], ['m390', 390, 844, true]]
const measure = `(() => {
  const box = document.querySelector('[data-testid=graph-area]').getBoundingClientRect()
  const nodes = [...document.querySelectorAll('[data-node-id]')]
  const names = [...document.querySelectorAll('[data-testid=lane-app],[data-testid=lane-blocker-name]')]
  const px = (e) => parseFloat(getComputedStyle(e).fontSize)
  const all = [...nodes.flatMap((n) => [...n.querySelectorAll('span')])]
  return {
    nodes: nodes.length,
    minNameFontPx: Math.min(...names.map(px)),
    minAnyFontPx: Math.min(...all.map(px)),
    clippedNames: names.filter((e) => e.scrollHeight > e.clientHeight + 1).length,
    clippedNodes: nodes.filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1).length,
    nodesOutsideX: nodes.filter((e) => { const r = e.getBoundingClientRect(); return r.right > box.right + 1 || r.left < box.left - 1 }).length,
    graphBottom: Math.round(box.bottom), vh: innerHeight, pageScrollH: document.documentElement.scrollHeight,
    hscroll: document.documentElement.scrollWidth > innerWidth,
  }
})()`
const result = []
for (const [label, w, h, mobile] of sizes) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: base + 'ontology/' })
  await sleep(3000)
  const r = { viewport: label }
  r.default = await ev(measure)
  r.shown = await ev(`document.querySelector('[data-testid=onto-shown]').textContent.slice(0, 50)`)
  await shot(`${label}-1-default.png`)
  // 次の行動の2件目の応募を押す: 押した行の位置が動かないこと、カードが画面内に出ること
  const rowTop = () => ev(`Math.round(document.querySelectorAll('[data-testid=sub-item] > button')[1].getBoundingClientRect().top)`)
  const before = await rowTop()
  await click('[data-testid=sub-item]:nth-child(2) > button')
  await sleep(900)
  r.rowMoved = (await rowTop()) - before
  r.cardRect = await ev(`(() => { const t = document.querySelector('[data-testid=node-card-title]').getBoundingClientRect(); return { top: Math.round(t.top), bottom: Math.round(t.bottom), inView: t.top >= 0 && t.bottom <= innerHeight } })()`)
  r.focusOnCard = await ev(`document.activeElement?.getAttribute('data-testid')`)
  r.selectedInLane = await ev(`(() => { const b = document.querySelector('[data-node-id][aria-pressed=true]'); if (!b) return null; const r = b.getBoundingClientRect(); const g = document.querySelector('[data-testid=graph-area]').getBoundingClientRect(); return r.top >= g.top - 1 && r.bottom <= g.bottom + 1 })()`)
  r.overflowing = await ev(`[...document.querySelectorAll('#main-content *')].filter((e) => e.getBoundingClientRect().bottom > innerHeight + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 6).map((e) => e.tagName + '.' + (e.getAttribute('data-testid') || String(e.className).slice(0, 50)) + ':' + Math.round(e.getBoundingClientRect().bottom))`)
  r.unclipped = await ev(`[...document.querySelectorAll('body *')].filter((e) => { if (e.getBoundingClientRect().bottom <= innerHeight + 1) return false; for (let a = e; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflowY !== 'visible' || cs.position === 'fixed') return false } return true }).slice(0, 5).map((e) => e.tagName + '.' + String(e.className).slice(0, 60) + ':' + Math.round(e.getBoundingClientRect().bottom))`)
  r.chain = await ev(`(() => { const out = []; let e = document.querySelector('[data-testid=node-card]'); while (e && e !== document.body) { const cs = getComputedStyle(e); out.push(e.tagName + ':' + Math.round(e.getBoundingClientRect().height) + ':' + cs.overflowY + ':' + cs.position + ':' + cs.height); e = e.parentElement } return out })()`)
  r.afterSelect = await ev(`({ pageScrollH: document.documentElement.scrollHeight, scrollY: Math.round(scrollY), graphBottom: Math.round(document.querySelector('[data-testid=graph-area]').getBoundingClientRect().bottom) })`)
  await shot(`${label}-2-next-sub-card.png`)
  // 総司令官の判断待ち
  await click('#tab-gates')
  await click('[data-testid=gate-item] button')
  await sleep(700)
  r.gateNote = await ev(`!!document.querySelector('[data-testid=gate-note]')`)
  await shot(`${label}-3-gate.png`)
  // データが使えなければ（影響のノード全部が図に入るか）
  await click('#tab-impact')
  await ev(`(() => { const s = document.querySelector('[data-testid=impact-select]'); const o = [...s.options].find((x) => /国土数値情報 都市公園/.test(x.textContent)) || s.options[1]; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(900)
  r.impactLists = await ev(`document.querySelectorAll('[data-testid=impact-list]').length`)
  r.impactedLanes = await ev(`[...document.querySelectorAll('[data-testid=lane] [data-node-id^="id:sub/"]')].filter((x) => x.getAttribute('aria-pressed') !== null && x.textContent.includes('影響')).length`)
  await shot(`${label}-4-impact-lanes.png`)
  await click('[data-testid=impact-graph-btn]')
  await sleep(1500)
  r.impactGraph = await ev(`(() => { const g = document.querySelector('[data-testid=graph-area]').getBoundingClientRect(); const ns = [...document.querySelectorAll('[data-node-id]')].filter((x) => x.getAttribute('aria-label').includes('影響を受ける')); return { impacted: ns.length, allInside: ns.every((x) => { const r = x.getBoundingClientRect(); return r.left >= g.left - 1 && r.right <= g.right + 1 && r.top >= g.top - 1 && r.bottom <= g.bottom + 1 }) } })()`)
  await shot(`${label}-5-impact-graph.png`)
  await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent === '強調をやめる').click()`)
  // 近傍だけ表示（選んだノードのカードから）
  await click('[data-testid=mode-lanes]')
  await sleep(500)
  await click('[data-testid=lane] [data-node-id^="id:sub/"]')
  await sleep(500)
  await click('[data-testid=focus-btn]')
  await sleep(1200)
  r.focusShown = await ev(`document.querySelector('[data-testid=onto-shown]').textContent.slice(0, 60)`)
  await shot(`${label}-6-focus.png`)
  await click('[data-testid=focus-btn]')
  await click('[data-testid=mode-lanes]')
  // 検索
  await click('#tab-list')
  await ev(`(() => { const i = document.querySelector('[data-testid=onto-search]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'ああああ'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(300)
  r.search0 = await ev(`document.querySelector('[data-testid=onto-list-count]').textContent`)
  await shot(`${label}-7-search0.png`)
  // 凡例とヘッダーの現在地
  r.legend = await ev(`!!document.querySelector('[data-testid=legend]') && document.querySelector('[data-testid=legend]').getBoundingClientRect().top < innerHeight`)
  r.headerCurrent = await ev(`document.querySelector('[data-testid=ontology-link]').getAttribute('aria-current')`)
  r.errors = errs.splice(0)
  result.push(r)
}
console.log(JSON.stringify(result, null, 2))
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
process.exit(result.some((r) => r.errors.length || r.default.hscroll) ? 1 : 0)
