// AI（Sonnet）による模擬評価の結果。実際の審査結果ではない。
// 出典（点数・文言はここからだけ転記。新しい数値は作らない）:
//   採点基準 reports/ops/dashboard-rubric-20261111.md
//   第1回（2026-11-11・改修前）reports/ops/dashboard-eval-20261111/{odpt-udc,satellite,ichibiz-business-idea,ichibiz-realestate-mobile}.md
//   第2回（2026-11-12・第1回の改修後）reports/ops/dashboard-eval-20261112/ 以下の同名4件
// 評価者は各回 Sonnet 4名。各アプリの B・C は1名が採点（複数人の突き合わせはしていない）。第2回の後にさらに改修が入る予定。
import type { ContestId } from './registry'

export const EVAL_DATE_R1 = '2026-11-11'
export const EVAL_DATE_R2 = '2026-11-12'
export const RUBRIC_PATH = 'reports/ops/dashboard-rubric-20261111.md'
const DIR = 'reports/ops/dashboard-eval-20261111/'
const DIR2 = 'reports/ops/dashboard-eval-20261112/'

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

export const EVALUATORS_R1: Evaluator[] = [
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

export const APP_EVALS_R1: AppEval[] = [
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
  /** 優先度。報告書の「ポータルの記載とアプリの食い違い」欄の指摘は優先度が付かないため '食い違い' */
  priority: '高' | '中' | '低' | '食い違い'
  text: string
  /** 指摘した評価者 */
  by: number[]
}

/** ポータルへの指摘（報告書の改善提案・不具合・食い違いから） */
export const PORTAL_FINDINGS_R1: PortalFinding[] = [
  { priority: '高', by: [1, 4], text: 'コンペタブ内のアプリへの「開く」が1画面目の外にある（デスクトップで y≒750、スマホでは約1500pxのスクロール）。概要カードの直下か見出し横に置く。' },
  { priority: '高', by: [3], text: 'アプリから「← 統合ダッシュボード」で戻ると毎回UDCタブが選ばれ、元のコンペに戻れない（評価者2も優先度「中」で同じ指摘。評価者1は同じタブに戻れたと記録しており、評価者間で食い違う）。' },
  { priority: '高', by: [2], text: '衛星タブの国籍要件が、注意点では確定的（「必要」）、未確認では未確定（「本アワードにも適用されるか」）と食い違う。失格に関わる項目のため表現をそろえる。' },
  { priority: '中', by: [1], text: 'コンペ別3カードの高さが不揃い（左2カードの下が空白）。「確定／未確認」の凡例を一度だけ置き、「未確認」を審査基準カードの近くに置く。' },
  { priority: '中', by: [3], text: 'イチBizタブの審査員が重視しうる点に、項目ごとの1行説明がない。上部タブにアイデア・不動産部門の締切（12/10）が出ない。' },
  { priority: '低', by: [2], text: 'アプリカードの説明が「…」で途切れる。' },
]

/** 評価全体の限界（評価で確認できなかった範囲） */
export const COMMON_UNVERIFIED_R1 = [
  'キーボード（Tab/Enter）操作は、確認できたアプリと未検証のアプリがある（衛星の2アプリは未検証、イチBizは一部のみ）',
  'スマホ幅は headless Chrome や iframe による確認が中心で、実機は未確認',
  '書き出し（CSV・GeoJSON のダウンロード）と印刷は、実行していないアプリがある',
  '各アプリの B・C は1名の評価者による採点で、複数人の突き合わせはしていない',
]

// ---------------------------------------------------------------------------
// 第2回（2026-11-12）。第1回の改修後の画面に対する評価。出典は DIR2 の各報告書。
// ---------------------------------------------------------------------------

export const EVALUATORS_R2: Evaluator[] = [
  {
    n: 1,
    scope: 'ODPT・UDC（診断マップ／盛土ウォッチ）',
    report: DIR2 + 'odpt-udc.md',
    a: [4, 4, 4, 4, 3],
    aReported: 19,
    unverified: [
      'スマホ幅は headless の静止画（初期画面のみ・操作なし）で、診断マップは地図の格子が静止画に出ていなかった（読み込み待ちの可能性）。実機での確認が必要',
      'Tab キーだけで全手順を完走することは未確認。クリップボードの内容そのもの（貼り付け結果）は未確認',
      '公開後のアドレスでも共有リンクが同じ動作かは未確認',
    ],
  },
  {
    n: 2,
    scope: '衛星アワード（提案A／提案B）',
    report: DIR2 + 'satellite.md',
    a: [4, 4, 5, 4, 3],
    aReported: 20,
    unverified: [
      'アプリから「統合ダッシュボード」で戻ったときの戻り先タブは未確認（今回は戻りを使わず直接移動）',
      'CSV 書き出しは実行せず（ボタンの存在と手順上の扱いのみ確認）。エラー表示も試していない',
      'キーボードは一部の手順のみ（提案A 手順3、提案B の確認・記録）。スマホ幅は自タブ内の390px iframe で、実機ではない',
    ],
  },
  {
    n: 3,
    scope: 'イチBiz（バス路線見直し案／地名の記憶マップ）',
    report: DIR2 + 'ichibiz-business-idea.md',
    a: [4, 4, 4, 4, 3],
    aReported: 19,
    unverified: [
      'CSV／GeoJSON の書き出し（ダウンロード）と各アプリの「実行サンプル」は未実行',
      'バス路線の路線の追加・削除・検索は試していない',
      'スマホ幅は390px の iframe で1枚のみ',
    ],
  },
  {
    n: 4,
    scope: 'イチBiz（相談前の1枚シート）・スマホ幅のポータル',
    report: DIR2 + 'ichibiz-realestate-mobile.md',
    a: [4, 4, 4, 4, 3],
    aReported: 19,
    unverified: [
      'スマホ幅は 390×844 の iframe（実効の描画幅375px）での確認で、実機のタッチ・アドレスバーは未検証',
      '印刷ダイアログは開いていない。Tab 順による全操作の確認までは行っていない',
      '検索ヒットなしなどのエラー系は未検証。スマホでの注意点の見つけやすさは「未確認」と報告書に記載',
    ],
  },
]

export const APP_EVALS_R2: AppEval[] = [
  {
    appId: 'odpt',
    evaluator: 1,
    report: DIR2 + 'odpt-udc.md',
    b: [5, 4, 4, 5, 3, 3, 5],
    bReported: 29,
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
        note: '差別化: 題材は違うが、画面の骨格（左に5手順・右に地図・最後にコピー）と注意書きの型が同じで、同一主体の「類似作品」に見えるおそれがある（報告書）。',
      },
    ],
    high: [
      '共有リンクを新しいタブで開くと場所（pt）が落ちて手順1に戻り、受け取った家族が結論を見られない。リンクを開いたら該当地点の結論を直接表示する。復元できないなら、コピー文を結論の文面だけで完結させる。',
      '作品①と②が同じ「5手順＋地図」の型に見える。①は「家族に送る1枚（結論・最終便・次の一歩）」を画面の主役にし、②は「記録の台帳・地域でまとめる」側に寄せるなど、見せ方と最終成果物を変える。',
      '結論カードの下に「使ったデータ: 〇〇バス（ODPT/GTFS）」を事業者名つきで一行出す（C-ODPT2）。出典ボタンを開かないと分からない。',
    ],
    bugs: [
      '共有リンク（結論とリンクをコピー）を別のページから新規に開くと、場所が復元されず手順1・0/5に戻る。',
      '同一ページでURLのハッシュだけを変えて移動すると、表示は前の地点のまま URL だけ別地点になる。',
      '範囲外をタップすると赤字で「診断範囲外」と出るが、手順1は ✓ のまま、手順2が「次はこれ」になる。',
    ],
  },
  {
    appId: 'udc-moritsuchi',
    evaluator: 1,
    report: DIR2 + 'odpt-udc.md',
    b: [4, 4, 4, 5, 3, 3, 5],
    bReported: 28,
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
        note: '差別化: 作品①と同じ画面の型に見える（上記①の補足と同じ）。',
      },
    ],
    high: [
      '作品①と同じ「5手順＋地図」の型に見える。②は「記録の台帳・地域でまとめる」側に寄せるなど、結論の見せ方と最終成果物を①と変える（報告書の提案は①と②に共通）。',
    ],
    bugs: [
      '開いた直後から手順4「気づいたことを記録する」が ✓（同じブラウザに前回の保存記録が残るため）。画面に「前回の記録」の説明がない。',
      '手順5で「全記録を消す」（赤）が「GeoJSONを読み込む」の隣にある。確認の有無は試していない。',
    ],
  },
  {
    appId: 'sat-a',
    evaluator: 2,
    report: DIR2 + 'satellite.md',
    b: [4, 4, 4, 4, 3, 4, 5],
    bReported: 28,
    c: [
      {
        contest: 'satellite-2026',
        label: '衛星アワード 提案A',
        items: [
          { name: 'C-SAT1 テーマ合致', score: 5 },
          { name: 'C-SAT2 衛星データの妥当性', score: 3 },
          { name: 'C-SAT3 実現性・収益性', score: 4 },
          { name: 'C-SAT4 社会発展性', score: 3 },
          { name: 'C-SAT5 開発の進捗（加点）', score: 4 },
        ],
        reported: 19,
        note: '差別化（衛星内）: 提案Aと提案Bは対象と利用者が異なり、似て見えない（報告書）。',
      },
    ],
    high: [
      '衛星値が人手の式と乱数であることが最大の弱点（C-SAT2）。公開InSARの沈下速度を少数区画だけでも使い「架空の街」に実データを混ぜる。難しければ「衛星指標の作り方」の図を1枚置く。',
      '（両アプリ共通）事業モデルに数字を足す。顧客数、1自治体あたりの想定年額の幅、削減割合の仮説と根拠を「仮説」の印付きで（C-SAT3）。',
    ],
    bugs: [
      '手順2のスライダ説明行（走らせられる延長）が、固定の「選択中 0 区間」帯の下に重なって一部切れて見える。',
      '「点数の上位から自動で選ぶ」を押すとボタンが約16px下へ動く（メッセージの追加による）。',
      'スマホ幅（iframe近似）で地図が小さく（高さ約150px）区画ラベルが重なって読めない。ヘッダは3段に折り返す。',
    ],
  },
  {
    appId: 'sat-b',
    evaluator: 2,
    report: DIR2 + 'satellite.md',
    b: [4, 4, 4, 5, 3, 3, 5],
    bReported: 28,
    c: [
      {
        contest: 'satellite-2026',
        label: '衛星アワード 提案B',
        items: [
          { name: 'C-SAT1 テーマ合致', score: 4 },
          { name: 'C-SAT2 衛星データの妥当性', score: 2 },
          { name: 'C-SAT3 実現性・収益性', score: 4 },
          { name: 'C-SAT4 社会発展性', score: 4 },
          { name: 'C-SAT5 開発の進捗（加点）', score: 5 },
        ],
        reported: 19,
      },
    ],
    high: [
      '衛星由来の変化量を実データで1つでも点数に載せる（例: 実在の盛土1〜2か所に公開済みの Sentinel-1/InSAR 結果または地理院の標高差）。現状は「衛星由来：点数外」と出るだけで、審査基準の核心を満たさない（C-SAT2）。',
      '（両アプリ共通）事業モデルに数字を足す。顧客数、1自治体あたりの想定年額の幅、削減割合の仮説と根拠を「仮説」の印付きで（C-SAT3）。',
      '初期状態の「記録1件／巡視済み」を空にする、または「サンプルの巡視記録」と明示し、回り順から巡視済みを除く（B5）。',
    ],
    bugs: [
      '開くと「巡視を記録済み 1か所／記録 1件」が最初から出る（画面に「前の利用者の記録が残っている場合があります」の注意あり）。',
      '手順3は開いた時点で ✓ になり「次はこれ」が手順4へ移る。計画の1番に既に「巡視済み」の地点が入る。',
      '手順3の回り順の線が北と南を往復し、5番が遠く（約17.4km）離れる。最短順のようには見えない（近傍法との説明はある）。',
    ],
  },
  {
    appId: 'biz-business',
    evaluator: 3,
    report: DIR2 + 'ichibiz-business-idea.md',
    b: [4, 4, 4, 4, 3, 4, 4],
    bReported: 27,
    c: [
      {
        contest: 'ichibiz-2026',
        label: 'イチBiz バス路線（ビジネス部門）',
        items: [
          { name: 'C-BIZ1 独創性', score: 3 },
          { name: 'C-BIZ2 社会的インパクト', score: 4 },
          { name: 'C-BIZ3 実現可能性', score: 4 },
          { name: 'C-BIZ4 持続性', score: 3 },
        ],
        reported: 14,
      },
    ],
    high: [
      '手順1・手順4は、操作しなくても済になる。「例のまま確定」「見ただけ」で完了にするならナビに書くか、確定ボタンを押した時だけ済にする（B5）。',
      '案A・案Bを同じ画面に並べて見られるようにする（地図に2案を色分けで同時表示、または比較バー）。結論「案B」の根拠が地図から見えない。',
      '持続性（C-BIZ4）の根拠を画面に出す。年額ライセンス（価格未定）を、想定顧客数・導入手順・データ更新の担い手で補う。',
    ],
    bugs: ['手順1が最初から済、手順4は開くだけで済になり、操作しなくても進捗が進む。'],
  },
  {
    appId: 'biz-idea',
    evaluator: 3,
    report: DIR2 + 'ichibiz-business-idea.md',
    b: [4, 4, 4, 3, 3, 4, 5],
    bReported: 27,
    c: [
      {
        contest: 'ichibiz-2026',
        label: 'イチBiz 地名の記憶マップ（アイデア部門）',
        items: [
          { name: 'C-BIZ1 独創性', score: 4 },
          { name: 'C-BIZ2 社会的インパクト', score: 3 },
          { name: 'C-BIZ3 実現可能性', score: 3 },
          { name: 'C-BIZ4 持続性', score: 3 },
        ],
        reported: 13,
      },
    ],
    high: [
      '開いた直後に「6のうち2完了」（手順4・5が済）となる。初回表示や再訪時に「前回の記録があります／最初からやり直す」を明示するか、今回の操作に基づく進捗だけを数える（B4・B5）。',
    ],
    bugs: [
      '開いた直後に「6のうち2完了」で手順4・5が済。手順1の地名も未選択（他の評価者の保存が同一ブラウザに残った可能性あり）。',
      '手順3で推薦ボタンを押すと説明文が伸び、下の項目が約30px下がって押し損じた。',
      '初回の地図が「地図を読み込み中…」の淡い表示のまま数秒止まる。',
      '「サンプルの語りを入力欄に写す」を押して保存すると、保存後に入力欄が空に戻る（通知には書かれている）。',
    ],
  },
  {
    appId: 'biz-realestate',
    evaluator: 4,
    report: DIR2 + 'ichibiz-realestate-mobile.md',
    b: [4, 4, 4, 4, 3, 3, 5],
    bReported: 27,
    c: [
      {
        contest: 'ichibiz-2026',
        label: 'イチBiz 相談前の1枚シート（不動産情報活用部門）',
        items: [
          { name: 'C-BIZ1 独創性', score: 3 },
          { name: 'C-BIZ2 社会的インパクト', score: 4 },
          { name: 'C-BIZ3 実現可能性', score: 3 },
          { name: 'C-BIZ4 持続性', score: 3 },
        ],
        reported: 13,
        note: '不動産情報ライブラリの活用（一言評価）: 2/5相当。画面で「ライブラリとの関係」を整理していて誠実だが、実際のデータはライブラリ由来ではなく、部門の趣旨の核は未達成と見える（報告書）。',
      },
    ],
    high: [
      '不動産情報ライブラリを最低1項目でも実際に取得して手順3に出し、「ライブラリ由来」バッジを付ける。取得できない場合の表示も用意する。部門の評価の中心で最優先。',
      'サンプル土地の前提「市街化調整区域」と、地図の徳島駅周辺の商業系用途地域とのズレを解消する。サンプルを廃止して実検索の例を既定にする案もある。',
      '持続性（誰が・いくらで・どう更新するか）を、手順5のシート上部かポータルのカード上にも要約で置く。',
      'スマホで手順一覧を開くと地図が隠れる。最終シートは4241pxあるので、出口ごとの折りたたみか「出口を1つ選ぶと該当だけ表示」にする。',
    ],
    bugs: [
      '手順2は未回答でも「地図では分からないことに答える ✓」になる。',
      'アプリを再読み込みすると前回の進捗（5/5完了）が復元され、検索欄に入力しても手順5のまま反応が無いように見える。復元の表示か「最初からやり直す」が欲しい。',
      '「実行サンプルを見る」を開いた直後、一瞬「土地の位置がまだ決まっていません」と出る。',
      'スマホで手順一覧を開くと地図が隠れ、手順を選ぶまで開いたまま。',
      'サンプル土地の「市街化調整区域」が、地図背景（徳島駅周辺の商業系用途地域の色）と食い違って見える。',
    ],
  },
]

