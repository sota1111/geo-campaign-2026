// 第3回評価（GPT-6.1 sol low の評価者10名）の JSON を集計する純粋関数。数値の計算はここだけで行う。
// 形式の崩れには寛容に: 崩れた値は警告に書いて除外し、残りで集計する。
export const PURPOSE_TO_APP = {
  1: 'odpt', 2: 'udc-moritsuchi', 3: 'sat-a', 4: 'sat-b', 5: 'biz-business', 6: 'biz-idea',
  7: 'biz-realestate', 8: 'sat-alpha', 9: 'biz-business-nb', 10: 'biz-realestate-rn1', 11: 'udc-aed', 12: 'odpt-teiji',
}
export const EVAL3_DATE = '2026-11-13'
export const EVAL3_MODEL = 'GPT-6.1 sol low'
export const EVAL3_SOURCE = 'reports/ops/dashboard-eval-20261113/'

export const isScore = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 5
const round2 = (x) => Math.round(x * 100) / 100

/** 値の配列（null は欠測）→ {mean,min,max,n}。有効値が無ければ null */
export function stat(values) {
  const v = values.filter((x) => isScore(x))
  if (!v.length) return null
  return { mean: round2(v.reduce((a, b) => a + b, 0) / v.length), min: Math.min(...v), max: Math.max(...v), n: v.length }
}

/** 軸が固定長の配列（A=5, B=7）。長さ不一致なら全体を除外、個々の値が不正なら null にして警告 */
function fixedArray(arr, len, label, warn) {
  if (!Array.isArray(arr)) { warn(`${label}: 配列でないため除外`); return null }
  if (arr.length !== len) { warn(`${label}: 長さ ${arr.length}（期待 ${len}）のため除外`); return null }
  return arr.map((x, i) => {
    if (isScore(x)) return x
    warn(`${label}[${i + 1}]: ${JSON.stringify(x)} は 0〜5 の整数でないため除外`)
    return null
  })
}

function goalsOf(obj, label, warn) {
  const out = {}
  if (obj == null) return out
  if (typeof obj !== 'object' || Array.isArray(obj)) { warn(`${label}: goals がオブジェクトでないため除外`); return out }
  for (const [k, g] of Object.entries(obj)) {
    if (g && typeof g === 'object' && typeof g.achieved === 'boolean') out[k] = g.achieved
    else warn(`${label}: 目標 ${k} の achieved が真偽値でないため除外`)
  }
  return out
}

/** 評価者1名分の JSON を正規化。使えない部分は除外して警告 */
export function normalizeEvaluator(raw, fileLabel, warnings) {
  const warn = (m) => warnings.push(`${fileLabel}: ${m}`)
  if (!raw || typeof raw !== 'object') { warn('JSON がオブジェクトでないため除外'); return null }
  const out = { portal: null, apps: [] }
  if (raw.portal && typeof raw.portal === 'object') {
    out.portal = {
      A: fixedArray(raw.portal.A, 5, 'portal.A', warn),
      goals: goalsOf(raw.portal.goals, 'portal', warn),
    }
  } else warn('portal がないため除外')
  if (!Array.isArray(raw.apps)) { warn('apps が配列でないため除外'); return out }
  raw.apps.forEach((a, i) => {
    const appId = PURPOSE_TO_APP[a?.purpose]
    if (!appId) { warn(`apps[${i}]: purpose ${JSON.stringify(a?.purpose)} は未知のため除外`); return }
    const label = `apps[${i}](${appId})`
    const C = {}
    if (a.C && typeof a.C === 'object' && !Array.isArray(a.C)) {
      for (const [k, v] of Object.entries(a.C)) {
        if (isScore(v)) C[k] = v
        else warn(`${label}.C.${k}: ${JSON.stringify(v)} は 0〜5 の整数でないため除外`)
      }
    } else warn(`${label}: C がオブジェクトでないため除外`)
    out.apps.push({ appId, B: fixedArray(a.B, 7, `${label}.B`, warn), C, goals: goalsOf(a.goals, label, warn) })
  })
  return out
}

function goalTally(list) {
  const t = {}
  for (const g of list) {
    for (const [k, ok] of Object.entries(g)) {
      t[k] ??= { achieved: 0, n: 0 }
      t[k].n += 1
      if (ok) t[k].achieved += 1
    }
  }
  return t
}

/** files: [{name, text}] → 集計結果（画面が読む形） */
export function aggregate(files) {
  const warnings = []
  const evals = []
  for (const f of files) {
    let raw
    try {
      raw = JSON.parse(f.text)
    } catch (e) {
      warnings.push(`${f.name}: JSON として読めないため除外（${e.message}）`)
      continue
    }
    const n = normalizeEvaluator(raw, f.name, warnings)
    if (n) evals.push(n)
  }
  const base = { date: EVAL3_DATE, model: EVAL3_MODEL, source: EVAL3_SOURCE, evaluatorFiles: files.length, warnings }
  if (!evals.length) return { ...base, collected: false, evaluatorCount: 0, portal: null, apps: {} }
  const portals = evals.map((e) => e.portal).filter(Boolean)
  const portal = {
    A: Array.from({ length: 5 }, (_, i) => stat(portals.map((p) => p.A?.[i] ?? null))),
    goals: goalTally(portals.map((p) => p.goals)),
    n: portals.length,
  }
  const byApp = {}
  for (const e of evals) for (const a of e.apps) (byApp[a.appId] ??= []).push(a)
  const apps = {}
  for (const [id, list] of Object.entries(byApp)) {
    const cKeys = [...new Set(list.flatMap((a) => Object.keys(a.C)))].sort()
    apps[id] = {
      n: list.length,
      B: Array.from({ length: 7 }, (_, i) => stat(list.map((a) => a.B?.[i] ?? null))),
      C: Object.fromEntries(cKeys.map((k) => [k, stat(list.map((a) => a.C[k] ?? null))])),
      goals: goalTally(list.map((a) => a.goals)),
    }
  }
  return { ...base, collected: true, evaluatorCount: evals.length, portal, apps }
}
