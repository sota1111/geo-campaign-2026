// ビジネス部門 補足資料(PPTX)生成スクリプト。pptxgenjs が必要。
// 実行例: NODE_PATH=<pptxgenjsを入れたnode_modules> node make_supplement.js supplement.pptx
// 本文（../title.md, problem.md, service.md, market.md, challenges.md）と矛盾させないこと。
const pptxgen = require("pptxgenjs");
const out = process.argv[2] || "supplement.pptx";
const p = new pptxgen();
p.layout = "LAYOUT_16x9"; // 10 x 5.625 in
// ファイルのプロパティ。作成者は提出前に本人がPowerPointで本人名（ニックネーム可）に直す。
p.title = "この便を減らすと誰が困る？ バス路線の見直し案を地区ごとに比べる自治体向けサービス";
p.subject = "イチBizアワード2026 ビジネス部門 補足資料";
p.author = "応募者";
p.company = "";
const F = "Meiryo";
const NAVY = "1F3A5F", ACC = "2E8B8B", GRAY = "555555", LIGHT = "EAF2F2", WARN = "B45F06";

function base(title, n) {
  const s = p.addSlide();
  s.background = { color: "FFFFFF" };
  s.addShape(p.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.9, fill: { color: NAVY } });
  s.addText(title, { x: 0.4, y: 0.1, w: 9.2, h: 0.7, fontFace: F, fontSize: 22, bold: true, color: "FFFFFF", valign: "middle" });
  s.addText(String(n), { x: 9.2, y: 5.2, w: 0.6, h: 0.3, fontFace: F, fontSize: 10, color: GRAY, align: "right" });
  return s;
}
function note(s, t) {
  s.addText(t, { x: 0.4, y: 5.1, w: 8.6, h: 0.4, fontFace: F, fontSize: 10, color: WARN, valign: "middle" });
}

// 1 表紙
let s = p.addSlide();
s.background = { color: NAVY };
s.addText("この便を減らすと誰が困る？\nバス路線の見直し案を\n地区ごとに比べる自治体向けサービス", { x: 0.6, y: 1.0, w: 8.8, h: 2.4, fontFace: F, fontSize: 28, bold: true, color: "FFFFFF", valign: "middle" });
s.addText("イチBizアワード2026 ビジネス部門 補足資料", { x: 0.6, y: 3.6, w: 8.8, h: 0.5, fontFace: F, fontSize: 16, color: "CFE3E3" });
s.addText("【本人加筆: 応募者名（ニックネーム可）】", { x: 0.6, y: 4.3, w: 8.8, h: 0.5, fontFace: F, fontSize: 14, color: "F6D99B" });

// 2 課題
s = base("課題：「この便を減らすと誰が困るのか」が見えない", 2);
s.addText([
  { text: "見直しの判断材料は、乗降数や寄せられた意見など断片的", options: { bullet: true, breakLine: true } },
  { text: "担当者が少人数の自治体では、案を複数並べて比べること自体が難しい", options: { bullet: true, breakLine: true } },
  { text: "国土交通省も、データを使った現状診断による計画の見直し方をガイダンスで示している（地域公共交通計画の「アップデートガイダンス」令和7年3月）", options: { bullet: true } },
], { x: 0.5, y: 1.2, w: 5.2, h: 3.5, fontFace: F, fontSize: 15, color: "222222", valign: "top", paraSpaceAfter: 10 });
s.addShape(p.ShapeType.roundRect, { x: 6.0, y: 1.3, w: 3.5, h: 2.8, fill: { color: LIGHT }, line: { color: ACC, width: 1.5 }, rectRadius: 0.1 });
s.addText("対象\n自治体の交通担当者\n協議会の委員", { x: 6.1, y: 1.4, w: 3.3, h: 1.2, fontFace: F, fontSize: 15, bold: true, color: NAVY, align: "center", valign: "middle" });
s.addText("【本人加筆: 本人が見た・聞いた現場の1場面】", { x: 6.1, y: 2.7, w: 3.3, h: 1.2, fontFace: F, fontSize: 12, color: WARN, align: "center", valign: "middle" });

