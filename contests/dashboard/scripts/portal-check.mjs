// ポータルの確認（2026-11-13: 詳細を「右から重ねるパネル」から「一覧の下の固定の詳細欄」に変更）。
// 1280×765 と 390×844 で、第一画面（4行・ページが画面に収まる）、各行の選択・切り替え・詳細欄の深部スクロール後の切り替えでの
// scrollY・行 top・scrollHeight の不変、詳細欄が見える範囲に出ること、ホイール、第3回ジャンプ、キーボード、ハッシュ復元、
// スマホの縮んだ一覧、横溢れ、評価レーダー・評価ダイアログ、アプリからの戻り、コンソールエラーを数値で出し、スクリーンショットを保存する。
// usage: node scripts/portal-check.mjs <base_url> <out_dir>   （要 preview 起動・google-chrome）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'pcheck-'))
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
  if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text)
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push(d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200))
}
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable')
const save = async (name, full) => {
  const h = await ev('document.documentElement.scrollHeight')
  const params = full ? { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: await ev('innerWidth'), height: Math.min(h, 6000), scale: 1 } } : { format: 'png' }
  fs.writeFileSync(path.join(outDir, name), Buffer.from((await send('Page.captureScreenshot', params)).result.data, 'base64'))
}
const J = async (e) => { const v = await ev(`JSON.stringify(${e})`); if (v === undefined) { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); console.error('EVAL FAIL', JSON.stringify(r.result?.exceptionDetails?.exception?.description ?? r).slice(0, 300), e.slice(0, 120)) } return JSON.parse(v) }
const rect = (sel) => `(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: r.left, width: r.width, height: Math.round(r.height) } })()`
const ids = ['satellite-2026', 'ichibiz-2026', 'udc-2026', 'odpt-2026']
const load = async (hash = '') => {
  await send('Page.navigate', { url: 'about:blank' }); await sleep(200)
  await send('Page.navigate', { url: `${base}index.html${hash}` }); await sleep(2200)
}
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(500)
}
const clickSel = async (sel) => { const r = await J(rect(sel)); await clickAt(r.left + Math.min(r.width / 2, 120), r.top + Math.min(r.height / 2, 25)) }
const clickScrolled = async (sel) => { await ev(`document.querySelector('${sel}').scrollIntoView({ block: 'center' })`); await sleep(150); await clickSel(sel) }
const row = (id) => `[data-testid=row-${id}]`
const pressed = (id) => ev(`document.querySelector('${row(id)}')?.getAttribute('aria-pressed') === 'true'`)
// 選ぶ（すでに選んでいる行は押さない。スマホでは同じ行をもう一度押すと一覧が戻るため）
const pick = async (id) => { if (!(await pressed(id))) await clickSel(row(id)) }
const snapAll = () => J(`({ scrollY: Math.round(scrollY), tops: ${JSON.stringify(ids)}.map((id) => Math.round(document.querySelector('[data-testid=row-' + id + ']').getBoundingClientRect().top)), docH: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth })`)
const paneInfo = (id, vh) => J(`(() => { const b = document.querySelector('[data-testid=detail-${id}]'); if (!b) return null; const r = b.getBoundingClientRect(); const p = document.querySelector('[data-testid=detail-pane]').getBoundingClientRect(); return { inner: Math.round(b.scrollTop), innerMax: b.scrollHeight - b.clientHeight, boxTop: Math.round(r.top), boxBottom: Math.round(r.bottom), paneTop: Math.round(p.top), paneH: Math.round(p.height), paneHalf: p.height >= ${vh} / 2, visible: r.top >= 0 && r.bottom <= innerHeight + 1 && r.height > 100, overlay: !!document.querySelector('[role=dialog]'), title: document.querySelector('[data-testid=detail-title]').textContent } })()`)
const wheel = async (mobile, dy) => { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mobile ? 200 : 640, y: 600, deltaX: 0, deltaY: dy }); await sleep(300) }
const keyPress = async (key, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }); await sleep(250) }

