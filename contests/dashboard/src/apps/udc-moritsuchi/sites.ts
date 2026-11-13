/* 事前生成した比較画像（img/）の位置。ox, oy は 512×512 画像の左上の世界画素座標（Web Mercator z17、北が上）。
   scripts/build-imgproc-assets.py で生成。画像は地理院タイルの切出し・CLAHE 補正・JPEG 化（加工）。個別撮影年は未確認 */
export const SITE_VIEW: Record<string, { key: string; ox: number; oy: number }> = {"熱海市0001":{"key":"atami","ox":29738752,"oy":13278464},"伊東市0003":{"key":"ito","ox":29744128,"oy":13296640},"伊東市0004":{"key":"ito","ox":29744128,"oy":13296640}}
