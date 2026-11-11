// AI（Sonnet）による模擬評価の結果。実際の審査結果ではない。
// 出典（点数・文言はここからだけ転記。新しい数値は作らない）:
//   採点基準 reports/ops/dashboard-rubric-20261111.md
//   評価報告 reports/ops/dashboard-eval-20261111/{odpt-udc,satellite,ichibiz-business-idea,ichibiz-realestate-mobile}.md
// 評価日 2026-11-11、評価者は Sonnet 4名。各アプリの B・C は1名が採点（複数人の突き合わせはしていない）。
import type { ContestId } from './registry'

export const EVAL_DATE = '2026-11-11'
export const RUBRIC_PATH = 'reports/ops/dashboard-rubric-20261111.md'
const DIR = 'reports/ops/dashboard-eval-20261111/'

export interface Evaluator {
  n: 1 | 2 | 3 | 4
  /** 担当範囲 */
  scope: string
  report: string
  /** A1〜A5 の点（各5点） */
  a: [number, number, number, number, number]
  /** 報告書の A 小計 */
  aReported: number
  /** この評価者の A に関する但し書き */
  aNote?: string
  /** この評価者が確認できなかった範囲（報告書の記載） */
  unverified: string[]
}

export const A_ITEMS = ['A1 コンペの理解', 'A2 審査基準の明確さ', 'A3 締切・提出物・注意点', 'A4 アプリへの導線', 'A5 情報設計・視覚階層']
export const B_ITEMS = ['B1 目的の伝わりやすさ', 'B2 操作の導線', 'B3 視覚階層・一貫性', 'B4 フィードバック', 'B5 無駄の少なさ', 'B6 アクセシビリティ', 'B7 データの誠実さ']
export const A_MAX = 25
export const B_MAX = 35

export const EVALUATORS: Evaluator[] = [
  {
    n: 1,
    scope: 'ODPT・UDC（診断マップ／盛土ウォッチ）',
    report: DIR + 'odpt-udc.md',
    a: [4, 4, 4, 4, 3],
    aReported: 19,
    aNote: 'ポータルは UDC・ODPT のタブのみ精読。A1〜A3 はこの2コンペの範囲での採点。',
    unverified: [
      'スマホ幅は headless の静止画（ポータル・診断マップ・盛土ウォッチの各1枚目）のみで、操作は未確認',
      '衛星・イチBizのタブは担当外で未確認',
    ],
  },
  {
    n: 2,
    scope: '衛星アワード（提案A／提案B）',
    report: DIR + 'satellite.md',
    a: [4, 4, 4, 3, 4],
    aReported: 19,
    unverified: [
      'キーボード操作（Tab/Enter）は未検証（B6 は保守的な点）',
      '盛土巡視台帳の「計画をCSVで書き出す」は実行せず、プレビューのみ確認',
      'スマホ幅は headless のみ（地図の描画は断定できない）。実機の確認が必要',
    ],
  },
  {
    n: 3,
    scope: 'イチBiz（バス路線見直し案／地名の記憶マップ）',
    report: DIR + 'ichibiz-business-idea.md',
    a: [4, 4, 4, 3, 3],
    aReported: 18,
    unverified: [
      'CSV／GeoJSON の書き出し（ダウンロード）は未実行',
      '「実行サンプル」は開いていない',
      'キーボードのみでの全手順通しは未実施。スマホ幅は headless の静止画のみ（地名の記憶マップの地図は読み込み中のまま）',
    ],
  },
  {
    n: 4,
    scope: 'イチBiz（相談前の1枚シート）・スマホ幅のポータル',
    report: DIR + 'ichibiz-realestate-mobile.md',
    a: [4, 4, 4, 3, 3],
    aReported: 18,
    unverified: [
      'スマホ幅は幅390pxの iframe での確認。実機のタッチ・アドレスバーは未検証',
      '印刷ボタンは押していない（存在と説明のみ確認）',
      'アプリ側のキーボード（Tab/Enter）操作は未検証',
    ],
  },
]

export interface CSet {
  contest: ContestId
  /** 表示名（例: ODPT／UDC 作品①） */
  label: string
  items: { name: string; score: number }[]
  /** 報告書の C 小計 */
  reported: number
  /** 報告書にある補足評価（差別化・ライブラリ活用など） */
  note?: string
}

export interface AppEval {
  appId: string
  evaluator: 1 | 2 | 3 | 4
  report: string
  b: [number, number, number, number, number, number, number]
  bReported: number
  c: CSet[]
  /** 優先度「高」の改善提案（報告書の要約） */
  high: string[]
  /** 評価者が見つけた不具合・迷った箇所（報告書の要約） */
  bugs: string[]
}

