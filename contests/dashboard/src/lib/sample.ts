/**
 * 実行サンプル（初見ユーザー試験で被験者が操作した結果の再現）。
 * URL の ?sample=1 で有効。通常の使い方は ?sample なしの URL（従来どおり）。
 * サンプル中は localStorage へ書き込まない（通常利用の記録と混ざらない・再読み込みで初期状態に戻る）。
 */
export function isSampleMode(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('sample') === '1'
}

/** 被験者の操作記録。src/apps/<id>/sample.ts で定義し、apps/_samples/index.ts に登録する */
export interface SampleRun {
  /** 例: '第6回（2026-11-11）' */
  round: string
  /** 例: 'Sonnet' */
  tester: string
  /** 被験者に伝えた使用目的（そのまま） */
  purpose: string
  /** 被験者が得た結論（報告の要約） */
  conclusion: string
  /** 手順 id ごとの「被験者がこの手順でしたこと・見た値」。StepLayout の本文の先頭に出る */
  notes: Record<string, string>
  /** 操作の経過（手順数・スクロール回数など。短文の配列） */
  process: string[]
  /** 被験者が迷った点・要望（短文の配列。最大5件程度） */
  feedback: string[]
}
