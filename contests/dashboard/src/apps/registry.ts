// 7アプリのメタデータ。工兵は編集しない（シェル担当のみ）。
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

export type DataKind = 'real' | 'fictional' | 'partial'
export type ContestId = 'odpt-2026' | 'udc-2026' | 'satellite-2026' | 'ichibiz-2026'

export interface ContestMeta {
  id: ContestId
  name: string
  short: string
}

export interface AppMeta {
  id: string
  name: string
  contest: ContestId
  /** 部門・提案名など */
  division: string
  /** 締切の表示用文字列（contests/registry.json の値に基づく） */
  deadline: string
  /** 締切の ISO 日時 */
  deadlineAt: string
  /** 使用目的の一文（概要ページのカードとページ見出しに表示） */
  purpose: string
  dataKind: DataKind
  /** データ種別の補足（バッジのツールチップ・ページ見出し用） */
  dataNote: string
  /** 元の静的アプリ（リポジトリ内の相対パス。プレースホルダ表示用） */
  originalPath: string
  Component: LazyExoticComponent<ComponentType>
}

export const CONTESTS: ContestMeta[] = [
  { id: 'odpt-2026', name: '公共交通オープンデータチャレンジ2026', short: 'ODPT' },
  { id: 'udc-2026', name: 'アーバンデータチャレンジ2026', short: 'UDC' },
  { id: 'satellite-2026', name: '衛星データ活用アワード2026–2027', short: '衛星アワード' },
  { id: 'ichibiz-2026', name: 'イチBizアワード2026', short: 'イチBiz' },
]

export const APPS: AppMeta[] = [
  {
    id: 'odpt',
    name: '生活アクセス診断マップ',
    contest: 'odpt-2026',
    division: '本応募（UDC 作品①としても提出）',
    deadline: '2027/1/11 23:59',
    deadlineAt: '2027-01-11T23:59:00+09:00',
    purpose:
      '車を運転しない家族が、平日の朝に公共交通か徒歩で30分以内に病院へ行けるかを確かめ、結果を離れた家族に共有する。',
    dataKind: 'real',
    dataNote: '公共交通オープンデータ（GTFS）・国土数値情報などの実データ',
    originalPath: 'contests/odpt-2026/app/web/',
    Component: lazy(() => import('./odpt/index')),
  },
  {
    id: 'udc-moritsuchi',
    name: 'みんなの盛土ウォッチ',
    contest: 'udc-2026',
    division: '作品②',
    deadline: '2026/12/27 23:59（概要登録は 11/15 23:59）',
    deadlineAt: '2026-12-27T23:59:00+09:00',
    purpose:
      '住民が自宅の周りの大規模な盛土造成地を知り、気づいた変化を記録して、市に伝える準備をする。',
    dataKind: 'real',
    dataNote: '大規模盛土造成地（熱海市）は公開データ。記録は利用者が入力した内容をこの端末にだけ保存',
    originalPath: 'contests/udc-2026/app/moritsuchi-watch/',
    Component: lazy(() => import('./udc-moritsuchi/index')),
  },
  {
    id: 'sat-a',
    name: '路面下リスクの二段階調査',
    contest: 'satellite-2026',
    division: '提案A',
    deadline: '2026/11/30 12:00',
    deadlineAt: '2026-11-30T12:00:00+09:00',
    purpose:
      '道路管理者が、路面下の空洞調査の候補区間を衛星の指標などで絞り込み、地中レーダ調査の対象を予算内で選び、結果を次の絞り込みに活かす流れを確かめる。',
    dataKind: 'fictional',
    dataNote: '道路・指標・調査結果はすべて架空のサンプル',
    originalPath: 'contests/satellite-2026/app/proposal-a/',
    Component: lazy(() => import('./sat-a/index')),
  },
  {
    id: 'sat-b',
    name: '盛土巡視台帳',
    contest: 'satellite-2026',
    division: '提案B',
    deadline: '2026/11/30 12:00',
    deadlineAt: '2026-11-30T12:00:00+09:00',
    purpose:
      '盛土規制の担当職員が、大規模盛土造成地の台帳から今月巡視する場所を決めて計画を書き出し、巡視結果を記録する。',
    dataKind: 'partial',
    dataNote: '横須賀市の造成地データは実データ、衛星由来の変化量は未接続（架空サンプル）',
    originalPath: 'contests/satellite-2026/app/proposal-b/',
    Component: lazy(() => import('./sat-b/index')),
  },
  {
    id: 'biz-business',
    name: 'バス路線見直し案の比較',
    contest: 'ichibiz-2026',
    division: 'ビジネス部門',
    deadline: '2026/11/30 20:00',
    deadlineAt: '2026-11-30T20:00:00+09:00',
    purpose:
      '交通担当者が、路線を廃止する見直し案を2つ作り、病院へ行けなくなる人が少ない案を比べて会議資料にまとめる。',
    dataKind: 'real',
    dataNote: '公共交通オープンデータ・人口メッシュなどの実データ',
    originalPath: 'contests/ichibiz-2026/app/business/web/',
    Component: lazy(() => import('./biz-business/index')),
  },
  {
    id: 'biz-idea',
    name: '地名の記憶マップ',
    contest: 'ichibiz-2026',
    division: 'アイデア部門',
    deadline: '2026/12/10 20:00',
    deadlineAt: '2026-12-10T20:00:00+09:00',
    purpose:
      '地域の聞き取り担当者が、地名にまつわる災害の言い伝えを公開データで確かめ、聞き取った話を記録して地図に残す。',
    dataKind: 'partial',
    dataNote: '自然災害伝承碑は実データ、地名と語りはサンプル（架空）',
    originalPath: 'contests/ichibiz-2026/app/idea/',
    Component: lazy(() => import('./biz-idea/index')),
  },
  {
    id: 'biz-realestate',
    name: '相談前の1枚シート',
    contest: 'ichibiz-2026',
    division: '不動産情報活用部門',
    deadline: '2026/12/10 20:00',
    deadlineAt: '2026-12-10T20:00:00+09:00',
    purpose:
      '相続した土地の所有者が、売る・貸す・活かす・手放すのどれにするか専門家に相談する前に、土地の条件と聞くべきことを1枚にまとめる。',
    dataKind: 'partial',
    dataNote: '徳島市の用途地域・災害想定区域などは実データ。「サンプルの土地」は架空',
    originalPath: 'contests/ichibiz-2026/app/realestate/web/',
    Component: lazy(() => import('./biz-realestate/index')),
  },
]

export const DATA_KIND_LABEL: Record<DataKind, string> = {
  real: '実データ',
  fictional: '架空データ',
  partial: '一部架空',
}

export function getApp(id: string): AppMeta | undefined {
  return APPS.find((a) => a.id === id)
}

export function appsByContest(contest: ContestId): AppMeta[] {
  return APPS.filter((a) => a.contest === contest)
}
