import { useEffect, useMemo, useState } from 'react'
import { MotionConfig } from 'motion/react'
import { APPS, CONTESTS, isNewPlan, type ContestId } from '@/apps/registry'
import { contestsByDeadline } from '@/apps/contests-info'
import { AppFitCard, CautionSummary, ContestTopCard, ScrollRow } from '@/pages/TopRows'
import { matchesAppQuery } from '@/components/layout/AppShell'
import { asOf } from '@/pages/Progress'
import { OVERALL, PROGRESS_SOURCE } from '@/data/progress'
import { FIT_AS_OF, FIT_CAUTIONS, FIT_NOTE, FIT_SOURCE } from '@/data/app-fit'
import { downloadText } from '@/components/shared/downloadText'
import { MARK_WORD, activeCautions, loadTargets, saveTargets, sortApps, targetsJson, toggleTarget, type Targets } from '@/lib/fit'

/**
 * ポータル（統合ダッシュボード）。上にコンペのカード4枚（締切順・横一列）、下にアプリのカード（横一列）。
 * コンペを選ぶと、アプリが「そのコンペとの関連が強い順」に並び替わる。各アプリの提出先（出せるコンペ）はカードで選べる。
 * 選択はこのブラウザの localStorage だけに保存する下書きで、正式な提出先は総司令官が決める。
 */
