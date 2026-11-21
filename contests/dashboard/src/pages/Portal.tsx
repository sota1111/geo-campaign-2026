import { useEffect, useMemo, useState } from 'react'
import { MotionConfig } from 'motion/react'
import { APPS, CONTESTS, isNewPlan, type ContestId } from '@/apps/registry'
import { contestsByDeadline } from '@/apps/contests-info'
import { AppFitCard, CautionList, ContestTopCard, ScrollRow } from '@/pages/TopRows'
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
  useEffect(() => {
    setSaved(saveTargets(targets))
  }, [targets])

  const apps = useMemo(() => sortApps(APPS, contest), [contest])
  const cautions = useMemo(() => activeCautions(targets), [targets])
  const cautioned = new Set(cautions.flatMap((c) => c.apps))
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

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto max-w-[90rem] space-y-4">
        <h1 className="sr-only">統合ダッシュボード</h1>
        <header className="text-xs text-slate-700" data-testid="portal-legend">
          {asOf} 時点。上のコンペのカードは締切順です。コンペのカードを選ぶと、下のアプリがそのコンペとの関連の強い順に並びます　<span aria-hidden>✓</span> 済　<span aria-hidden>□</span> 残り　<span aria-hidden>？</span> 総司令官の判断待ち
        </header>
        <ul className="space-y-0.5 text-xs" data-testid="progress-overall">
          <li className="flex gap-1.5">
            <span aria-hidden>▲</span>
            <span className="font-bold">どの案も提出不可: 本人欄（氏名・所属・体制・経験）が未記入</span>
          </li>
          <li className="flex gap-1.5">
            <span aria-hidden>▲</span>
            <span title={OVERALL[1]}>マージ保留（総司令官補佐が止めた PR）: PR #35・#36・#18・#19・#27</span>
          </li>
        </ul>

        <section aria-labelledby="h-contests" className="space-y-1.5" data-testid="contest-list">
          <h2 id="h-contests" className="text-base font-bold">コンペ（4件・締切順）</h2>
          <p className="text-xs text-slate-700 lg:hidden">横にスクロールして4枚を見られます。</p>
          <div className="-mx-2 flex snap-x items-start gap-3 overflow-x-auto px-2 py-2 lg:grid lg:grid-cols-4 lg:overflow-visible" data-testid="contest-row">
            {sorted.map((c) => (
              <div key={c.id} className="w-72 shrink-0 snap-start lg:w-auto">
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

        <section aria-labelledby="h-apps" className="space-y-2" data-testid="app-section">
          <h2 id="h-apps" className="text-base font-bold">アプリ（{APPS.length}件・今の案{APPS.filter((a) => !isNewPlan(a)).length}＋新しい案{APPS.filter(isNewPlan).length}）</h2>
          <p className="text-xs" data-testid="sort-note" role="status">
            並び順: {contestName ? `「${contestName}」との関連が強い順（◎→○→△→×・？。同じ強さは登録順。イチBiz は3部門のうち最も強い関連）` : '全コンペ（6列）の関連の強さの合計が高い順（同じなら登録順）'}
          </p>
          <div className="rounded border-2 border-slate-900 bg-slate-50 p-2 text-xs" data-testid="draft-note">
            <p className="font-bold">この選択はこのブラウザだけの下書きです。正式な提出先は総司令官が参謀長に指示してください。</p>
            <p className="mt-0.5 text-slate-800">
              各カードの「提出先」で、出せるコンペ（◎○△。？は要確認つき）を複数選べます。× は選べません。選んだ内容はこのブラウザの localStorage に保存します
              {!saved && '（このブラウザでは保存できないため、画面を閉じると消えます）'}。いま選んでいる組: {total}件
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <button type="button" onClick={copy} className="min-h-9 rounded-md border-2 border-slate-900 bg-white px-2 font-bold hover:bg-slate-100" data-testid="copy-json">選択を JSON でコピー</button>
              <button
                type="button"
                onClick={() => downloadText('submit-targets-draft.json', targetsJson(targets), 'application/json;charset=utf-8')}
                className="min-h-9 rounded-md border-2 border-slate-900 bg-white px-2 font-bold hover:bg-slate-100"
                data-testid="download-json"
              >
                JSON をダウンロード
              </button>
              <button type="button" onClick={() => setTargets({})} disabled={!total} className="min-h-9 rounded-md border-2 border-slate-900 bg-white px-2 font-bold hover:bg-slate-100 disabled:border-slate-400 disabled:text-slate-600" data-testid="clear-targets">
                選択をすべて外す
              </button>
              <span role="status" className="font-bold">{copied}</span>
            </div>
            <details className="mt-1">
              <summary className="min-h-8 cursor-pointer py-1 font-bold">関連の読み方（◎○△×？の意味・出典）</summary>
              <ul className="space-y-0.5 pb-1 leading-snug">
                {(['◎', '○', '△', '×', '？'] as const).map((m) => (
                  <li key={m}><span className="font-bold">{m} {MARK_WORD[m]}</span></li>
                ))}
                <li>{FIT_NOTE}</li>
                <li>{c12.text}</li>
                <li className="text-slate-700">［出典: {FIT_SOURCE}（{FIT_AS_OF}）］</li>
              </ul>
            </details>
          </div>
          <CautionList items={cautions} />
          <ScrollRow label="アプリのカード" resetKey={contest ?? 'none'}>
            {apps.map((a, i) => (
              <AppFitCard
                key={a.id}
                a={a}
                rank={i + 1}
                contest={contest}
                targets={targets}
                onToggle={(app, col) => setTargets((t) => toggleTarget(t, app, col))}
                cautioned={cautioned.has(a.id)}
              />
            ))}
          </ScrollRow>
        </section>

        <div className="border-t pt-2 text-xs" data-testid="progress-overall-full">
          <p className="font-bold">全体（{PROGRESS_SOURCE}）</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {OVERALL.map((t) => (
              <li key={t} className="break-words">{t}</li>
            ))}
          </ul>
        </div>
        <p className="border-t pt-2 text-xs text-slate-700" data-testid="portal-source">
          出典: 各コンペの公式要項（取得日 2026-11-09）、進捗は {PROGRESS_SOURCE}（{asOf} 時点）、アプリとコンペの関連は {FIT_SOURCE}（{FIT_AS_OF}）。
        </p>
      </div>
    </MotionConfig>
  )
}