export const APP_EVALS: AppEval[] = [
  {
    appId: 'odpt',
    evaluator: 1,
    report: DIR + 'odpt-udc.md',
    b: [4, 4, 4, 4, 3, 3, 4],
    bReported: 26,
    c: [
      {
        contest: 'odpt-2026',
        label: 'ODPT',
        items: [
          { name: 'C-ODPT1 社会課題解決', score: 4 },
          { name: 'C-ODPT2 オープンデータ活用', score: 4 },
          { name: 'C-ODPT3 技術的完成度', score: 4 },
          { name: 'C-ODPT4 UI/UX', score: 4 },
        ],
        reported: 16,
      },
      {
        contest: 'udc-2026',
        label: 'UDC 作品①',
        items: [
          { name: 'C-UDC1 実用度', score: 4 },
          { name: 'C-UDC2 完成度', score: 4 },
          { name: 'C-UDC3 挑戦度', score: 3 },
        ],
        reported: 11,
        note: '差別化: 作品①と②は課題・データ・利用者が別で「同一・類似作品」には見えない。ただし画面の骨格は同一のため、主題とデータが別であることを説明に明記すると安全（報告書）。',
      },
    ],
    high: [
      '手順1の初期画面で凡例（橙＝行けない／青＝行ける 等）を最初から開くか、地図の上に1行の読み方を置く（B1・B6・C-ODPT4）。',
      '駅名検索で曖昧な名前（「富山駅」が南富山駅になる）は自動選択せず、候補を先に出す。誤った駅で結論が出る恐れ（B2・C-ODPT3）。',
      '「行けません」と出た場合の次の一歩（近い停留所・最終便・別時間帯・窓口の例など）を1行でも添える（C-ODPT1）。',
      'UDC の挑戦度（持続性・関係者）を画面で示す。診断マップは「データ更新・自治体との関係」を手順5かアプリ説明に1〜2行（C-UDC3）。',
    ],
    bugs: [
      '手順1の例ボタン「富山駅」を押すと、最初に「南富山駅（富山市周辺）」が選ばれる（候補5件の4番目に富山駅）。',
      '「富山駅」を選んだ後の手順2〜5で、地図の左下付近に白い四角（地図タイルの境界）が出る。',
      '手順3は休日との比較を見ただけで済（✓）になり、操作しなくても進捗が進む。',
      '手順5を完了した後に別の手順から戻ると、コピーのボタン表示が元の文言に戻る（進捗バーは完了のまま）。',
    ],
  },
  {
    appId: 'udc-moritsuchi',
    evaluator: 1,
    report: DIR + 'odpt-udc.md',
    b: [4, 5, 4, 5, 3, 3, 5],
    bReported: 29,
    c: [
      {
        contest: 'udc-2026',
        label: 'UDC 作品②',
        items: [
          { name: 'C-UDC1 実用度', score: 4 },
          { name: 'C-UDC2 完成度', score: 4 },
          { name: 'C-UDC3 挑戦度', score: 3 },
        ],
        reported: 11,
        note: '差別化: 作品①と②は「同一・類似作品」には見えない（上記①の補足と同じ）。',
      },
    ],
    high: [
      'UDC の挑戦度（持続性・関係者）を画面で示す。「誰が記録を集め、市のどの窓口が受けるか」を手順5かアプリ説明に1〜2行。現状は「連絡先はこのページには載せていません」で止まる（C-UDC3）。',
    ],
    bugs: [
      '手順1で「咲見町」を入力して Enter を押しても確定せず、候補一覧が出るだけ。候補をクリックして初めて進む。',
      '手順4で保存すると地図の中心が動き、直前に見ていた造成地の位置関係が変わる。',
    ],
  },
  {
    appId: 'sat-a',
    evaluator: 2,
    report: DIR + 'satellite.md',
    b: [5, 4, 4, 4, 3, 3, 5],
    bReported: 28,
    c: [
      {
        contest: 'satellite-2026',
        label: '衛星アワード 提案A',
        items: [
          { name: 'C-SAT1 テーマ合致', score: 5 },
          { name: 'C-SAT2 衛星データの妥当性', score: 3 },
          { name: 'C-SAT3 実現性・収益性', score: 2 },
          { name: 'C-SAT4 社会発展性', score: 3 },
          { name: 'C-SAT5 開発の進捗（加点）', score: 4 },
        ],
        reported: 17,
      },
    ],
    high: [
      '（両アプリ共通）収益・顧客の説明がない。「誰が・何に対して・どう課金するか」「既存手段との差」を1画面（仮置きと明記）で見せる（C-SAT3 の底上げ）。',
    ],
    bugs: [
      '手順1は、何も操作していないのに開いた直後に「完了」扱い（必須5のうち1完了）。',
      '手順4で「較正を反映して第2回へ進む」を押すと「第2回に反映済みです」とだけ出て、次へ進むボタンがない（サイドバーで手順5を自分で探す）。',
      '持ち帰れる成果物（CSV・保存・印刷）がなく、手順の最後が行き止まり（改善提案の優先度は「中」）。',
    ],
  },
  {
    appId: 'sat-b',
    evaluator: 2,
    report: DIR + 'satellite.md',
    b: [5, 4, 4, 5, 3, 3, 5],
    bReported: 29,
    c: [
      {
        contest: 'satellite-2026',
        label: '衛星アワード 提案B',
        items: [
          { name: 'C-SAT1 テーマ合致', score: 4 },
          { name: 'C-SAT2 衛星データの妥当性', score: 2 },
          { name: 'C-SAT3 実現性・収益性', score: 2 },
          { name: 'C-SAT4 社会発展性', score: 3 },
          { name: 'C-SAT5 開発の進捗（加点）', score: 4 },
        ],
        reported: 15,
      },
    ],
    high: [
      '衛星の役割が弱い。「衛星由来の変化量: 未接続」を出すだけでなく、「衛星が入ると点数がどう変わるか」を架空値で比べる小さな対比を1手順入れる（C-SAT2 の失点を直接減らす）。',
      '（両アプリ共通）収益・顧客の説明がない。「誰が・何に対して・どう課金するか」「既存手段との差」を1画面（仮置きと明記）で見せる（C-SAT3）。',
    ],
    bugs: [
      '手順2は、台帳を開いただけで完了扱い。',
      '手順4を済ませなくても手順5・6へ進める（左下に「まだ済んでいない手順」の案内は出る）。',
    ],
  },
  {
    appId: 'biz-business',
    evaluator: 3,
    report: DIR + 'ichibiz-business-idea.md',
    b: [5, 4, 4, 4, 3, 4, 5],
    bReported: 29,
    c: [
      {
        contest: 'ichibiz-2026',
        label: 'イチBiz バス路線（ビジネス部門）',
        items: [
          { name: 'C-BIZ1 独創性', score: 3 },
          { name: 'C-BIZ2 社会的インパクト', score: 4 },
          { name: 'C-BIZ3 実現可能性', score: 4 },
          { name: 'C-BIZ4 持続性', score: 2 },
        ],
        reported: 13,
        note: '差別化・事業性は画面から読み取れない。ビジネス部門の審査では持続性と事業モデルの補強が必要（報告書）。',
      },
    ],
    high: [
      '手順5「文章だけをコピー」のコピー文が案Aのみで、案Bと結論を含まない。通知の「案A・案Bの1段落、183文字」と一致させ、結論1文を加える。',
      '手順2・3は初期値で結果が地図に出ているのに「未完了」のままで、手順4がブロックされる。「この案で進む」ボタンを置くか、既定案を完了と扱う。',
      'C-BIZ4（持続性）の根拠が画面にない。「誰が・何を継続的に更新し、費用を誰が負担するか」の一文を置く。',
    ],
    bugs: [
      '手順1から直接「どちらの影響が小さいか確かめる」へ進むと「案Aと案Bの両方に路線を選び…」と出て先へ進めない（路線を1本追加すると進める）。',
      '手順5で「文章だけをコピー」を押すと「案A・案Bの1段落、183文字」と出るが、プレビューの資料用の文章は案Aの内容しかない。',
    ],
  },
  {
    appId: 'biz-idea',
    evaluator: 3,
    report: DIR + 'ichibiz-business-idea.md',
    b: [4, 4, 4, 5, 3, 4, 5],
    bReported: 29,
    c: [
      {
        contest: 'ichibiz-2026',
        label: 'イチBiz 地名の記憶マップ（アイデア部門）',
        items: [
          { name: 'C-BIZ1 独創性', score: 5 },
          { name: 'C-BIZ2 社会的インパクト', score: 3 },
          { name: 'C-BIZ3 実現可能性', score: 4 },
          { name: 'C-BIZ4 持続性', score: 2 },
        ],
        reported: 14,
      },
    ],
    high: [],
    bugs: [
      '手順4で記録を保存して再読込すると進捗が「6のうち2完了」になる（手順1〜3が未完了に戻り、手順4・5が完了のまま）。記録は残る。',
      '手順4で「サンプルの語りを入力欄に写す」を押してから保存すると入力欄が空に戻って見え、何が保存されたか不安になる（優先度は「低」）。',
    ],
  },
  {
    appId: 'biz-realestate',
    evaluator: 4,
    report: DIR + 'ichibiz-realestate-mobile.md',
    b: [3, 3, 4, 4, 3, 3, 5],
    bReported: 25,
    c: [
      {
        contest: 'ichibiz-2026',
        label: 'イチBiz 相談前の1枚シート（不動産情報活用部門）',
        items: [
          { name: 'C-BIZ1 独創性', score: 4 },
          { name: 'C-BIZ2 社会的インパクト', score: 3 },
          { name: 'C-BIZ3 実現可能性', score: 4 },
          { name: 'C-BIZ4 持続性', score: 2 },
        ],
        reported: 13,
        note: '不動産情報ライブラリの活用が画面で分かるか: 分からない（評価は低）。アプリ内に「不動産情報ライブラリ」の語がなく、審査員は活用なしと受け取るおそれが高い（報告書）。',
      },
    ],
    high: [
      '不動産情報ライブラリの活用を画面で明示する。出典・ライセンスと手順3に「不動産情報ライブラリ（国土交通省）」を載せ、どの項目がそこ由来かを示す。取り込めないなら、使った情報を書く欄を用意する。',
      'アプリ内に「次へ」ボタンを置く。現在は折りたたみバーを開かないと次の手順へ進めない。',
    ],
    bugs: [
      '手順1の後に「次へ」がなく、「手順 1／5」バーを開いて手順2を選ぶ必要がある。',
      '「この位置を…使う」の後、「公開データを集めています…」が数秒続き、終わっても進捗数字の変化以外の通知がない。',
      '手順5を開いても進捗が「4/5」のまま。',
      '実行サンプルの文言「右側にシートのプレビュー」が、スマホ幅ではシートが上に出るため食い違う。',
    ],
  },
]