/** 第2回のポータルへの指摘（各報告書の改善提案・食い違い欄から） */
export const PORTAL_FINDINGS_R2: PortalFinding[] = [
  { priority: '高', by: [1, 2, 3, 4], text: 'AI評価の表示（帯・タブ・各カードの点数・タブ末尾）が複数箇所にあり、審査員が見たい募集内容・締切を押し下げる（4名とも A5 を3点）。1か所（専用タブ）に集約する。' },
  { priority: '高', by: [1], text: 'ODPT の審査基準4項目が見出しだけで説明がない。UDC のように各一行の説明を付け、要項に説明がなければ「要項に記載なし」と明記する。' },
  { priority: '高', by: [1, 4], text: '初期画面で「注意点」まで見えない（デスクトップ 1568×765）。概要の一文と締切を上に詰める。スマホでは概要が約2821pxと縦長で、注意点が押し下げられる。' },
  { priority: '中', by: [4], text: 'イチBiz不動産部門の説明（「活用する不動産情報ライブラリの情報を書く」）だけ読むと活用済みと受け取れる。デモはライブラリの API をまだ使っていない旨をポータルにも示す。' },
  { priority: '中', by: [3], text: 'イチBizの注意点で、失格につながる条件（生成AI・知財・秘密にしたい案）と、受賞後の義務（現地参加）が同じ枠に混在し、重みが同じに見える。' },
  { priority: '低', by: [1], text: 'UDC タブの作品①の案内「もう1件」が小さな一行で、カードに見えず見落としやすい。' },
  { priority: '低', by: [2], text: '衛星タブに協賛企業テーマと共通テーマ1・2の内容を1行ずつ載せる。' },
  { priority: '食い違い', by: [3], text: 'ポータルの地名の記憶マップの説明「公開データで確かめ」は、実際は伝承碑と旧版地図の重ね合わせで、「手がかりを探す」が正確（アプリの説明文の側の記載）。' },
  { priority: '食い違い', by: [1], text: 'ポータルの診断マップ紹介の「富山市・上市町・立山町…」は5地域のうち富山の話で、他4地域で同様の接続診断ができるかはアプリ内から分からない（アプリの説明文の側の記載）。' },
]

