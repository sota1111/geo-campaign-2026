import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APPS } from '@/apps/registry'
import { fmtDue } from '@/pages/OntologyPage'
import {
  CAT, DEFAULT_SEVERITIES, DEFAULT_TYPES, NODE_H, NODE_W, TYPE_STYLE, appIdOf, blockerNodeId, buildIndex, buildLanes, contestOfSubmission, defaultView, shortName, impactSet, layout, neighbors, searchNodes, visibleEdges, visibleIds,
  type GraphData, type NextActions,
} from '@/lib/ontology'

// 生成済み JSON（contests/ontology/）をそのまま読む。画面はビルド時にこれを public/ontology/ へ写す
const dir = path.resolve(import.meta.dirname, '../../../ontology')
const graph = JSON.parse(fs.readFileSync(path.join(dir, 'graph.json'), 'utf8')) as GraphData
const na = JSON.parse(fs.readFileSync(path.join(dir, 'next-actions.json'), 'utf8')) as NextActions
const ix = buildIndex(graph)

describe('オントロジー画面のロジック', () => {
  it('グラフの全ての種類に、色・形・記号・言葉の定義がある（色だけに頼らない）', () => {
    for (const t of new Set(graph.nodes.map((n) => n.type))) {
      const s = TYPE_STYLE[t]
      expect(s, `未定義の種類 ${t}`).toBeTruthy()
      expect(s.symbol.length).toBeGreaterThan(0)
      expect(s.label.length).toBeGreaterThan(0)
      expect(CAT[s.cat]).toBeTruthy()
    }
  })

  it('既定の絞り込みは、全ノードより十分少なく、コンペ・アプリ・止めているものを含む', () => {
    const v = defaultView()
    const ids = visibleIds(graph, ix, v, na, null)
    expect(ids.size).toBeLessThan(graph.nodes.length / 4)
    const types = new Set([...ids].map((i) => ix.byId.get(i)!.type))
    for (const t of ['Contest', 'Submission', 'Finding']) expect(types.has(t)).toBe(true)
    // 指摘は既定で失格級だけ
    for (const i of ids) {
      const n = ix.byId.get(i)!
      if (n.type === 'Finding') expect(DEFAULT_SEVERITIES).toContain(n.status)
    }
    expect(DEFAULT_TYPES).not.toContain('Task')
    expect(DEFAULT_TYPES).not.toContain('App') // アプリは応募のノードの中に名前で出す
  })

  it('近傍の展開は、そのノードの相手を足す。近傍だけ表示は選んだノードと相手だけ', () => {
    const app = graph.nodes.find((n) => n.type === 'App')!
    const base = visibleIds(graph, ix, defaultView(), na, null)
    const v = { ...defaultView(), expanded: [app.id] }
    const more = visibleIds(graph, ix, v, na, null)
    for (const m of neighbors(ix, app.id)) expect(more.has(m)).toBe(true)
    expect(more.size).toBeGreaterThanOrEqual(base.size)
    const f = visibleIds(graph, ix, { ...defaultView(), focus: app.id }, na, null)
    expect([...f].sort()).toEqual([app.id, ...neighbors(ix, app.id)].sort())
  })

  it('図の線は、出ているノードどうしだけで、fit・多い線は既定で引かない', () => {
    const ids = visibleIds(graph, ix, defaultView(), na, null)
    const edges = visibleEdges(graph, ids, defaultView())
    for (const e of edges) {
      expect(ids.has(e.source) && ids.has(e.target)).toBe(true)
      expect(['fit', 'fitsContest', 'competesWith']).not.toContain(e.rel)
    }
    const idsApp = visibleIds(graph, ix, { ...defaultView(), types: [...DEFAULT_TYPES, 'App'] }, na, null)
    const withFit = visibleEdges(graph, idsApp, { ...defaultView(), rels: ['fitsContest'] })
    expect(withFit.some((e) => e.rel === 'fitsContest')).toBe(true)
  })

  it('配置: ノードが重ならない', () => {
    const ids = visibleIds(graph, ix, { ...defaultView(), types: Object.keys(TYPE_STYLE), severities: ['失格級', '要修正', '軽微'] }, na, null)
    const nodes = graph.nodes.filter((n) => ids.has(n.id))
    const pos = layout(nodes, visibleEdges(graph, ids, defaultView()))
    expect(pos.size).toBe(nodes.length)
    const list = [...pos.values()]
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j]
        const overlap = Math.abs(a.x - b.x) < NODE_W && Math.abs(a.y - b.y) < NODE_H
        expect(overlap).toBe(false)
      }
    }
  })

  it('次の行動の応募・判断・データの影響は、すべてグラフのノードに結べる', () => {
    for (const s of na.submissions) for (const id of [s.submission, s.app, s.contest]) expect(ix.byId.has(id), id).toBe(true)
    for (const d of na.commanderDecisions) expect(ix.byId.has(d.decision), d.decision).toBe(true)
    for (const [k, v] of Object.entries(na.dataImpactAll)) {
      expect(ix.byId.has(k)).toBe(true)
      for (const a of Object.keys(v.apps)) expect(ix.byId.has(a)).toBe(true)
    }
  })

  it('止めているものは、応募の近傍のノードに結べる（失格級のものは全件）', () => {
    let hard = 0, linked = 0
    for (const s of na.submissions) {
      for (const b of s.blockers.filter((x) => x.severity === '失格級')) {
        hard++
        if (blockerNodeId(ix, s.submission, b.label)) linked++
      }
    }
    expect(hard).toBeGreaterThan(0)
    expect(linked).toBe(hard)
  })

  it('もしこのデータが使えなければ: 使うアプリと、その応募・コンペが影響を受ける', () => {
    const [ds, v] = Object.entries(na.dataImpactAll).find(([, x]) => x.submissions.length > 0)!
    const set = impactSet(na, ds)
    for (const a of Object.keys(v.apps)) expect(set.has(a)).toBe(true)
    for (const s of v.submissions) expect(set.has(s.submission) && set.has(s.contest)).toBe(true)
    // グラフ側の「使うデータ」の線と一致する
    const users = graph.edges.filter((e) => e.rel === 'usesDataset' && e.target === ds).map((e) => e.source).sort()
    expect(Object.keys(v.apps).sort()).toEqual(users)
    // 影響先のノードは、その選択で必ず図に出る
    const shown = visibleIds(graph, ix, { ...defaultView(), impactOf: ds }, na, null)
    for (const id of set) expect(shown.has(id)).toBe(true)
    expect(impactSet(na, null).size).toBe(0)
  })

  it('アプリのノードは registry のアプリと対応する（カードからアプリのページへ行ける）', () => {
    const ids = new Set(APPS.map((a) => a.id))
    const apps = graph.nodes.filter((n) => n.type === 'App').map((n) => appIdOf(n.id)!)
    const linked = apps.filter((a) => ids.has(a))
    expect(linked.length).toBeGreaterThanOrEqual(apps.length - 2) // registry に無いのは提出文だけの案（IN1）と、追加済みで未登録の A4
  })

  it('レーン: 応募ごとに、止めているものは上位2件＋「ほか n件」。重さの順', () => {
    const all = buildLanes(ix, na, defaultView(), 'all')
    expect(all.reduce((n, g) => n + g.lanes.length, 0)).toBe(na.submissions.length)
    for (const g of all) {
      for (const l of g.lanes) {
        expect(l.blockers.length).toBeLessThanOrEqual(2)
        expect(l.blockers.length + l.more).toBe(l.total)
        for (const b of l.blockers) if (b.type === 'Finding') expect(DEFAULT_SEVERITIES).toContain(b.status)
      }
    }
    const one = buildLanes(ix, na, defaultView(), na.submissions[0].contest)
    expect(one).toHaveLength(1)
    expect(contestOfSubmission(ix, na.submissions[0].submission)).toBe(na.submissions[0].contest)
    expect(shortName('F-3 【確定】とても長い名前'.repeat(5), 20).length).toBeLessThanOrEqual(20)
  })

  it('開いている PR の代理マージは、総司令官の判断待ちに入らない', () => {
    expect(na.commanderDecisions.some((d) => /代理マージ/.test(d.label))).toBe(false)
  })

  it('検索は名前・種類・状態に当たる', () => {
    expect(searchNodes(graph, '失格級').length).toBeGreaterThan(0)
    expect(searchNodes(graph, '').length).toBe(0)
  })

  it('日付の短い表記', () => {
    expect(fmtDue('2026-11-30T12:00:00+09:00')).toBe('11/30 12:00')
    expect(fmtDue(null)).toBe('締切の記録なし')
  })
})