export interface PortalFinding {
  priority: '高' | '中' | '低'
  text: string
  /** 指摘した評価者 */
  by: number[]
}

/** ポータルへの指摘（報告書の改善提案・不具合・食い違いから） */
export const PORTAL_FINDINGS: PortalFinding[] = [
  { priority: '高', by: [1, 4], text: 'コンペタブ内のアプリへの「開く」が1画面目の外にある（デスクトップで y≒750、スマホでは約1500pxのスクロール）。概要カードの直下か見出し横に置く。' },
  { priority: '高', by: [3], text: 'アプリから「← 統合ダッシュボード」で戻ると毎回UDCタブが選ばれ、元のコンペに戻れない（評価者2も優先度「中」で同じ指摘。評価者1は同じタブに戻れたと記録しており、評価者間で食い違う）。' },
  { priority: '高', by: [2], text: '衛星タブの国籍要件が、注意点では確定的（「必要」）、未確認では未確定（「本アワードにも適用されるか」）と食い違う。失格に関わる項目のため表現をそろえる。' },
  { priority: '中', by: [1], text: 'コンペ別3カードの高さが不揃い（左2カードの下が空白）。「確定／未確認」の凡例を一度だけ置き、「未確認」を審査基準カードの近くに置く。' },
  { priority: '中', by: [3], text: 'イチBizタブの審査員が重視しうる点に、項目ごとの1行説明がない。上部タブにアイデア・不動産部門の締切（12/10）が出ない。' },
  { priority: '低', by: [2], text: 'アプリカードの説明が「…」で途切れる。' },
]

/** 評価全体の限界（評価で確認できなかった範囲） */
export const COMMON_UNVERIFIED = [
  'キーボード（Tab/Enter）操作は、確認できたアプリと未検証のアプリがある（衛星の2アプリは未検証、イチBizは一部のみ）',
  'スマホ幅は headless Chrome や iframe による確認が中心で、実機は未確認',
  '書き出し（CSV・GeoJSON のダウンロード）と印刷は、実行していないアプリがある',
  '各アプリの B・C は1名の評価者による採点で、複数人の突き合わせはしていない',
]

export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)
export const pct = (score: number, max: number) => Math.round((score / max) * 100)

export function evalOf(appId: string): AppEval | undefined {
  return APP_EVALS.find((e) => e.appId === appId)
}
export function cSetOf(appId: string, contest: ContestId): CSet | undefined {
  return evalOf(appId)?.c.find((c) => c.contest === contest)
}
export const cMax = (c: CSet) => c.items.length * 5
