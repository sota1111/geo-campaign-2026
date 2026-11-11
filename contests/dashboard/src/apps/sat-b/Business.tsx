import { Briefcase } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

// 内容は contests/satellite-2026/submission/proposal-B.md の「1. 提案の概要」「4. 事業の実現性・収益性」「5. 実用化による社会発展性」の記述に合わせる。
// 提案書にない金額・市場規模・効果は書かない。
const ROWS: [string, string][] = [
  ['誰が使うか', '盛土規制区域を指定した都道府県・指定都市・中核市の担当部局の盛土担当職員と、巡視を受託する事業者を想定しています。'],
  ['誰が何に対して払うか', '指定権者の担当部局が、巡視の優先順位（地図付きの優先巡視リスト）を業務成果物として受け取る対価を、監視面積に応じた年額で払う想定です。年額は仮説です。'],
  ['既存の方法との違い', '現状は職員の現地確認やパトロールが中心で、全域の変化を定期的に把握するには限界があると提案書は考えています。浜松市や静岡県など、衛星画像による監視を予算化・公募した例が先行しています。本提案の違いは三つです。巡視結果を正解データとして検出条件に戻すこと。崩落が疑われる盛土で、協賛企業カナン・ジオリサーチ社のGMS3による確認を試行すること。中核市などが県と共同で使える料金体系にすること。'],
  ['時期（想定）', '導入は無償の小規模実証から始め、年額契約は2028年度からを見込んでいます。'],
  ['この画面にあること・ないこと', 'この画面は、台帳から巡視先を決め、計画を書き出し、巡視結果を記録する部分を動かしています。衛星由来の変化量は未接続で、料金・契約・誤検知の低減効果は実装も測定もしていません。違反の判断は職員が現地で行います。'],
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
      </DialogContent>
    </Dialog>
  )
}
