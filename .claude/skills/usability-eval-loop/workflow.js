export const meta = {
  name: 'usability-eval-loop',
  description: '目的と目標だけを伝えた評価者（sonnet）5体の実ブラウザ評価と、工兵（opus）の修正を、アプリごとに繰り返す',
  whenToUse: '画面を持つアプリの目標達成度と使いやすさを、提出前に磨き込む時（総司令官の明示の指示がある時だけ）',
  phases: [
    { title: 'Evaluate', detail: '各アプリに評価者5体（立場を分ける）', model: 'sonnet' },
    { title: 'Fix', detail: '各アプリに工兵1体が指摘を直してコミット', model: 'opus' },
  ],
}

// args: { apps: [{ key, name, dir, web, page, portBase, purpose, goals: [], extraFix? }],
//         maxRounds?: number (既定 5), stopOnPlateau?: boolean (既定 true),
//         evaluatorModel?: string (既定 'sonnet'), fixerModel?: string (既定 'opus') }
//   dir: 事前に作った worktree の絶対パス（ブランチ checkout 済み）
//   web: dir からのアプリのディレクトリ（index.html がある所）
//   extraFix: 工兵への追加の指示（例: ダッシュボード側の別実装も直す）
const A = args || {}
const APPS = A.apps || []
const MAX = A.maxRounds || 5
const PLATEAU = A.stopOnPlateau !== false
const EVAL_MODEL = A.evaluatorModel || 'sonnet'
const FIX_MODEL = A.fixerModel || 'opus'
const EVALUATORS = 5
const PERSONAS = [
  'その分野の実務担当者（初めてこの画面を見る）',
  'コンペの審査員（短時間で価値を判断する）',
  'IT に不慣れな一般の利用者',
  'スマホ（390×844）だけで使う利用者',
  'データの根拠と誤解の起きやすさに厳しい専門家',
]
if (!APPS.length) throw new Error('args.apps が空です')

const EVAL_SCHEMA = {
  type: 'object',
  properties: {
    goals: { type: 'array', items: { type: 'object', properties: {
      goal: { type: 'string' }, achieved: { type: 'string', enum: ['達成', '一部', '未達'] }, evidence: { type: 'string' } },
      required: ['goal', 'achieved', 'evidence'] } },
    score: { type: 'number', description: '目標達成度 0〜10' },
    scrollCount: { type: 'number', description: '目標達成までに要した縦スクロールの回数（ページ・パネル）' },
    screenTransitions: { type: 'number', description: '目標達成までに要した画面遷移・タブ切替の回数' },
    tooMuchText: { type: 'string', description: '文字が多すぎる箇所（なければ「なし」）' },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['重大', '中', '軽微'] }, issue: { type: 'string' }, suggestion: { type: 'string' } },
      required: ['severity', 'issue', 'suggestion'] } },
  },
  required: ['goals', 'score', 'scrollCount', 'screenTransitions', 'tooMuchText', 'findings'],
}
const FIX_SCHEMA = {
  type: 'object',
  properties: {
    commit: { type: 'string' },
    fixed: { type: 'array', items: { type: 'string' } },
    notFixed: { type: 'array', items: { type: 'object', properties: {
      issue: { type: 'string' }, reason: { type: 'string' },
      dataConstraint: { type: 'boolean', description: 'データが存在しない・取れないなど、実装では直せない制約なら true' } },
      required: ['issue', 'reason', 'dataConstraint'] } },
    tests: { type: 'string' },
  },
  required: ['commit', 'fixed', 'notFixed', 'tests'],
}

const STOP_SERVER = (port) => `サーバーは起動時に PID を控えて \`kill <PID>\` で止めるか、\`fuser -k ${port}/tcp\` を使う。pkill のパターン一致は自分のシェルや他の作業（5180 のプレビューなど）を巻き込むので使わない。`

