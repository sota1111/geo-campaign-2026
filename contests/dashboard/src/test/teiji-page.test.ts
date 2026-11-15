import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
const { JSDOM } = createRequire(import.meta.url)('jsdom')
import fs from 'node:fs'
import path from 'node:path'

it('取得済み実データを初期表示し、空の事業者のCSVは無効にする', async () => {
  const root = path.resolve('../odpt-2026/app-teiji/web')
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/' })
  const win = dom.window
  win.fetch = async (url: string) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(root, url), 'utf8')) }) as never
  win.eval(fs.readFileSync(path.join(root, 'lib.js'), 'utf8'))
  win.eval(fs.readFileSync(path.join(root, 'app.js'), 'utf8'))
  await new Promise(resolve => setTimeout(resolve, 0))
  const doc = win.document
  const op = doc.getElementById('op') as HTMLSelectElement
  expect(op.value).toBe('b_bus_gtfs_rt-toei')
  expect(doc.getElementById('routes-table')!.textContent).toContain('都０１')
  expect(doc.getElementById('period')!.textContent).toContain('自動収集は未設定')
  expect((doc.getElementById('csv-routes') as HTMLButtonElement).disabled).toBe(false)
  op.value = 'odpt_kan_etsu_transportation_all_lines'
  op.dispatchEvent(new win.Event('change'))
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(doc.getElementById('routes-table')!.textContent).toContain('この時間帯は未取得です')
  expect((doc.getElementById('csv-routes') as HTMLButtonElement).disabled).toBe(true)
  expect(doc.getElementById('layout')!.classList.contains('no-segments')).toBe(true)
  dom.window.close()
})
