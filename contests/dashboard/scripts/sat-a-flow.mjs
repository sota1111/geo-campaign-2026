// sat-a（ダッシュボード）の第3〜5手順の流れの確認（ヘッドレスChrome + CDP）。
// usage: npx vite preview --port 8891 --host 127.0.0.1 & ; node scripts/sat-a-flow.mjs http://127.0.0.1:8891/ <out_dir> <csv_dir>
// 確かめること（1513×784 と 390×844）: 未入力の手順4・5に「手順3へ戻る」「説明用デモ」の導線／デモ中はヘッダのバッジが架空表示／
//   デモで較正→第2回のパネルに「架空」／見本 CSV だけで較正まで進める／検証タブの表がはみ出さない
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir, csvDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0

async function open() {
  const port = 9400 + Math.floor(Math.random() * 90)
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-'))
  const ch = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
  let t
  for (let i = 0; i < 50; i++) { try { t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (t.length) break } catch { /* retry */ } await sleep(200) }
  const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const p = new Map()
  const errs = []
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && p.has(d.id)) { p.get(d.id)(d); p.delete(d.id) }
    if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text)
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 150))
  }
  const send = (m, pa = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: pa })) })
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value
  await send('Runtime.enable'); await send('Page.enable')
  return { send, ev, errs, close: () => { ws.close(); ch.kill(); try { fs.rmSync(prof, { recursive: true, force: true }) } catch { /* ignore */ } } }
}

