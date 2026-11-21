import { CAT, SHAPE_CLASS, READINESS_MARK, shortName, styleOf, type GNode, type LaneGroup } from '@/lib/ontology'

/** 応募ごとのレーン（既定の表示）。コンペ → 応募（状態を文字で）→ 止めているもの。普通の HTML なので、実寸（12px）のまま読め、Tab 順は上から下 */
/** 提出可否の根拠（next-actions の内訳）を文字で。0 の項目は省く */
export function reasonText(c: Record<string, number>): string {
  const items: [string, string][] = [['失格級', '失格級'], ['要修正', '要修正'], ['未記入欄ファイル', '未記入欄（ファイル）'], ['データ条件', '未確認のデータ条件'], ['提出文なし', '提出文なし'], ['選定待ち', '案の選定待ち']]
  const t = items.filter(([k]) => (c[k] ?? 0) > 0).map(([k, l]) => `${l} ${c[k]}`)
  return t.length ? t.join('・') : '記録なし'
}

export function Lanes({ groups, selected, highlight, impactOn, appName, onSelect }: {
  groups: LaneGroup[]
  selected: string | null
  highlight: Set<string>
  impactOn: boolean
  appName: (appId: string, fallback: string) => string
  onSelect: (id: string) => void
}) {
  if (!groups.length) return <p className="p-3 text-sm">この絞り込みに合う応募はありません。</p>
  const node = (id: string, n: GNode | undefined, extra: string, children: React.ReactNode, label: string) => {
    const st = styleOf(n?.type ?? '')
    const dim = impactOn && !highlight.has(id) && selected !== id
    return (
      <button
        type="button"
        onClick={() => onSelect(id)}
        aria-pressed={selected === id}
        aria-label={label}
        data-node-id={id}
        data-node-type={n?.type}
        className={`block w-full min-w-0 overflow-hidden px-2 py-1 text-left leading-tight focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${CAT[st.cat].box} ${SHAPE_CLASS[st.shape]} ${selected === id ? 'ring-4 ring-slate-900 ring-offset-2' : ''} ${impactOn && highlight.has(id) ? 'outline-4 outline-offset-2 outline-fuchsia-800' : ''} ${dim ? 'opacity-40' : ''} ${extra}`}
      >
        {children}
      </button>
    )
  }
  return (
    <ol className="space-y-3 p-2" data-testid="lanes">
      {groups.map((g) => (
        <li key={g.contest.id} data-testid="lane-group">
          <section aria-label={g.contest.label} className="grid gap-2 border-l-4 border-indigo-800 pl-2 md:grid-cols-[8.5rem_minmax(0,1fr)]">
            <div className="md:self-start">
              {node(g.contest.id, g.contest, 'min-h-14', (
                <>
                  <span className="flex items-center gap-1 text-[11px] font-bold"><span aria-hidden>◆</span>コンペ</span>
                  <span className="block text-xs font-semibold">{g.contest.label}</span>
                </>
              ), `コンペ: ${g.contest.label}`)}
            </div>
            <ul className="min-w-0 space-y-2">
              {g.lanes.map((l) => {
                const a = l.action
                const mark = READINESS_MARK[a.readiness] ?? a.readiness
                const sub = l.sub
                return (
                  <li key={sub.id} className="flex min-w-0 flex-col gap-1 md:flex-row md:items-stretch md:gap-1" data-testid="lane">
                    <div className="md:w-56 md:shrink-0">
                      {node(sub.id, sub, '', (
                        <>
                          <span className="flex items-center gap-1 text-[11px] font-bold"><span aria-hidden>▣</span>応募　<span className="text-xs">{mark}</span>{impactOn && highlight.has(sub.id) && <span className="ml-auto rounded bg-fuchsia-800 px-1 text-white">影響</span>}</span>
                          <span className="block text-xs font-semibold" data-testid="lane-app">{appName(a.app, sub.label)}</span>
                          <span className="block text-[11px]">失格級 {a.counts['失格級']}・要修正 {a.counts['要修正']}　{a.deadline.at ? `締切 ${a.deadline.at.slice(5, 10).replace('-', '/')}` : ''}</span>
                          {a.nextStage?.humanGate && <span className="block text-[11px] font-bold">次: ★ 総司令官の判断（{a.nextStage.stage}）</span>}
                        </>
                      ), `応募: ${appName(a.app, sub.label)}（${mark}）`)}
                    </div>
                    <span aria-hidden className="hidden items-center px-0.5 md:flex">▶</span>
                    <ul className="ml-4 flex min-w-0 flex-col gap-1 border-l-2 border-slate-400 pl-2 md:ml-0 md:flex-1 md:flex-row md:flex-wrap md:border-l-0 md:pl-0" aria-label="止めているもの">
                      {l.blockers.map((b) => {
                        const st = styleOf(b.type)
                        return (
                          <li key={b.id} className="md:w-44">
                            {node(b.id, b, 'h-full', (
                              <>
                                <span className="flex items-center gap-1 text-[11px] font-bold"><span aria-hidden>{st.symbol}</span>{b.type === 'Finding' ? `指摘・${b.status ?? ''}` : st.label}</span>
                                <span className="line-clamp-3 text-xs font-semibold" data-testid="lane-blocker-name">{shortName(b.label)}</span>
                              </>
                            ), `${st.label}: ${b.label}${b.status ? `（${b.status}）` : ''}`)}
                          </li>
                        )
                      })}
                      {l.more > 0 && (
                        <li className="md:w-24">
                          <button type="button" onClick={() => onSelect(sub.id)} className="min-h-10 w-full rounded-md border-2 border-dashed border-slate-700 bg-white px-2 text-xs font-bold text-slate-900 hover:bg-slate-100 focus-visible:outline-4 focus-visible:outline-blue-700" data-testid="lane-more">
                            ほか {l.more} 件
                          </button>
                        </li>
                      )}
                      {l.total === 0 && (
                        <li className="self-center text-xs text-slate-800" data-testid="lane-empty">
                          図に出ている種類には、止めているものはありません。判定の根拠: {reasonText(a.counts)}（全件はカード）
                        </li>
                      )}
                    </ul>
                  </li>
                )
              })}
            </ul>
          </section>
        </li>
      ))}
    </ol>
  )
}
