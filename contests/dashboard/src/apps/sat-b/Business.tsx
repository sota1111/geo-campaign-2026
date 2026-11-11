import { Briefcase } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

// 内容は contests/satellite-2026/submission/proposal-B.md の「1. 提案の概要」「4. 事業の実現性・収益性」「5. 実用化による社会発展性」の記述に合わせる。
// 提案書にない金額・市場規模・効果は書かない。
const ROWS: [string, string][] = [
  ['誰が使うか', '盛土規制区域を指定した都道府県・指定都市・中核市の担当部局の盛土担当職員と、巡視を受託する事業者を想定しています。'],
  ['誰が何に対して払うか', '指定権者の担当部局が、巡視の優先順位（地図付きの優先巡視リスト）を業務成果物として受け取る対価を、監視面積に応じた年額で払う想定です。年額は仮説です（目安の数字は下の「提案書にある数字」）。'],
  ['既存の方法との違い', '現状は職員の現地確認やパトロールが中心で、全域の変化を定期的に把握するには限界があると提案書は考えています。浜松市や静岡県など、衛星画像による監視を予算化・公募した例が先行しています。本提案の違いは三つです。巡視結果を正解データとして検出条件に戻すこと。崩落が疑われる盛土で、協賛企業カナン・ジオリサーチ社のGMS3による確認を試行すること。中核市などが県と共同で使える料金体系にすること。'],
  ['時期（想定）', '導入は無償の小規模実証から始め、年額契約は2028年度からを見込んでいます。'],
  ['この画面にあること・ないこと', 'この画面は、台帳から巡視先を決め、計画を書き出し、巡視結果を記録する部分を動かしています。実データ版では衛星由来の変化量は未接続で、手順3は架空の12地点での体験です。料金・契約・誤検知の低減効果は実装も測定もしていません。違反の判断は職員が現地で行います。'],
]

// 数字はすべて提案書Bの記述と sources.md の値に限る（提案書にない数字は作らない）。いずれも仮説・概算で、実績ではない。
const NUMBERS: { item: string; value: string; basis: string; where: string; url?: string }[] = [
  {
    item: '契約候補の団体数', value: '129団体（都道府県47＋指定都市20＋中核市62）',
    basis: '規制区域の指定は令和8年4月1日現在、都道府県46/47、指定都市20/20、中核市61/62。',
    where: '提案書B §2・§4／出典一覧「規制区域の指定」', url: 'https://www.mlit.go.jp/toshi/content/002017117.pdf',
  },
  {
    item: '1団体の年額の目安（仮説）', value: '9,603千円（国1/2）',
    basis: '浜松市の令和7年度予算「（新規）衛星画像による監視」。予算額であり契約額ではありません。この額を1団体の目安に置くのは提案書の仮説です。',
    where: '提案書B §4／出典一覧「浜松市 令和7年度予算」', url: 'https://www.city.hamamatsu.shizuoka.jp/zaisek/budget/budget07/detail/d_134.html',
  },
  {
    item: '市場規模の見立て（仮説）', value: '年約12億円',
    basis: '129団体 × 9,603千円 ＝ 約12.4億円の算術。1団体の年額を政令市の予算額で代表させた仮説で、実証前です。',
    where: '提案書B §4「年約12億円の規模（年額は仮説）」／出典一覧「市場規模 年約12億円」',
  },
  {
    item: '契機となった被害', value: '死者28名（災害関連死1名を含む）',
    basis: '2021年7月の熱海市の土石流。令和5年2月10日時点の消防庁報告。需要の背景であり、本サービスの効果を示す数字ではありません。',
    where: '提案書B §2／出典一覧「熱海の盛土崩落」', url: 'https://www.pref.shizuoka.jp/_res/projects/default_project/_page_/001/035/911/atamisokatsu0703.pdf',
  },
  {
    item: '既存盛土の見落とし', value: '総点検 約3.6万か所のうち、措置の実施が確認できない盛土 約500か所',
    basis: '熱海の災害後に都道府県が行った盛土総点検の結果（総務省の調査）。経過観察の抜けを減らす需要の根拠として提案書が挙げています。',
    where: '提案書B §5／出典一覧「盛土総点検」', url: 'https://www.soumu.go.jp/menu_news/s-news/hyouka_260422000189350.html',
  },
]

function NumberTable() {
  return (
    <section className="space-y-2" data-testid="biz-numbers">
      <h3 className="text-sm font-bold">提案書にある数字（すべて仮説・概算。実績ではありません）</h3>
      <p className="text-xs text-muted-foreground">提案書Bと出典一覧（sources.md）にある値だけを載せています。この画面の計算結果ではなく、誤検知の低減や発見率の効果の数字は提案書にもありません。</p>
      <ul className="space-y-2">
        {NUMBERS.map((n) => (
          <li key={n.item} className="rounded-md border border-dashed p-2.5 text-xs">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="font-medium">{n.item}</span>
              <span className="text-sm font-bold">{n.value}</span>
            </div>
            <p className="mt-1">{n.basis}</p>
            <p className="mt-0.5 text-muted-foreground">出典: {n.where}</p>
            {n.url && <a className="break-all text-primary underline" href={n.url} target="_blank" rel="noreferrer">{n.url}</a>}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function BusinessDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Briefcase className="size-4" />事業モデル（想定）</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>事業モデル（想定）</DialogTitle>
          <DialogDescription>構想の段階です。実証前の想定で、確定した契約や実績ではありません。出典: 提案書B（衛星データ活用アワード）。</DialogDescription>
        </DialogHeader>
        <dl className="space-y-3 text-sm">
          {ROWS.map(([k, v]) => (
            <div key={k} className="rounded-md border p-3">
              <dt className="font-medium">{k}</dt>
              <dd className="mt-1">{v}</dd>
            </div>
          ))}
        </dl>
        <NumberTable />
      </DialogContent>
    </Dialog>
  )
}
