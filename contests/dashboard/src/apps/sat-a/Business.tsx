import { Briefcase } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

// 内容は contests/satellite-2026/submission/proposal-A.md の「1. 提案の概要」「4. 事業の実現性・収益性」「5. 実用化による社会発展性」の記述に合わせる。
// 提案書にない金額・市場規模・効果は書かない。
const ROWS: [string, string][] = [
  ['誰が使うか', '自治体の下水道・道路部局。とくに、幹線以外まで調査の手が回りにくい市町の部局を想定しています。'],
  ['誰が何に対して払うか', '自治体が、カナン・ジオリサーチ社の路面下空洞調査に「衛星による投入先の選定」を組み込んだ調査パッケージに対して払う想定です。提案者の収益は、選定料と、同社が受注する地上調査からの分配です。'],
  ['既存の方法との違い', '路面下空洞調査は、例えば仙台市では緊急輸送道路や幹線道路が中心で、生活道路やその下の中小口径管には手が回りにくいと提案書は考えています。本提案は、衛星で調べる順番を決め、地中レーダで確かめる二段階です。NTTは衛星による地中レーダの代替を掲げていますが（2025年11月）、本提案は衛星を代替ではなく入口に使います。'],
  ['時期（想定）', '一次通過後にGMS3の提供エリアで衛星指標と地上の確認結果を比べ、自治体での実証を経て、カナン社との合意を前提に2028年度から有償で提供する想定です。'],
  ['この画面にあること・ないこと', 'この画面は、調べる順番を決めて結果を次の点数に戻す流れだけを、架空データで動かしています。料金の計算・契約・費用対効果は実装しておらず、画面の数字は実際の精度や費用を示しません。単価や市場規模の数字は下の「提案書にある数字」のとおり提案書でも仮説・概算で、実証で確かめる段階です。'],
]

// 数字はすべて提案書Aの記述と sources.md の値に限る（提案書にない数字は作らない）。いずれも仮説・概算で、実績ではない。
const NUMBERS: { item: string; value: string; basis: string; where: string; url?: string }[] = [
  {
    item: '地上調査の単価（仮説）', value: '1kmあたり約19万〜38万円',
    basis: '仙台市（約19.1万円/km）・札幌市（約24.3万円/km）・神戸市（路線長で約38.3万円/km）の公開入札結果。二次調査等を含む契約額÷延長の概算で、1次調査だけの単価ではありません。延長の定義は市により異なりえます。',
    where: '提案書A §4／出典一覧「地上の路面下空洞調査の単価」', url: 'https://www.city.kobe.lg.jp/a59714/20260622romenshita.html',
  },
  {
    item: '市場規模の見立て（桁の目安）', value: '一巡で約950億〜1,900億円',
    basis: '仮に管きょ延長約50万kmを調査延長とみなした算術（50万km × 19万〜38万円/km）。管きょと道路は一致せず、桁の目安です。全数はできないという差が市場の母数、と提案書は置いています。',
    where: '提案書A §4／出典一覧「下水道管きょ約50万kmの上を…」',
  },
  {
    item: '規模の式（数値は未確定）', value: '選定延長×選定単価＋新規の地上調査延長×上記単価',
    basis: '選定単価と新規の調査延長は仮説で、提案書にも数値はありません。実証で確かめます。',
    where: '提案書A §4／出典一覧「市場規模の式」',
  },
  {
    item: '需要の背景（陥没件数）', value: '令和4年度 2,625件（市町のみ 1,087件）',
    basis: '下水道管路に起因する道路陥没。1,087件は政令市と東京都区部を除く市町で、国総研の表からの計算です。効果を示す数字ではありません。',
    where: '提案書A §2・§5／出典一覧「下水道管路起因の道路陥没」', url: 'https://www.nilim.go.jp/lab/ebg/pdf/R4d_kanrienchou_kanbotsu.pdf',
  },
  {
    item: '需要の背景（管の老朽化）', value: '総延長約50万kmのうち、標準耐用年数50年超 約4万km（約7%）、10年後 約10万km',
    basis: '令和5年度末の全国の下水道管きょ。国総研の文言の％をそのまま引用しています。',
    where: '提案書A §2／出典一覧「令和5年度末で管きょ総延長…」', url: 'https://www.nilim.go.jp/lab/ebg/pdf/deterioration_rate_prediction_formula_2025.pdf',
  },
]

function NumberTable() {
  return (
    <section className="space-y-2" data-testid="biz-numbers">
      <h3 className="text-sm font-bold">提案書にある数字（すべて仮説・概算。実績ではありません）</h3>
      <p className="text-xs text-muted-foreground">提案書Aと出典一覧（sources.md）にある値だけを載せています。この画面の計算結果ではなく、衛星による絞り込みの効果の数字は提案書にもありません。</p>
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
          <DialogDescription>構想の段階です。実証前の想定で、確定した契約や実績ではありません。出典: 提案書A（衛星データ活用アワード）。</DialogDescription>
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
