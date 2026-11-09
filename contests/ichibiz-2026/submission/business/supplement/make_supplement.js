// ビジネス部門 補足資料(PPTX)生成スクリプト。pptxgenjs が必要。
// 実行例: NODE_PATH=<pptxgenjsを入れたnode_modules> node make_supplement.js supplement.pptx
const pptxgen = require("pptxgenjs");
const out = process.argv[2] || "supplement.pptx";
const p = new pptxgen();
p.layout = "LAYOUT_16x9"; // 10 x 5.625 in
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
s.addText("自治体の交通計画担当者向け\n路線・ダイヤ変更の影響を地区単位で比べる\nシナリオ比較サービス", { x: 0.6, y: 1.0, w: 8.8, h: 2.4, fontFace: F, fontSize: 28, bold: true, color: "FFFFFF", valign: "middle" });
s.addText("イチBizアワード2026 ビジネス部門 補足資料", { x: 0.6, y: 3.6, w: 8.8, h: 0.5, fontFace: F, fontSize: 16, color: "CFE3E3" });
s.addText("【本人加筆: 応募者名（ニックネーム可）】", { x: 0.6, y: 4.3, w: 8.8, h: 0.5, fontFace: F, fontSize: 14, color: "F6D99B" });

// 2 課題
s = base("課題：「この便を減らすと誰が困るのか」が見えない", 2);
s.addText([
  { text: "路線・ダイヤの見直しを迫られる自治体が増えている", options: { bullet: true, breakLine: true } },
  { text: "判断材料は乗降数や寄せられた意見など断片的", options: { bullet: true, breakLine: true } },
  { text: "案を複数並べて比べること自体が難しい", options: { bullet: true, breakLine: true } },
  { text: "議論が声の大きさに左右されるおそれ", options: { bullet: true } },
], { x: 0.5, y: 1.2, w: 5.2, h: 3.3, fontFace: F, fontSize: 17, color: "222222", valign: "top", paraSpaceAfter: 10 });
s.addShape(p.ShapeType.roundRect, { x: 6.0, y: 1.3, w: 3.5, h: 2.8, fill: { color: LIGHT }, line: { color: ACC, width: 1.5 }, rectRadius: 0.1 });
s.addText("対象\n自治体の交通担当者\n協議会の委員", { x: 6.1, y: 1.4, w: 3.3, h: 1.2, fontFace: F, fontSize: 15, bold: true, color: NAVY, align: "center", valign: "middle" });
s.addText("【本人加筆: 担当者・住民の声や具体例】", { x: 6.1, y: 2.7, w: 3.3, h: 1.2, fontFace: F, fontSize: 12, color: WARN, align: "center", valign: "middle" });

// 3 流れ
s = base("サービス：4ステップで変更案を比べる", 3);
const steps = [["①取り込む", "公開GTFSを読み込み\n路線・便を地図に再現"], ["②案を作る", "廃止・減便・移設・\n乗継変更を選んで保存"], ["③比べる", "将来人口と施設を重ね\n案ごとに同じ尺度で比較"], ["④出力する", "協議会・説明会向けの\n比較表と地図"]];
steps.forEach((st, i) => {
  const x = 0.4 + i * 2.35;
  s.addShape(p.ShapeType.roundRect, { x, y: 1.5, w: 2.1, h: 2.6, fill: { color: LIGHT }, line: { color: ACC, width: 1.5 }, rectRadius: 0.1 });
  s.addText(st[0], { x, y: 1.6, w: 2.1, h: 0.6, fontFace: F, fontSize: 17, bold: true, color: NAVY, align: "center" });
  s.addText(st[1], { x: x + 0.1, y: 2.3, w: 1.9, h: 1.6, fontFace: F, fontSize: 12, color: "222222", align: "center", valign: "top" });
  if (i < 3) s.addText("▶", { x: x + 2.1, y: 2.6, w: 0.25, h: 0.4, fontFace: F, fontSize: 12, color: ACC, align: "center" });
});
s.addText("結論は自動で決めず、判断の材料を揃える。個人情報は扱わない。", { x: 0.5, y: 4.4, w: 9, h: 0.5, fontFace: F, fontSize: 15, color: GRAY, align: "center" });

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
s.addText("案ごとに「到達できる人口」「行きにくくなる地区」「乗継待ち時間」を並べる。数値の前提（時間の閾値・徒歩速度）も併記する。", { x: 0.5, y: 3.7, w: 9, h: 0.9, fontFace: F, fontSize: 14, color: GRAY });
note(s, "※地区名・結果は説明用の架空の例。実際の画面は住民向けアプリの診断を基に作成予定。");

