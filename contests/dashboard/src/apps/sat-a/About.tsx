import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { SourceItem } from '@/components/shared/SourceDialog'

export const SOURCES: SourceItem[] = [
  { name: '道路網・区画（サンプル市）', note: '乱数で作った架空の格子状の街。座標は便宜上の位置で、実在の地点ではありません。', license: '架空データ（元アプリ proposal-a/data/sample.json）' },
  { name: '衛星由来の指標', note: '区画ごとの地表変位（mm/年）を人が決めた式と乱数で作ったサンプル値。実際のSentinel-1の解析結果ではありません。' },
  { name: '下水道台帳の属性（布設年）', note: '乱数で与えたもの。実在の台帳ではありません。' },
  { name: '地中レーダの結果', note: '乱数によるシミュレーション。実際の走査結果ではなく、特定企業の製品画面・データでもありません。' },
  { name: 'ライブラリ', note: 'MapLibre GL JS（BSD-3-Clause）、React、shadcn/ui（MIT）。背景地図は使っていません（架空の街のため）。' },
]

/** 画面下部に常時出す「出典・データの扱い・限界」 */
export function About() {
  return (
    <Card id="about">
      <CardHeader><CardTitle className="text-base">出典・データの扱い・限界</CardTitle></CardHeader>
      <CardContent className="grid gap-4 text-sm md:grid-cols-3">
        <section className="space-y-1">
          <h3 className="font-medium">データ（すべてサンプル・架空）</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {SOURCES.slice(0, 4).map((s) => (
              <li key={s.name}><b className="text-foreground">{s.name}</b>：{s.note}</li>
            ))}
          </ul>
        </section>
        <section className="space-y-1">
          <h3 className="font-medium">点数・較正の計算</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>点数 ＝ 衛星の重み × 区画の沈下指標（−8mm/年以下で1）＋ 台帳の重み × 管の古さ（60年で1）。上限値はデモ上の便宜的な正規化です。</li>
            <li>較正: これまでの調査結果に対し、重み（0〜100%）ごとの当たりやすさ（AUC）を比べて最大の重みを採用します。空洞あり／なしが各3件未満なら較正しません。</li>
          </ul>
        </section>
        <section className="space-y-1">
          <h3 className="font-medium">限界</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>画面の数字は架空データ上の計算で、実際の精度・効果・費用を示しません。</li>
            <li>衛星は空洞を直接検出しません。生活道路の幅に対する衛星画素の粗さなど、実データで確かめるべき課題は未検証です。</li>
            <li>過去の調査結果は幹線に偏る設定で、較正の母集団の偏りは扱っていません。</li>
            <li>衛星の解析（InSAR処理）とレーダ解析は実装していません。</li>
          </ul>
        </section>
      </CardContent>
    </Card>
  )
}