function evalPrompt(app, round, i) {
  const port = app.portBase + i
  return `あなたはアプリの評価者です。立場: ${PERSONAS[i]}。
評価するアプリ「${app.name}」の目的と目標だけを伝えます。README やソースコードの説明は読まず、画面だけを見て、目標に到達できるかを検証してください。

目的: ${app.purpose}
目標:
${app.goals.map((g, k) => `${k + 1}. ${g}`).join('\n')}

アプリの開き方:
- ${app.dir}/${app.web} を、自分で \`python3 -m http.server ${port} --bind 127.0.0.1\` で配信する（バックグラウンド起動）。ページは http://127.0.0.1:${port}/${app.page || 'index.html'}。
- headless の google-chrome を CDP（node 22 の WebSocket）で操作し、実際にクリック・入力・スクロールして目標を達成しようとする。操作の書き方はアプリの tests/ui_check.mjs などが参考になる（読むのは操作方法だけ。評価は画面で行う）。
- 画面サイズは 1513×784 と 390×844 の両方。スクリーンショットを撮って自分の目で確かめる。
- 作業ファイルは /tmp/claude-1000/evalloop/${app.key}-r${round}-e${i}/ に置く。${STOP_SERVER(port)}
- ファイルは一切変更しない。外部への POST はしない。

評価の基準:
- 目標ごとに 達成／一部／未達 と、その根拠（画面で見たこと）を書く。
- 縦スクロール、画面遷移・タブ切替、文字数が多いことはマイナスとして扱う。必要だった回数と、文字が多すぎる箇所を報告する。
- 指摘は重大・中・軽微に分け、具体的な直し方を付ける。架空のデータを実データと誤解させる表示は重大。
- これは第${round}回の評価です。`
}

function fixPrompt(app, round, evals, prev, constraints) {
  const list = evals.map((e, i) => `### 評価者${i + 1}（${PERSONAS[i]}） 点数 ${e.score}/10・スクロール ${e.scrollCount}回・画面遷移 ${e.screenTransitions}回・文字が多い: ${e.tooMuchText}
目標: ${e.goals.map((g) => `${g.goal}=${g.achieved}`).join(' / ')}
${e.findings.map((f) => `- [${f.severity}] ${f.issue} → ${f.suggestion}`).join('\n')}`).join('\n\n')
  const trend = prev ? `前回との比較: スクロール合計 ${prev.scrollSum}→${evals.reduce((s, e) => s + e.scrollCount, 0)}、画面遷移合計 ${prev.transSum}→${evals.reduce((s, e) => s + e.screenTransitions, 0)}。片方を減らすと、もう片方が増えやすい。増えた側を意識して直す。` : ''
  const known = constraints.length ? `\nデータの制約として扱う指摘（直さない。数値を作らない。判断事項として notFixed に残す）:\n${constraints.map((c) => `- ${c}`).join('\n')}` : ''
  return `意図: アプリ「${app.name}」を、評価者5体の指摘に基づいて改修する（第${round}回）。方針: 縦スクロール・画面遷移・文字数の多さはマイナス。目標の達成を最優先する。

作業場所: ${app.dir}（作業ブランチが checkout 済み）。この worktree の中だけで作業し、ブランチを切り替えない。アプリは ${app.web}。

目的: ${app.purpose}
目標: ${app.goals.join(' / ')}
${trend}${known}

評価者の指摘（第${round}回）:
${list}

やること:
1. 重大 → 中 → 軽微の順に直す。複数の評価者が挙げた点を優先し、目標の未達・一部を解消することを最優先にする。評価者どうしの意見が逆の時は、多数に合わせ、判断ログに書く。
2. 縦スクロール・画面遷移・文字数を減らす。説明文は短くする。折りたたみや一覧より、1画面で目標が完結する形を優先する。ただし、出典・ライセンス表示・架空の明示・責任表示は消さない（短くするのはよい）。
3. 根拠のない数値は書かない。「適正」「最適」の断定や「査定」の語は使わない。データが無いことによる指摘は直さず、dataConstraint=true として返す。
4. ${app.extraFix || 'ダッシュボードが単体アプリを埋め込んでいる場合は、単体アプリを直せばよい。'}
5. アプリ既存のテスト（tests/ 配下）を通す。古い画面を前提にしたテストは直してよい。ただし、架空の明示・出典の検査は外さない。contests/dashboard で \`npm run build\` と \`npx vitest run\` を通す（node_modules が無ければ \`npm ci\`）。
6. 1513×784 と 390×844 で自分でも画面を確かめる（ポート ${app.portBase + 9}。${STOP_SERVER(app.portBase + 9)} 5180 は使わない）。
7. コミットする（push しない）。コミットメッセージは「評価ループ第${round}回: ${app.name} …」。

制約: contests/registry.json は変更しない。ページは削除しない。秘密情報は読まない。外部への POST はしない。作業回数に限りがあるので、余計な探索はしない。`
}