// 5 住民向けとの関係
s = base("住民向け無償アプリと、担当者向け事業の分担", 5);
s.addShape(p.ShapeType.roundRect, { x: 0.4, y: 1.3, w: 4.4, h: 2.9, fill: { color: LIGHT }, line: { color: ACC, width: 1.5 }, rectRadius: 0.1 });
s.addText("住民向け（無償）\n「生活アクセス診断マップ」", { x: 0.5, y: 1.4, w: 4.2, h: 0.9, fontFace: F, fontSize: 15, bold: true, color: NAVY, align: "center" });
s.addText("地区ごとに病院・買い物・学校への到達性を診断\n同じGTFSと同じ計算を使う\n開発中（公開状況は下の欄に提出時の事実を記入）",{ x: 0.5, y: 2.3, w: 4.2, h: 1.8, fontFace: F, fontSize: 13, color: "222222", valign: "top" });
s.addShape(p.ShapeType.roundRect, { x: 5.2, y: 1.3, w: 4.4, h: 2.9, fill: { color: "FFF6E5" }, line: { color: WARN, width: 1.5 }, rectRadius: 0.1 });
s.addText("担当者向け（事業）\nシナリオ比較サービス", { x: 5.3, y: 1.4, w: 4.2, h: 0.9, fontFace: F, fontSize: 15, bold: true, color: NAVY, align: "center" });
s.addText("路線・ダイヤの変更案を作って比較\n説明資料を出力\n年額ライセンス＋導入・整備支援", { x: 5.3, y: 2.3, w: 4.2, h: 1.8, fontFace: F, fontSize: 13, color: "222222", valign: "top" });
s.addText("同じ計算基盤を共有", { x: 3.2, y: 4.35, w: 3.6, h: 0.4, fontFace: F, fontSize: 13, color: ACC, align: "center", bold: true });
note(s, "【本人加筆: 住民向けアプリの現在の開発状況と公開予定】");

// 6 顧客と収益
s = base("顧客と収益", 6);
s.addText([
  { text: "顧客", options: { bold: true, color: NAVY, breakLine: true } },
  { text: "市町村・都道府県の交通担当部署／計画策定を支援するコンサルタント", options: { bullet: true, breakLine: true } },
  { text: "収益", options: { bold: true, color: NAVY, breakLine: true } },
  { text: "自治体向け年額ライセンス", options: { bullet: true, breakLine: true } },
  { text: "計画策定時の比較作業の支援（導入・データ整備・説明資料づくり）", options: { bullet: true, breakLine: true } },
  { text: "住民向け診断マップは無償。導入地域で担当者向け機能と接続", options: { bullet: true } },
], { x: 0.6, y: 1.2, w: 8.8, h: 3.5, fontFace: F, fontSize: 16, color: "222222", valign: "top", paraSpaceAfter: 8 });
note(s, "※市場規模などの数値は、公的統計で確認できたものだけを載せる。【本人加筆: 聞き取れたニーズ】");

// 7 課題と次の一手
s = base("事業化に向けた課題と次の一手", 7);
const ch = [["データ", "GTFS未整備・更新停止の事業者への整備支援"], ["精度", "時刻表と直線距離の近似。比較の目安と明示"], ["調達", "無償アプリで実績→少額の試行導入から"], ["競合", "変更案の比較と説明資料に絞って差別化"], ["責任・体制", "意思決定は代替しない。保守の協力先を探す"]];
ch.forEach((c, i) => {
  const y = 1.15 + i * 0.62;
  s.addShape(p.ShapeType.rect, { x: 0.5, y, w: 1.8, h: 0.5, fill: { color: ACC } });
  s.addText(c[0], { x: 0.5, y, w: 1.8, h: 0.5, fontFace: F, fontSize: 14, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
  s.addText(c[1], { x: 2.45, y, w: 7.1, h: 0.5, fontFace: F, fontSize: 14, color: "222222", valign: "middle" });
});
s.addText("次の一手：【本人加筆: 体制・相談先・期限付きの次の行動】", { x: 0.5, y: 4.4, w: 9, h: 0.6, fontFace: F, fontSize: 15, bold: true, color: WARN, valign: "middle" });

p.writeFile({ fileName: out }).then((f) => console.log("wrote", f));
