import { pct, type Group, type Loss, type RegionData } from './lib'
import { SOURCE_LINES, limitLines } from './text'

export interface PlanView {
  name: string
  routes: string[] // 路線の表示名
  per: (Loss & { groups: Group[] })[] // 施設ごと
}
export interface Base {
  pop: number
  pop65: number
}

/** 元アプリの CSV と同じ構成（比較表・地区別内訳・前提・出典） */
export function buildCsvRows(d: RegionData, cond: string, base: Base[], plans: PlanView[]): unknown[][] {
  const rows: unknown[][] = []
  rows.push(['見直し案の比較（デモ出力）'])
  rows.push(['地域', d.name])
  rows.push(['診断の条件', cond])
  rows.push(['診断の基準日（平日/休日）', `${d.feeds[0].ref.wd} / ${d.feeds[0].ref.hol}（水曜・日曜。祝日・臨時ダイヤは未反映）`])
  rows.push(['データ生成日', d.built])
  rows.push(['診断範囲の人口', base[0].pop, 'うち65歳以上', base[0].pop65])
  rows.push([])
  rows.push(['【比較表】'])
  rows.push(['案', '止める路線', '行き先', '行けなくなる人', 'うち65歳以上', '診断範囲の人口に占める割合(%)', '影響を受ける地区数', '集計の種類'])
  for (const p of plans) {
    d.facility_order.forEach((fk, fi) => {
      const l = p.per[fi]
      rows.push([
        p.name, p.routes.join(' / '), d.facility_labels[fk], l.lost, l.lost65, pct(l.lost, base[fi].pop), l.groups.length,
        l.exact ? '単独路線の停止（事前計算どおり）' : '複数路線の案: 少なくともこの人数（下限。同時停止でのみ生じる影響は含まない）',
      ])
    })
  }
  rows.push([])
  rows.push(['【地区別の内訳】（地区＝最寄り停留所の名前でまとめた500mメッシュ。行政区画ではない）'])
  rows.push(['案', '行き先', '地区（最寄り停留所）', '行けなくなる人', 'うち65歳以上', 'メッシュ数', '停留所まで最大(m)'])
  for (const p of plans) {
    d.facility_order.forEach((fk, fi) => {
      for (const g of p.per[fi].groups) rows.push([p.name, d.facility_labels[fk], g.name, g.lost, g.lost65, g.meshes, g.maxDist])
    })
  }
  rows.push([])
  rows.push(['【前提と限界】'])
  for (const t of limitLines(d.params)) rows.push([t])
  rows.push([])
  rows.push(['【出典】'])
  rows.push(['GTFS（事業者名 / データ名 / ライセンス / 更新日 / 取得元）'])
  for (const f of d.feeds) rows.push([f.org, f.name.trim(), f.license + (f.credit ? `（${f.credit}）` : ''), f.updated, f.url])
  for (const t of SOURCE_LINES) rows.push([t])
  return rows
}