export const COMMON_UNVERIFIED_R2 = [
  'キーボード（Tab/Enter）操作は、一部の手順のみ確認したアプリが多く、全手順の通しは未確認',
  'スマホ幅は headless Chrome や iframe による確認が中心で、実機は未確認',
  '書き出し（CSV・GeoJSON のダウンロード）と印刷は、実行していないアプリがある',
  '各アプリの B・C は1名の評価者による採点で、複数人の突き合わせはしていない',
  '第2回の後にさらに改修が入る予定で、その画面は未評価',
]

// ---------------------------------------------------------------------------
// 回ごとの束ね
// ---------------------------------------------------------------------------

export type Round = 1 | 2
export interface RoundData {
  round: Round
  date: string
  /** 評価対象の画面の説明 */
  target: string
  evaluators: Evaluator[]
  apps: AppEval[]
  findings: PortalFinding[]
  unverified: string[]
}

export const ROUND_1: RoundData = {
  round: 1,
  date: EVAL_DATE_R1,
  target: '改修前の画面',
  evaluators: EVALUATORS_R1,
  apps: APP_EVALS_R1,
  findings: PORTAL_FINDINGS_R1,
  unverified: COMMON_UNVERIFIED_R1,
}
export const ROUND_2: RoundData = {
  round: 2,
  date: EVAL_DATE_R2,
  target: '第1回の改修後の画面',
  evaluators: EVALUATORS_R2,
  apps: APP_EVALS_R2,
  findings: PORTAL_FINDINGS_R2,
  unverified: COMMON_UNVERIFIED_R2,
}

