// トップ（大きなカード版）の収まり・下の空白・カード内で隠れた中身を、複数の画面サイズで測る（要 preview 起動・google-chrome・node 22+）。
// usage: node scripts/bigcards.mjs <base_url> <out_dir>
// 出力: 各サイズの scrollHeight / innerHeight / scrollWidth、同時に全部見えているアプリカードの枚数、スクリーンショット。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-'))
const proxy = process.env.https_proxy || process.env.HTTPS_PROXY
const args = ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`]
if (proxy) args.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=127.0.0.1;localhost')
args.push('about:blank')
const chrome = spawn('google-chrome', args, { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ }
  await sleep(200)
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value
const shot = async (name) => fs.writeFileSync(path.join(outDir, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))

const sizes = [[1513, 784], [1280, 800], [1440, 900], [1920, 1080], [1024, 768], [1100, 800], [1200, 800], [390, 844]]
const out = []
const measure = `(() => {
  // カードの中で、カードの下端より下にはみ出して切れている子要素（ボタン・見出し・段落）を数える
  const isClamp = (e) => getComputedStyle(e).webkitLineClamp !== 'none'
  const clipped = (card) => {
    const cb = card.getBoundingClientRect().bottom - 2
    let n = 0
    for (const el of card.querySelectorAll('*')) {
      if (el.closest('details') || el.closest('svg')) continue
      if (el.parentElement.closest('[class*=line-clamp]')) continue // line-clamp で意図して省略した行の中身は数えない
      const r = el.getBoundingClientRect()
      if (r.height === 0 || r.width === 0) continue
      if (r.bottom > cb) { n++; if (window.__dbg) console.log('x'); (window.__why ||= []).push(card.dataset.contestCard + ':' + el.tagName + ':' + (el.textContent||'').slice(0,20) + ':' + Math.round(r.bottom - cb)); continue }
      // overflow:hidden の入れ物（line-clamp 以外）の下端を超えている子 = 隠れている
      for (let p = el.parentElement; p && p !== card.parentElement; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (cs.overflowY !== 'visible' && !isClamp(p) && r.bottom > p.getBoundingClientRect().bottom + 0.5) { n++; (window.__why ||= []).push('anc:' + card.dataset.contestCard + ':' + el.tagName + ':' + (el.textContent||'').slice(0,25) + ':' + p.tagName + '.' + String(p.className).slice(0,30)); break }
      }
      // 行の途中で切れる（line-clamp 以外で scrollHeight > clientHeight）
    }
    for (const el of card.querySelectorAll('*')) {
      if (el.closest('details')) continue
      const cs = getComputedStyle(el)
      if (cs.overflowY !== 'visible' && !isClamp(el) && el.scrollHeight > el.clientHeight + 1) { n++; (window.__why ||= []).push('sh:' + card.dataset.contestCard + ':' + el.tagName + ':' + String(el.className).slice(0,50) + ':' + el.scrollHeight + '/' + el.clientHeight) }
    }
    return n
  }
  const cc = [...document.querySelectorAll('[data-contest-card]')]
  // ボタンの上の空白（px）: ボタン行の上端 − 本文の最後の要素の下端。1行（約20px）未満が目標
  // 本文の入れ物の余り = 入れ物の高さ − 子の高さの合計 − 子の間の標準の隙間（4px）。均等配置（justify-between）で隙間に散っても余りとして数える
  const gapAbove = cc.map((c) => { const reg = c.querySelector('[data-testid^=pick-]').parentElement.previousElementSibling; const kids = [...reg.children].filter((k) => k.getBoundingClientRect().height > 0); const used = kids.reduce((a, k) => a + k.getBoundingClientRect().height, 0) + 4 * (kids.length - 1); return Math.round(reg.getBoundingClientRect().height - used) })
  // 横に切れている子（カードの右端より右）
  const xClip = (card) => { const cr = card.getBoundingClientRect().right + 1; let n = 0; for (const el of card.querySelectorAll('*')) { if (el.closest('details') || el.closest('svg')) continue; const r = el.getBoundingClientRect(); if (r.width && r.right > cr) n++ } return n }
  const pickWrap = [...document.querySelectorAll('[data-testid^=pick-targets-]')].filter((b) => b.getBoundingClientRect().height > 0).some((b) => b.getBoundingClientRect().height > 40 && b.textContent.length < 30 && false)
  const ac = [...document.querySelector('[data-testid=app-row]').children]
  const row = document.querySelector('[data-testid=app-row]'), box = row.getBoundingClientRect()
  const vis = ac.filter((c) => { const r = c.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1 })
  const partial = ac.filter((c) => { const r = c.getBoundingClientRect(); return r.right > box.left && r.left < box.right })
  const lowest = Math.max(...['[data-testid=app-section]', '[data-testid=draft-note]', '[data-testid=contest-list]'].map((q) => document.querySelector(q).getBoundingClientRect().bottom))
  return {
    scrollHeight: document.documentElement.scrollHeight, innerHeight, scrollWidth: document.documentElement.scrollWidth, innerWidth,
    lowestBottom: Math.round(lowest), gapBelow: Math.round(innerHeight - lowest),
    gapAbove, contestXClip: cc.map(xClip), btnsInView: cc.every((c) => c.querySelector('[data-testid^=pick-]').getBoundingClientRect().bottom <= innerHeight), appBtnLines: [...document.querySelectorAll('[data-testid^=pick-targets-]')].slice(0, 4).map((b) => Math.round(b.getBoundingClientRect().height)),
    contestCardH: cc.map((c) => Math.round(c.getBoundingClientRect().height)), contestClipped: cc.map(clipped),
    appCardH: Math.round(ac[0].getBoundingClientRect().height), appCardW: Math.round(ac[0].getBoundingClientRect().width), appClipped: ac.map(clipped).reduce((a, b) => a + b, 0),
    appsFullyVisible: vis.length, appsVisibleIncludingPartial: partial.length, totalApps: ac.length,
  }
})()`
for (const [w, h] of sizes) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 })
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(200)
  await send('Page.navigate', { url: base })
  await sleep(2500)
  // 負荷試験: STRESS=1.35 なら全部の行の高さを 1.35 倍にし（実機の Chrome とフォントが違う状況の代わり）、画面を1px 動かして再計算させる
  if (process.env.STRESS) {
    await ev(`(() => { const st = document.createElement('style'); st.textContent = '#root *:not(svg):not(path){line-height:${process.env.STRESS} !important}'; document.head.appendChild(st) })()`)
    await send('Emulation.setDeviceMetricsOverride', { width: w + 1, height: h, deviceScaleFactor: 1, mobile: w < 600 })
    await sleep(300)
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 })
    await sleep(800)
  }
  await ev('window.__why = []')
  const m = await ev(measure)
  if (process.env.WHY) console.log('why', w, JSON.stringify(await ev('window.__why')))
  out.push({ size: `${w}x${h}`, ...m, noVScroll: m.scrollHeight <= m.innerHeight, noHScroll: m.scrollWidth <= m.innerWidth })
  await shot(`top-${w}x${h}.png`)
  if (w === 1513) {
    await ev(`document.querySelector('[data-testid=pick-targets-biz-realestate]').click()`)
    await sleep(500)
    await shot(`top-${w}x${h}-popover.png`)
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await ev(`document.querySelector('[data-testid=pick-satellite-2026]').click()`)
    await sleep(500)
    await shot(`top-${w}x${h}-selected.png`)
    // 絞り込みで 0 件のとき、アプリ欄に理由と解除ボタンが出る
    await ev(`(() => { const i = document.querySelector('[data-testid=top-app-filter]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'zzzz'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await sleep(400)
    console.log('empty-state:', await ev(`document.querySelector('[data-testid=app-empty]')?.textContent`), '| position:', await ev(`document.querySelector('[data-testid=row-position]').textContent`))
    await shot(`top-${w}x${h}-empty.png`)
    await ev(`document.querySelector('[data-testid=clear-filter]').click()`)
    await sleep(400)
    console.log('position after clear:', await ev(`document.querySelector('[data-testid=row-position]').textContent`))
  }
}
console.log(JSON.stringify(out))
console.log('why', JSON.stringify(await ev('window.__why')))
for (const o of out) console.log(JSON.stringify(o))
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