for (const [lab, w, h, mobile] of [['d', 1513, 784, false], ['m', 390, 844, true]]) {
  const c = await open()
  const log = (k, v) => console.log(lab, k, typeof v === 'string' ? v : JSON.stringify(v))
  const need = (cond, msg) => { if (!cond) { bad++; console.log(lab, 'NG', msg) } }
  const shot = async (n) => { await sleep(700); const s = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, `${lab}-${n}.png`), Buffer.from(s.result.data, 'base64')) }
  // 手順（左のリストの行）を data-step で開く。スマホは上部バーを開いてから押す
  const goStep = async (sid) => {
    const has = await c.ev(`!!document.querySelector('[data-step=${sid}]') && document.querySelector('[data-step=${sid}]').getClientRects().length>0`)
    if (!has && mobile) { await c.ev(`document.querySelector('[data-testid=steps-topbar] > button').click()`); await sleep(400) }
    await c.ev(`document.querySelector('[data-step=${sid}]').click()`); await sleep(500)
    if (mobile) { const open = await c.ev(`!!document.querySelector('[data-step=${sid}]') && document.querySelector('[data-step=${sid}]').getClientRects().length>0`); if (open) { await c.ev(`document.querySelector('[data-testid=steps-topbar] > button').click()`); await sleep(400) } }
  }
  const click = async (tid) => { await c.ev(`(()=>{const e=document.querySelector('[data-testid=${tid}]'); e.scrollIntoView({block:'center'}); e.click()})()`); await sleep(500) }
  const exists = (tid) => c.ev(`!!document.querySelector('[data-testid=${tid}]')`)
  const text = (sel) => c.ev(`document.querySelector('${sel}')?.innerText ?? ''`)
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await c.send('Page.navigate', { url: `${base}apps/sat-a/` })
  await sleep(4000)
  const badge = () => c.ev(`[...document.querySelectorAll('[data-kind]')].filter(e=>e.getClientRects().length>0).map(e=>e.textContent).join('|')`)
  log('badge default', await badge())
  // 未入力の手順4・5
  await goStep('apply'); await shot('1-apply-empty')
  need(await exists('goto-scan') && await exists('apply-demo-on'), '手順4: 導線のボタンが無い')
  await goStep('round2'); await shot('2-round2-empty')
  need(await exists('goto-scan') && await exists('round2-demo-on'), '手順5: 導線のボタンが無い')
  await click('goto-scan')
  need(await exists('csv-file'), '手順3へ戻るボタンが効かない')
  await click('demo-go'); log('badge demo', await badge())
  need((await badge()).includes('架空を含む'), 'デモ中のヘッダのバッジが架空表示でない')
  await shot('3-demo-on')
  need((await text('[data-testid=demo-on]')).includes('過去の調査'), 'デモ中に過去の調査の説明が無い')
  // 選んで走査 → 較正 → 第2回
  await goStep('pick'); await c.ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('自動で選ぶ'))?.click()`); await sleep(400)
  await goStep('scan')
  need(Number(await text('[data-testid=s3-count]')) > 0, 'デモをオンにしたら選択が消えた')
  await click('demo-scan'); await goStep('apply'); await click('apply'); await sleep(400)
  await goStep('round2'); await shot('4-round2-demo')
  need(await exists('round2-fake'), '第2回のパネルに「架空」の注記が無い')
  log('round2 fake', await text('[data-testid=round2-fake]'))
  // 見本 CSV
  for (const f of ['format_sample_by_segment.csv', 'format_sample_by_point.csv']) {
    await goStep('scan')
    if (await exists('demo-toggle')) { const on = await c.ev(`document.querySelector('[data-testid=demo-toggle]').checked`); if (on) await click('demo-toggle') }
    await sleep(500)
    const body = JSON.stringify(fs.readFileSync(path.join(csvDir, f), 'utf8'))
    await c.ev(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${body}],${JSON.stringify(f)},{type:'text/csv'}));const i=document.querySelector('[data-testid=csv-file]');i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await sleep(700)
    log(f, await text('[data-testid=load-msg]'))
    await shot('5-' + f.slice(14, 20))
    await goStep('apply')
    const dis = await c.ev(`document.querySelector('[data-testid=apply]').disabled`)
    need(dis === false, f + ': 見本だけでは較正に進めない')
    await shot('6-apply-' + f.slice(14, 20))
  }
  // 書き出した CSV の中身（data_note）。見本 CSV＝架空 / 利用者の CSV＝利用者の調査結果による。結果を消したら初めに戻る
  await c.ev(`(()=>{const o=URL.createObjectURL.bind(URL); URL.createObjectURL=(b)=>{window.__b=b; return o(b)}})()`)
  const exportText = async () => { await click('export-round2'); await sleep(300); return await c.ev(`window.__b.text()`) }
  const loadCsv = async (name, body) => {
    await goStep('scan')
    const b = JSON.stringify(body)
    await c.ev(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${b}],${JSON.stringify(name)},{type:'text/csv'}));const i=document.querySelector('[data-testid=csv-file]');i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await sleep(700)
  }
  await goStep('apply'); await click('apply'); await sleep(400)
  await shot('8-applied'); await goStep('apply'); await shot('9-applied-step4'); need(await exists('goto-round2'), 'R4: 反映後に第2回へ向かう主ボタンが無い')
  await goStep('round2')
  let csvTxt = await exportText(); log('csv sample', csvTxt.split('\n').slice(0, 2).join(' / '))
  need(/data_note/.test(csvTxt) && csvTxt.includes('見本 CSV（架空の値）で較正') && !csvTxt.includes('実データ（豊中市'), 'R1: 見本で較正した書き出しの data_note が架空でない')
  await goStep('scan'); await click('clear-res')
  await goStep('round2'); need(await exists('round2-empty'), 'R2: 結果を消したのに第2回の順位が残る')
  const segCsv = fs.readFileSync(path.join(csvDir, 'format_sample_by_segment.csv'), 'utf8').replace(/架空の見本（実際の調査結果ではありません）/g, '自治体調査')
  await loadCsv('user.csv', segCsv)
  await goStep('apply'); await click('apply'); await sleep(400)
  await goStep('round2'); csvTxt = await exportText(); log('csv user', csvTxt.split('\n').slice(0, 2).join(' / '))
  need(csvTxt.includes('利用者の調査結果による') && !csvTxt.includes('架空'), 'R1: 利用者の CSV で較正した書き出しの data_note が不正')
  await goStep('scan'); await click('clear-res')
  // 検証タブ
  if (mobile) { await c.ev(`document.querySelector('[data-testid=steps-topbar] > button').click()`); await sleep(400) }
  await c.ev(`[...document.querySelectorAll('summary,button')].find(e=>e.textContent.includes('参考（任意）'))?.click()`); await sleep(400)
  if (mobile) { await c.ev(`document.querySelector('[data-step=verify]').click()`); await sleep(500) } else await goStep('verify')
  await shot('7-verify')
  need(await exists('verify-summary'), '検証: 冒頭の要点が無い')
  const over = await c.ev(`(()=>{const p=document.querySelector('[data-testid=verify-panel]'); return [...p.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+1 && getComputedStyle(e).overflowX!=='visible').map(e=>e.tagName+'.'+String(e.className).slice(0,60)+' '+e.scrollWidth+'/'+e.clientWidth).join(' ; ')})()`)
  log('verify overflow', over); need(over === '', '検証: 横にはみ出す要素がある')
  need((await c.ev('document.documentElement.scrollWidth')) <= w, '横スクロール')
  log('errs', c.errs); need(c.errs.length === 0, 'コンソールエラー')
  c.close()
}
console.log(bad ? `NG ${bad}` : 'OK')
process.exit(bad ? 1 : 0)