const out = []
for (const [label, w, h0, mobile] of [['1280', 1280, 765, false], ['390', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h0, deviceScaleFactor: 1, mobile })
  await load()
  // 第一画面: 4行が見える・ページが画面の高さに収まる・詳細欄の大きさ
  const first = await snapAll()
  const bottoms = await J(`${JSON.stringify(ids)}.map((id) => Math.round(document.querySelector('[data-testid=contest-' + id + ']').getBoundingClientRect().bottom))`)
  out.push({ label, firstScreen: { viewportH: h0, first, rowBottoms: bottoms, fit: bottoms.every((b) => b <= h0), pageFits: first.docH <= h0, stagesPerRow: await J(`${JSON.stringify(ids)}.map((id) => document.querySelectorAll('[data-testid=row-' + id + '] [data-testid=row-stage]').length)`), pane: await J(rect('[data-testid=detail-pane]')), preSelected: await J(`${JSON.stringify(ids)}.filter((id) => document.querySelector('[data-testid=row-' + id + ']').getAttribute('aria-pressed') === 'true')`), sidebarOrder: await J(`[...document.querySelectorAll('[data-sidebar=group-label]')].map((e) => e.textContent.slice(0, 8))`), noSheet: !(await ev(`!!document.querySelector('[data-testid=detail-sheet]')`)) } })
  await save(`${label}-01-first.png`)

  // 中4: 状況の理由文。行内で省略されない（全文が折り返して見える）。詳細欄の先頭にも全文がある（PCのみ行内に理由を出す）
  {
    const reasons = await J(`${JSON.stringify(ids)}.map((id) => { const r = document.querySelector('[data-testid=row-' + id + '] [data-testid=row-reason]'); if (!r) return null; const cs = getComputedStyle(r); return { text: r.textContent, shown: cs.display !== 'none', clipped: r.scrollHeight > r.clientHeight + 1 || r.scrollWidth > r.clientWidth + 1, lineClamp: cs.webkitLineClamp, overflow: cs.overflow, w: Math.round(r.getBoundingClientRect().width) } })`)
    const detailReason = await J(`document.querySelector('[data-testid=detail-reason]')?.textContent ?? null`)
    out.push({ label, reasonFull: { reasons, detailReason, noEllipsis: mobile ? true : reasons.every((r) => r && r.shown && !r.clipped && (r.lineClamp === 'none' || !r.lineClamp) && r.overflow === 'visible'), detailHasReason: !!detailReason && detailReason.includes('提出不可') } })
  }
  // 全行を順に選ぶ（1回ずつ）。詳細欄の深部までスクロールした状態から別の行へ切り替えても、scrollY・行 top・scrollHeight は不変
  await load()
  await pick('satellite-2026')
  const base = await snapAll()
  const seq = []
  let compactBase = null
  const order = ['ichibiz-2026', 'udc-2026', 'odpt-2026', 'satellite-2026', 'odpt-2026', 'ichibiz-2026']
  for (const id of order) {
    await ev(`(() => { const b = document.querySelector('[data-testid^=detail-][id^=detail-]'); if (b) b.scrollTop = b.scrollHeight })()`)
    await sleep(200)
    const pre = await snapAll()
    await clickSel(row(id)) // 1回押すだけで切り替わる
    const post = await snapAll()
    const pane = await paneInfo(id, h0)
    seq.push({ id, pre, post, pane, hash: await ev('location.hash'), pressedOk: (await pressed(id)) === true, onlyOne: (await ev(`document.querySelectorAll('[data-testid^=row-][aria-pressed=true]').length`)) === 1, innerAfterSwitch: pane?.inner, stable: JSON.stringify(pre) === JSON.stringify(post) && post.docH <= h0 })
    if (id === 'udc-2026') await save(`${label}-02-select-udc.png`)
    if (id === 'ichibiz-2026' && seq.length === 1) await save(`${label}-02-select-ichibiz.png`)
  }
  const deep = await paneInfo('ichibiz-2026', h0)
  await ev(`(() => { const b = document.getElementById('detail-ichibiz-2026'); b.scrollTop = b.scrollHeight })()`)
  await sleep(300)
  await save(`${label}-03-deep.png`)
  out.push({ label, selectSequence: seq, allStable: seq.every((s) => s.stable), allOne: seq.every((s) => s.onlyOne && s.pressedOk), allVisible: seq.every((s) => s.pane?.visible && !s.pane.overlay && s.pane.paneHalf !== undefined), minPaneH: Math.min(...seq.map((s) => s.pane.paneH)), deepAfter: await snapAll(), deep })

  // 詳細欄の中をホイールでスクロール → ページは動かない。上端・下端でも連鎖しない
  {
    const before = await snapAll()
    await ev(`document.getElementById('detail-ichibiz-2026').scrollTop = 0`)
    await wheel(mobile, 600)
    const mid = await J(`({ inner: Math.round(document.getElementById('detail-ichibiz-2026').scrollTop), y: Math.round(scrollY) })`)
    await wheel(mobile, 20000)
    const end = await J(`({ inner: Math.round(document.getElementById('detail-ichibiz-2026').scrollTop), y: Math.round(scrollY) })`)
    out.push({ label, wheel: { mid, end, pageSame: JSON.stringify(await snapAll()) === JSON.stringify(before) } })
  }
  // 「第3回の比較へ」: 押したときだけ詳細欄の中が動く。一覧は動かない
  {
    await ev(`document.getElementById('detail-ichibiz-2026').scrollTop = 0`)
    const before = await snapAll()
    await clickSel('[data-testid=jump-eval3]')
    out.push({ label, jump: { inner: await ev(`Math.round(document.getElementById('detail-ichibiz-2026').scrollTop)`), pageSame: JSON.stringify(await snapAll()) === JSON.stringify(before) } })
  }
  // ハッシュ復元: #open=odpt-2026 で読み込むと、その詳細欄が開く
  await load('#open=odpt-2026')
  out.push({ label, hashRestore: { pane: await paneInfo('odpt-2026', h0), pressed: await pressed('odpt-2026'), snap: await snapAll() } })

  // キーボード: 上下キーで行のフォーカスだけが動き、Enter / Space で選ぶ
  await load()
  await ev(`document.querySelector('${row('satellite-2026')}').focus()`)
  const y0 = await snapAll()
  await keyPress('ArrowDown', 'ArrowDown', 40)
  const f1 = await ev('document.activeElement?.dataset?.testid')
  const sel1 = await J(`${JSON.stringify(ids)}.filter((id) => document.querySelector('[data-testid=row-' + id + ']').getAttribute('aria-pressed') === 'true')`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(300)
  const afterEnter = await J(`({ title: document.querySelector('[data-testid=detail-title]').textContent, focus: document.activeElement?.dataset?.testid })`)
  await keyPress('ArrowDown', 'ArrowDown', 40)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }); await sleep(300)
  const afterSpace = await J(`({ title: document.querySelector('[data-testid=detail-title]').textContent, focus: document.activeElement?.dataset?.testid })`)
  await keyPress('ArrowUp', 'ArrowUp', 38)
  const up = await ev('document.activeElement?.dataset?.testid')
  const outline = await ev(`getComputedStyle(document.activeElement).outlineStyle`)
  out.push({ label, keyboard: { f1, sel1, afterEnter, afterSpace, up, outline, pageSame: JSON.stringify(await snapAll()) === JSON.stringify(y0) || label === '390' } })
  await save(`${label}-04-keyboard.png`)
}
if (true) {
  // スマホ（2026-11-13 中1・中2）: 選択・同じ行の再押下（解除はしない）・切り替えの前後で、行の top が不変（許容差1px）。
  // 一覧は縮めない。各行に 状況・次の締切・判断待ちの段階名・次の一手 が読める（切れていない）。詳細欄は画面の4割以上
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await load()
  const tops = async () => (await snapAll())
  const t0 = await tops()
  const steps = []
  for (const id of ['udc-2026', 'udc-2026', 'odpt-2026', 'satellite-2026', 'ichibiz-2026', 'ichibiz-2026']) {
    await clickSel(row(id))
    const t = await tops()
    steps.push({ id, pressed: await pressed(id), maxDiff: Math.max(...t.tops.map((v, i) => Math.abs(v - t0.tops[i]))), scrollY: t.scrollY, docH: t.docH })
  }
  const rowH = await J(`${JSON.stringify(ids)}.map((id) => Math.round(document.querySelector('[data-testid=row-' + id + ']').getBoundingClientRect().height))`)
  const rowText = await J(`${JSON.stringify(ids)}.map((id) => { const r = document.querySelector('[data-testid=row-' + id + ']'); const q = (t) => r.querySelector('[data-testid=row-' + t + ']'); const cut = (e) => e.scrollWidth > e.clientWidth + 1; return { status: q('status').textContent, deadline: q('deadline').textContent, pendingStage: [...r.querySelectorAll('[data-testid=row-stage][data-mark=？]')].map((e) => e.textContent), next: q('next').textContent.slice(0, 30), statusCut: cut(q('status')), nextCut: cut(q('next')), stagesCut: cut(q('progress')), rowOverflowX: r.scrollWidth > r.clientWidth + 1 } })`)
  const paneH = (await J(rect('[data-testid=detail-pane]'))).height
  out.push({ label: '390', mobileRows: { t0, steps, rowH, rowText, paneH, paneShare: Math.round((paneH / 844) * 100) / 100, noShift: steps.every((s) => s.maxDiff <= 1 && s.scrollY === 0 && s.docH === t0.docH), alwaysSelected: steps.every((s) => s.pressed), paneOk: paneH >= 844 * 0.4, textOk: rowText.every((r) => r.pendingStage.length === 1 && !r.statusCut && !r.nextCut && !r.stagesCut && !r.rowOverflowX) } })
  await save('390-05-rows.png')
}
// 1280×500（背景が縦にスクロールできる高さ）: 詳細欄の深部から切り替えても scrollY・行 top・scrollHeight は不変
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 500, deviceScaleFactor: 1, mobile: false })
{
  await load()
  await ev('window.scrollTo(0, 100)'); await sleep(200)
  await pick('satellite-2026')
  const pre = await snapAll()
  const res = []
  for (const id of ['ichibiz-2026', 'udc-2026', 'odpt-2026']) {
    await ev(`(() => { const b = document.querySelector('[id^=detail-]'); b.scrollTop = b.scrollHeight })()`)
    await clickSel(row(id))
    res.push(await snapAll())
  }
  out.push({ label: '1280x500', pre, res, unchanged: res.every((r) => JSON.stringify(r) === JSON.stringify(pre)) })
}
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 765, deviceScaleFactor: 1, mobile: false })
// 第3回評価レーダー（2026-11-13 デザイン審査 M7〜M10 の対応）: 詳細パネル内・評価ダイアログ内の横溢れ、全系列選択、ジャンプ、背景の不変
const OVER = (rootSel) => `(() => {
  const root = document.querySelector('${rootSel}'); if (!root) return null
  const rr = root.getBoundingClientRect()
  const inFrame = (e) => { for (let a = e.parentElement; a && a !== root; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll') return true } return false }
  const all = [root, ...root.querySelectorAll('*')].filter((e) => e.clientWidth > 2 && !(e instanceof SVGElement))
  const scrollOver = all.filter((e) => e.scrollWidth > e.clientWidth + 1 && !(e !== root && getComputedStyle(e).overflowX !== 'visible' && e.hasAttribute('data-scroll-frame')) && !(e !== root && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX)) && !inFrame(e)).map((e) => (e.dataset.testid || e.tagName) + ':' + e.scrollWidth + '/' + e.clientWidth)
  const rightOver = [...root.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > rr.right + 1 && !inFrame(e) && !(e.hasAttribute('data-scroll-frame')) }).slice(0, 6).map((e) => (e.dataset.testid || e.tagName) + ' right=' + Math.round(e.getBoundingClientRect().right) + ' > ' + Math.round(rr.right))
  const frames = [...root.querySelectorAll('[data-scroll-frame], .overflow-x-auto')].map((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  return { root: { sw: root.scrollWidth, cw: root.clientWidth, equal: root.scrollWidth <= root.clientWidth }, scrollOver, rightOver, frames }
})()`
for (const [label, w, h0, mobile] of [['1280', 1280, 765, false], ['390', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h0, deviceScaleFactor: 1, mobile })
  const bg = () => J(`({ scrollY: Math.round(scrollY), tops: ${JSON.stringify(ids)}.map((id) => Math.round(document.querySelector('[data-testid=row-' + id + ']').getBoundingClientRect().top)), docH: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth })`)
  const box = (id) => `document.querySelector('[data-testid=detail-${id}]')`
  // M7: 4コンペでジャンプ。背景は不変、節の先頭に B 図全体（svg）が収まる
  await load()
  await pick('ichibiz-2026')
  const bg0 = await bg() // スマホは選ぶと一覧が縮むので、選んだあとを基準にする
  const m7 = []
  for (const id of ids) {
    await pick(id)
    const pre = await J(`({ top: ${box(id)}.scrollTop, hasBtn: !!document.querySelector('[data-testid=jump-eval3]'), btn: ${rect('[data-testid=jump-eval3]')}, header: ${rect('[data-testid=contest-list]')}, secTopBefore: ${box(id)}.querySelector('[data-testid=eval3-contest]').offsetTop })`)
    await clickSel('[data-testid=jump-eval3]')
    await sleep(200)
    const post = await J(`(() => { const b = ${box(id)}; const br = b.getBoundingClientRect(); const s = b.querySelector('[data-testid=eval3-contest]').getBoundingClientRect(); const svg = b.querySelector('[data-testid=eval3-contest] svg[data-testid=radar]').getBoundingClientRect(); return { scrollTop: Math.round(b.scrollTop), secTopInBox: Math.round(s.top - br.top), svgTopInBox: Math.round(svg.top - br.top), svgBottomInBox: Math.round(svg.bottom - br.bottom), boxH: Math.round(br.height), svgFits: svg.top >= br.top && svg.bottom <= br.bottom, legendAndFigureTogether: (() => { const lg = b.querySelector('[data-testid=eval3-figure] [data-testid=radar-legend]').getBoundingClientRect(); const hd = b.querySelector('[data-testid=eval3-figure-heading]').getBoundingClientRect(); const hint = b.querySelector('[data-testid=eval3-figure] p').getBoundingClientRect(); return { headingIn: hd.top >= br.top && hd.bottom <= br.bottom, legendIn: lg.top >= br.top && lg.bottom <= br.bottom, svgIn: svg.top >= br.top && svg.bottom <= br.bottom, hintIn: hint.bottom <= br.bottom + 1 } })(), focus: document.activeElement?.dataset?.testid ?? null } })()`)
    await save(`${label}-m7-jump-${id}.png`)
    m7.push({ id, pre, post, bg: JSON.stringify(await bg()) === JSON.stringify(bg0) })
  }
  out.push({ label, M7_jump: m7, allTogether: m7.every((x) => Object.values(x.post.legendAndFigureTogether).every(Boolean)), allSvgFit: m7.every((x) => x.post.svgFits), bgUnchanged: m7.every((x) => x.bg), fromTop: m7.every((x) => x.pre.top === 0) })
  // M8: イチBiz 全6系列（「全6案」ボタン）。図の右端・表のスクロール枠・パネル内の横溢れ
  await pick('ichibiz-2026')
  await clickSel('[data-testid=jump-eval3]')
  const presetsTxt = await J(`[...document.querySelectorAll('[data-testid^=eval3-preset-]')].map((b) => b.textContent + ':' + b.getAttribute('aria-pressed'))`)
  await clickScrolled('[data-testid=eval3-preset-all]')
  await sleep(300)
  const six = await J(`(() => { const b = ${box('ichibiz-2026')}; const br = b.getBoundingClientRect(); const svgs = [...b.querySelectorAll('svg[data-testid=radar]')].map((s) => { const r = s.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), inside: r.left >= br.left - 1 && r.right <= br.right + 1 } }); const legends = [...b.querySelectorAll('[data-testid=radar-legend]')].map((e) => { const r = e.getBoundingClientRect(); return Math.round(r.right) <= Math.round(br.right) + 1 }); const frames = [...b.querySelectorAll('[data-scroll-frame]')].map((f) => ({ sw: f.scrollWidth, cw: f.clientWidth, within: f.getBoundingClientRect().right <= br.right + 1, hint: !!f.parentElement.querySelector('[data-testid=scroll-hint]') })); const ths = [...b.querySelectorAll('[data-testid=radar-table] thead th')].slice(1).map((t) => Math.round(t.getBoundingClientRect().width)); return { series: b.querySelectorAll('[data-testid=eval3-contest] svg[data-testid=radar]:first-of-type [data-testid^=radar-series-]').length, boxRight: Math.round(br.right), svgs, legends, frames, thMinWidths: ths, docSw: document.documentElement.scrollWidth } })()`)
  const sixOver = await J(OVER('[data-testid=detail-ichibiz-2026]'))
  await save(`${label}-m8-ichibiz-six.png`)
  // 縦に動いて表の部分も撮る
  await ev(`(() => { const t = ${box('ichibiz-2026')}.querySelector('[data-testid=radar-table]'); t.scrollIntoView({ block: 'start' }) })()`)
  await sleep(200)
  await save(`${label}-m8-ichibiz-six-table.png`)
  const bgAfter = await bg()
  // ペア選択: ビジネス部門の2案 → 2系列
  await clickSel('[data-testid=jump-eval3]')
  await clickScrolled('[data-testid=eval3-preset-biz-business]')
  const pair = await J(`({ pressed: document.querySelector('[data-testid=eval3-preset-biz-business]').getAttribute('aria-pressed'), n: ${box('ichibiz-2026')}.querySelectorAll('[data-testid=eval3-contest] svg[data-testid=radar]')[0].querySelectorAll('[data-testid^=radar-series-]').length })`)
  // 全コンペで初期・全選択のパネル内横溢れ
  const overAll = []
  for (const id of ids) {
    await pick(id)
    overAll.push({ id, over: await J(OVER(`[data-testid=detail-${id}]`)) })
  }
  out.push({ label, M8_six: { presetsTxt, six, sixOver, pair, bgSame: JSON.stringify(bgAfter) === JSON.stringify(bg0), overAllContests: overAll } })
  // M9/M10: ポータルの評価ダイアログ
  await load()
  const entry = await J(`({ text: document.querySelector('[data-testid=open-eval]').textContent })`)
  const bgD0 = await bg()
  await clickSel('[data-testid=open-eval]')
  await sleep(500)
  const dlg = await J(`(() => { const d = document.querySelector('[data-testid=eval-dialog]'); const r = d.getBoundingClientRect(); const h = [...d.querySelectorAll('h2')].map((e) => e.textContent.replace(/\\s+/g, ' ')); return { title: d.querySelector('[role=dialog] h2, h2')?.textContent ?? null, headings: h, desc: d.querySelector('[id*=description], p')?.textContent.slice(0, 160), round3First: d.querySelector('[data-testid=eval-round3]').getBoundingClientRect().top < d.querySelector('[data-testid=eval-rounds-past]').getBoundingClientRect().top, sonnetOnlyInPast: !d.querySelector('[data-testid=eval-round3]').textContent.includes('Sonnet'), pastHasSonnet: d.querySelector('[data-testid=eval-rounds-past]').textContent.includes('Sonnet 4名'), w: Math.round(r.width) } })()`)
  await save(`${label}-m9-dialog-top.png`)
  const dOver = await J(OVER('[data-testid=eval-dialog]'))
  // 下までスクロールして撮影、スクロール後も溢れが無いこと
  await ev(`(() => { const d = document.querySelector('[data-testid=eval-dialog]'); d.scrollTop = d.querySelector('[data-testid=eval-rounds-past]').offsetTop - 60 })()`)
  await sleep(200)
  await save(`${label}-m10-dialog-past.png`)
  const dOver2 = await J(OVER('[data-testid=eval-dialog]'))
  out.push({ label, M9_M10: { entry, dlg, dialogOverflowTop: dOver, dialogOverflowAfterScroll: dOver2, bgSame: JSON.stringify(await bg()) === JSON.stringify(bgD0) } })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(400)
}
// アプリから戻る: 全行が閉じた一覧、ハッシュなし
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 765, deviceScaleFactor: 1, mobile: false })
for (const app of ['sat-a', 'odpt']) {
  await load('#open=satellite-2026')
  await send('Page.navigate', { url: `${base}apps/${app}/index.html?from=satellite-2026` }); await sleep(2500)
  const link = await ev(`document.querySelector('header a[href*="index.html"]').getAttribute('href')`)
  await ev(`document.querySelector('header a[href*="index.html"]').click()`); await sleep(2000)
  out.push({ back: app, link, url: await ev('location.pathname + location.hash'), openRows: await ev(`document.querySelectorAll('[data-testid^=row-][aria-pressed=true]').length`), scrollY: await ev('scrollY') })
  if (app === 'sat-a') await save('1280-07-back-from-app.png')
}
// 古い形式 #<コンペid> は無視される
await load('#satellite-2026')
out.push({ legacyHash: '#satellite-2026', openRows: await ev(`document.querySelectorAll('[data-testid^=row-][aria-pressed=true]').length`), scrollY: await ev('scrollY') })
console.log(JSON.stringify({ out, errs }, null, 1))
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