// 3 流れ
s = base("使い方：4段階で変更案を比べる", 3);
const steps = [["取り込む", "公開GTFSから\n停留所と便を\n地図に再現"], ["案を作る", "廃止・減便・移設・\n乗継の変更を選び\n案A・案Bを保存"], ["比べる", "時刻表と道路網で\n時間帯ごとの到達圏。\nいま＝国勢調査\n将来＝推計人口"], ["出す", "前提（時間の閾値・\n徒歩速度）付きの\n比較表と地図"]];
steps.forEach((st, i) => {
  const x = 0.4 + i * 2.35;
  s.addShape(p.ShapeType.roundRect, { x, y: 1.5, w: 2.1, h: 2.6, fill: { color: LIGHT }, line: { color: ACC, width: 1.5 }, rectRadius: 0.1 });
  s.addText(st[0], { x, y: 1.6, w: 2.1, h: 0.6, fontFace: F, fontSize: 17, bold: true, color: NAVY, align: "center" });
  s.addText(st[1], { x: x + 0.1, y: 2.3, w: 1.9, h: 1.7, fontFace: F, fontSize: 12, color: "222222", align: "center", valign: "top" });
  if (i < 3) s.addText("▶", { x: x + 2.1, y: 2.6, w: 0.25, h: 0.4, fontFace: F, fontSize: 12, color: ACC, align: "center" });
});
s.addText("減便の議論を「誰が、どこで困るか」という同じ材料から始められるようにする。", { x: 0.5, y: 4.4, w: 9, h: 0.5, fontFace: F, fontSize: 15, color: GRAY, align: "center" });

// 4 画面イメージ
s = base("比較のイメージ（架空の例。実データではありません）", 4);
const rows = [["地区", "現状", "案A（減便）", "案B（乗継改善）"], ["地区ア", "到達できる", "到達できる", "到達できる"], ["地区イ", "到達できる", "行きにくくなる", "到達できる"], ["地区ウ", "行きにくい", "行きにくい", "到達できる"]];
const colW = [1.6, 2.2, 2.4, 2.6];
const tbl = rows.map((r, ri) => r.map((c) => ({
  text: c,
  options: {
    fontFace: F, fontSize: 14, bold: ri === 0, align: "center", valign: "middle",
    color: ri === 0 ? "FFFFFF" : (c === "行きにくくなる" ? "B00020" : "222222"),
    fill: { color: ri === 0 ? ACC : (c.startsWith("行きにくい") ? "FBE3E3" : "FFFFFF") },
  },
})));
s.addTable(tbl, { x: 0.5, y: 1.3, colW, rowH: 0.55, border: { type: "solid", pt: 1, color: "BBBBBB" } });
s.addText("案ごとに「病院や商業施設へ行ける人口」「行きにくくなる地区」「乗継待ち時間」を並べる。数値の前提（時間の閾値・徒歩速度）も併記する。", { x: 0.5, y: 3.7, w: 9, h: 0.9, fontFace: F, fontSize: 14, color: GRAY });
note(s, "※地区名・結果は説明用の架空の例。担当者向けの比較画面は構想段階（住民向けプロトタイプとは別の画面）。");