export default function Portal() {
  const sorted = contestsByDeadline()
  const [contest, setContest] = useState<ContestId | null>(null)
  const [targets, setTargets] = useState<Targets>(() => loadTargets())
  const [saved, setSaved] = useState(true)
  const [copied, setCopied] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    setSaved(saveTargets(targets))
  }, [targets])

  const sortedAll = useMemo(() => sortApps(APPS, contest), [contest])
  const apps = useMemo(() => sortedAll.filter((a) => matchesAppQuery(a, q)), [sortedAll, q])
  const cautions = useMemo(() => activeCautions(targets), [targets])
  const contestName = contest ? CONTESTS.find((c) => c.id === contest)!.name : null
  const total = Object.values(targets).reduce((n, v) => n + v.length, 0)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(targetsJson(targets))
      setCopied('JSON をコピーしました')
    } catch {
      setCopied('コピーできませんでした。ダウンロードを使ってください')
    }
  }
  const c12 = FIT_CAUTIONS.find((c) => c.id === 'C12')!
  const btn = 'min-h-9 rounded-md border-2 border-slate-900 bg-white px-2 font-bold hover:bg-slate-100 disabled:border-slate-400 disabled:text-slate-600'

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto max-w-[90rem] space-y-1.5">
        <h1 className="sr-only">統合ダッシュボード</h1>
        <header className="text-xs" data-testid="portal-legend">
          <p className="text-slate-700">
            {asOf} 時点。コンペは締切順。カードを選ぶと、アプリがそのコンペとの関連の強い順に並びます　<span aria-hidden>？</span> 総司令官の判断待ち
          </p>
          <ul data-testid="progress-overall">
            <li className="flex gap-1.5">
              <span aria-hidden>▲</span>
              <span>
                <span className="font-bold">どの案も提出不可: 本人欄が未記入</span>
                <span className="ml-3" title={OVERALL[1]}>マージ保留（総司令官補佐が止めた PR）: PR #35・#36・#18・#19・#27</span>
              </span>
            </li>
          </ul>
        </header>

        <section aria-labelledby="h-contests" className="space-y-0.5" data-testid="contest-list">
          <h2 id="h-contests" className="text-sm font-bold">
            コンペ（4件・締切順）
            <span className="ml-2 text-xs font-normal text-slate-700 lg:hidden">横にスクロールして4枚を見られます</span>
          </h2>
          <div className="-mx-2 flex snap-x items-stretch gap-2 overflow-x-auto px-2 py-1 lg:grid lg:grid-cols-4 lg:overflow-visible" data-testid="contest-row">
            {sorted.map((c) => (
              <div key={c.id} className="flex w-72 shrink-0 snap-start flex-col lg:w-auto">
                <ContestTopCard
                  info={c}
                  selected={contest === c.id}
                  onSelect={() => setContest((cur) => (cur === c.id ? null : c.id))}
                  targets={targets}
                />
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="h-apps" className="space-y-0.5" data-testid="app-section">
          <h2 id="h-apps" className="text-sm font-bold">
            アプリ（{APPS.length}件・今の案{APPS.filter((a) => !isNewPlan(a)).length}＋新しい案{APPS.filter(isNewPlan).length}）
            <span className="ml-2 text-xs font-normal" data-testid="sort-note" role="status">
              {contestName
                ? `「${contestName}」との関連が強い順（1位: ${sortedAll[0].name}。◎→○→△→×・？の順、同じ強さは登録順。イチBiz は3部門のうち最も強い関連）`
                : '並び順: 全コンペ（6列）の関連の強さの合計が高い順（同じなら登録順）'}
            </span>
          </h2>
          <ScrollRow
            label="アプリのカード"
            resetKey={`${contest ?? 'none'}|${q}`}
            total={apps.length}
            toolbar={
              <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
                <label htmlFor="top-app-filter" className="font-bold">名前・目的で絞り込む</label>
                <input
                  id="top-app-filter"
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="例: 病院、AED、盛土、遅れ"
                  className="h-9 w-48 max-w-full rounded-md border-2 border-slate-900 bg-white px-2 text-sm"
                  data-testid="top-app-filter"
                />
                {q.trim() && <span role="status" data-testid="top-filter-count">{apps.length ? `${apps.length}件に絞りました` : '該当するアプリはありません'}</span>}
              </span>
            }
          >
            {apps.map((a) => (
              <AppFitCard
                key={a.id}
                a={a}
                rank={sortedAll.indexOf(a) + 1}
                contest={contest}
                targets={targets}
                onToggle={(app, col) => setTargets((t) => toggleTarget(t, app, col))}
                cautions={cautions.filter((c) => c.apps.includes(a.id))}
              />
            ))}
          </ScrollRow>
          <CautionSummary count={cautions.length} />
        </section>

        {/* 凡例・下書きの注意・JSON 書き出し・全体の状況・出典は1行に畳む（開くと詳細） */}
        <details className="rounded border-2 border-slate-900 bg-slate-50 px-2 text-xs" data-testid="draft-note">
          <summary className="min-h-8 cursor-pointer py-1 font-bold">
            下書き（このブラウザだけ）: 選んだ組 <span data-testid="draft-count">{total}件{!saved && '（このブラウザでは保存できず、画面を閉じると消えます）'}</span>
            <span className="ml-2 font-normal">／ 開くと: 下書きの注意・JSON 書き出し・凡例（◎○△×？）・全体の状況・出典</span>
          </summary>
          <p className="font-bold">この選択はこのブラウザだけの下書きです。正式な提出先は総司令官が参謀長に指示してください。</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button type="button" onClick={copy} className={btn} data-testid="copy-json">選択を JSON でコピー</button>
            <button
              type="button"
              onClick={() => downloadText('submit-targets-draft.json', targetsJson(targets), 'application/json;charset=utf-8')}
              className={btn}
              data-testid="download-json"
            >
              JSON をダウンロード
            </button>
            <button type="button" onClick={() => setTargets({})} disabled={!total} className={btn} data-testid="clear-targets">
              選択をすべて外す
            </button>
            <span role="status" className="font-bold">{copied}</span>
          </div>
          <p className="mt-1 leading-snug">各カードの「提出先を選ぶ」で、出せるコンペ（◎○△。？は要確認つき）を複数選べます。× は選べません。選んだ内容はこのブラウザの localStorage に保存します。</p>
          <ul className="space-y-0.5 pb-1 leading-snug">
            {(['◎', '○', '△', '×', '？'] as const).map((m) => (
              <li key={m}><span className="font-bold">{m} {MARK_WORD[m]}</span></li>
            ))}
            <li>{FIT_NOTE}</li>
            <li>{c12.text}</li>
            <li className="text-slate-700">［出典: {FIT_SOURCE}（{FIT_AS_OF}）］</li>
          </ul>
          <div className="border-t pt-1" data-testid="progress-overall-full">
            <p className="font-bold">全体（{PROGRESS_SOURCE}）</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {OVERALL.map((t) => (
                <li key={t} className="break-words">{t}</li>
              ))}
            </ul>
          </div>
          <p className="mt-1 border-t py-1 text-slate-700" data-testid="portal-source">
            出典: 各コンペの公式要項（取得日 2026-11-09）、進捗は {PROGRESS_SOURCE}（{asOf} 時点）、アプリとコンペの関連は {FIT_SOURCE}（{FIT_AS_OF}）。
          </p>
        </details>
      </div>
    </MotionConfig>
  )
}