const results = await pipeline(APPS, async (app) => {
  const history = []
  const constraintSeen = {}
  let prev = null
  for (let round = 1; round <= MAX; round++) {
    const evals = (await parallel(Array.from({ length: EVALUATORS }, (_, i) => () =>
      agent(evalPrompt(app, round, i), { label: `${app.key} r${round} 評価${i + 1}`, phase: 'Evaluate', model: EVAL_MODEL, schema: EVAL_SCHEMA })))).filter(Boolean)
    if (!evals.length) { log(`${app.key} 第${round}回: 評価者が全員失敗。ループを止める`); break }
    const avg = evals.reduce((s, e) => s + e.score, 0) / evals.length
    const crit = evals.flatMap((e) => e.findings).filter((f) => f.severity === '重大').length
    const mid = evals.flatMap((e) => e.findings).filter((f) => f.severity === '中').length
    const unmet = evals.flatMap((e) => e.goals).filter((g) => g.achieved !== '達成').length
    const scrollSum = evals.reduce((s, e) => s + e.scrollCount, 0)
    const transSum = evals.reduce((s, e) => s + e.screenTransitions, 0)
    log(`${app.key} 第${round}回: 平均 ${avg.toFixed(1)}/10・重大 ${crit}・中 ${mid}・未達/一部 ${unmet}・スクロール計 ${scrollSum}・遷移計 ${transSum}`)
    const row = { round, avg: Math.round(avg * 10) / 10, crit, mid, unmet, scroll: evals.map((e) => e.scrollCount), transitions: evals.map((e) => e.screenTransitions) }
    // 打ち切り: 重大0・未達0 で、伸びが2回続けて 0.3 未満
    const g1 = history.length >= 1 ? row.avg - history[history.length - 1].avg : 99
    const g2 = history.length >= 2 ? history[history.length - 1].avg - history[history.length - 2].avg : 99
    if (PLATEAU && crit === 0 && unmet === 0 && g1 < 0.3 && g2 < 0.3) {
      history.push({ ...row, fix: null, stopped: '頭打ちのため修正せず終了' })
      log(`${app.key}: 第${round}回で頭打ち。ループを止める`)
      break
    }
    const constraints = Object.keys(constraintSeen).filter((k) => constraintSeen[k] >= 2)
    const fix = await agent(fixPrompt(app, round, evals, prev, constraints), { label: `${app.key} r${round} 修正`, phase: 'Fix', model: FIX_MODEL, agentType: 'engineer', schema: FIX_SCHEMA })
    if (fix) for (const n of fix.notFixed) if (n.dataConstraint) constraintSeen[n.issue] = (constraintSeen[n.issue] || 0) + 1
    history.push({ ...row, fix: fix ? { commit: fix.commit, fixed: fix.fixed.length, notFixed: fix.notFixed, tests: fix.tests } : null })
    prev = { scrollSum, transSum }
  }
  const dataConstraints = Object.keys(constraintSeen)
  if (dataConstraints.length) log(`${app.key}: データの制約（総司令官の判断事項）${dataConstraints.length} 件`)
  return { app: app.key, name: app.name, history, dataConstraints }
})
return results.filter(Boolean)