// 5 既存の基盤との違い／住民向けとの関係
s = base("既存の基盤との違いと、住民向けプロトタイプとの関係", 5);
s.addShape(p.ShapeType.roundRect, { x: 0.4, y: 1.2, w: 4.4, h: 3.1, fill: { color: LIGHT }, line: { color: ACC, width: 1.5 }, rectRadius: 0.1 });
s.addText("既存の基盤との違い", { x: 0.5, y: 1.3, w: 4.2, h: 0.5, fontFace: F, fontSize: 15, bold: true, color: NAVY, align: "center" });
s.addText("海外には到達性のシナリオ分析や路線計画の商用基盤がある（例：Conveyal、Via社のRemix）\n本サービスは日本の公開データ（GTFS、人口、国土数値情報の施設）を最初から組み込む\n担当者1人で協議会資料を作り終えるまでの作業に絞る", { x: 0.5, y: 1.85, w: 4.2, h: 2.4, fontFace: F, fontSize: 12, color: "222222", valign: "top", paraSpaceAfter: 6 });
s.addShape(p.ShapeType.roundRect, { x: 5.2, y: 1.2, w: 4.4, h: 3.1, fill: { color: "FFF6E5" }, line: { color: WARN, width: 1.5 }, rectRadius: 0.1 });
s.addText("住民向けプロトタイプとの関係", { x: 5.3, y: 1.3, w: 4.2, h: 0.5, fontFace: F, fontSize: 15, bold: true, color: NAVY, align: "center" });
s.addText("同じデータと計算で、病院・小中学校へ公共交通で行けるかを地区ごとに示す住民向けプロトタイプを実装済み（無償）\n事業は担当者向けの案の比較・資料出力に絞る", { x: 5.3, y: 1.85, w: 4.2, h: 2.4, fontFace: F, fontSize: 12, color: "222222", valign: "top", paraSpaceAfter: 6 });
note(s, "住民向けプロトタイプの公開URL：【提出時に記入。未公開なら「公開準備中」】");

// 6 顧客と収益
s = base("顧客と収益", 6);
s.addText([
  { text: "顧客", options: { bold: true, color: NAVY, breakLine: true } },
  { text: "地域公共交通計画を担う市町村・都道府県の交通担当部署（全国の市町村は1,718。総務省）", options: { bullet: true, breakLine: true } },
  { text: "国土交通省の計画づくりの手引きは、公共交通の専任担当者が1名または不在の自治体も念頭に置く。少人数で見直す自治体を最初の顧客層に", options: { bullet: true, breakLine: true } },
  { text: "計画策定の受託コンサルタントは利用者。最初の候補：【本人加筆】", options: { bullet: true, breakLine: true } },
  { text: "収益", options: { bold: true, color: NAVY, breakLine: true } },
  { text: "自治体向け年額ライセンス＋初回のデータ取り込み・資料づくりの支援。住民向けの診断は無償", options: { bullet: true, breakLine: true } },
  { text: "価格の仮説：【本人加筆: 金額の幅と根拠。未定なら誰にいつ聞いて決めるか】", options: { bullet: true } },
], { x: 0.6, y: 1.1, w: 8.8, h: 3.8, fontFace: F, fontSize: 14, color: "222222", valign: "top", paraSpaceAfter: 6 });
note(s, "出典：総務省「市町村合併」、国土交通省「地域公共交通計画等・共同経営計画の作成の手引き」（2026-11-09確認）【本人加筆: 聞き取れたニーズ】");

// 7 課題と次の一手
s = base("事業化に向けた課題と次の一手", 7);
const ch = [["データ", "GTFS未整備・更新停止の事業者への整備支援"], ["精度", "時刻表と道路網の徒歩計算。坂や遅延は目安と明示し現地で確認"], ["調達", "少額の試行導入から始める"], ["競合", "国内データの初期設定と協議会資料の出力で差。比較表を提案前に作る"], ["責任・体制", "意思決定は代替しない。保守の協力先を探す"]];
ch.forEach((c, i) => {
  const y = 1.15 + i * 0.62;
  s.addShape(p.ShapeType.rect, { x: 0.5, y, w: 1.8, h: 0.5, fill: { color: ACC } });
  s.addText(c[0], { x: 0.5, y, w: 1.8, h: 0.5, fontFace: F, fontSize: 14, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
  s.addText(c[1], { x: 2.45, y, w: 7.1, h: 0.5, fontFace: F, fontSize: 13, color: "222222", valign: "middle" });
});
s.addText("次の一手：【本人加筆: 体制・相談先・期限付きの次の行動】", { x: 0.5, y: 4.4, w: 9, h: 0.6, fontFace: F, fontSize: 15, bold: true, color: WARN, valign: "middle" });

p.writeFile({ fileName: out }).then((f) => console.log("wrote", f));