/** 最新（第2回）と、その前（第1回）。さらに回が増えたらここを差し替える */
export const LATEST = ROUND_2
export const PREVIOUS = ROUND_1
export const APP_EVALS = LATEST.apps

export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)
export const pct = (score: number, max: number) => Math.round((score / max) * 100)

export function evalOf(appId: string, r: RoundData = LATEST): AppEval | undefined {
  return r.apps.find((e) => e.appId === appId)
}
export function cSetOf(appId: string, contest: ContestId, r: RoundData = LATEST): CSet | undefined {
  return evalOf(appId, r)?.c.find((c) => c.contest === contest)
}
export const cMax = (c: CSet) => c.items.length * 5
export const bTotal = (ev: AppEval) => sum(ev.b)
export const cTotal = (c: CSet) => sum(c.items.map((i) => i.score))
export const aTotal = (e: Evaluator) => sum(e.a)

/** 点の差。+3／−2／±0 の形（色に頼らず符号で示す） */
export function deltaText(d: number): string {
  return d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : '±0'
}

/** 第1回→第2回の差（アプリ・コンペ単位）。どちらかの回に無ければ undefined */
export function diffOf(appId: string, contest: ContestId): { b: number; c: number } | undefined {
  const a1 = evalOf(appId, PREVIOUS)
  const a2 = evalOf(appId, LATEST)
  const c1 = cSetOf(appId, contest, PREVIOUS)
  const c2 = cSetOf(appId, contest, LATEST)
  if (!a1 || !a2 || !c1 || !c2) return undefined
  return { b: bTotal(a2) - bTotal(a1), c: cTotal(c2) - cTotal(c1) }
}

