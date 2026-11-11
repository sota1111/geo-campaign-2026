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
  ['この画面にあること・ないこと', 'この画面は、調べる順番を決めて結果を次の点数に戻す流れだけを、架空データで動かしています。料金の計算・契約・費用対効果は実装しておらず、画面の数字は実際の精度や費用を示しません。単価や市場規模は提案書でも仮置きで、実証で確かめる段階です。'],
]

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
      </DialogContent>
    </Dialog>
  )
}
