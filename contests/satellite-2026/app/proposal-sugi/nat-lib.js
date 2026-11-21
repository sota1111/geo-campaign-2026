// 全国版（市町村単位）の計算ロジック（画面に依存しない）。ブラウザでは window.NatLib、node では module.exports。
// 配分ルールは「利用者が切り替えて比べる」ためのもの。どれが適正・最適かは示さない。半径や重みは仮置き（画面と README に明記）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NatLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const KM_DEG = 111.32;

  // 仮置きの値（根拠のある数値ではない。国の目安は「都市から50km圏」だけ）
  const DEFAULTS = { radiusKm: 50, age: 26, mixAlpha: 50, minHa: 10, budgetMan: 10000 };
  const RADII = [20, 30, 50, 75, 100];

  // 配分ルール。w(c) が各候補の重み。配分額 = 予算 × 重み / 重みの合計。
  const RULES = [
    { id: 'in', name: 'A 圏内の面積比', short: 'A 圏内面積', desc: '半径内にある26年生以上のスギ人工林の面積に比例（その市町村の森のうち都市に届きうる部分）' },
    { id: 'near', name: 'B 近さ重み付き面積比', short: 'B 近さ重み', desc: '圏内の面積に、近いほど重い重み（1−距離÷半径）を掛けて比例。重みの形は仮置き' },
    { id: 'all', name: 'C 市町村全体の面積比', short: 'C 全体面積', desc: '候補の市町村全体の26年生以上のスギ人工林の面積に比例（圏内外を問わない）' },
    { id: 'cur', name: 'D 現行の譲与税の比率', short: 'D 現行比率', desc: '令和6年度の森林環境譲与額（私有林人工林50%・林業就業者20%・人口30%の基準で国が決めた実額）に比例' },
    { id: 'mix', name: 'E AとDの混合', short: 'E 混合', desc: '配分比率を、A（圏内面積）とD（現行比率）の割合で混ぜる。割合は利用者が決める' },
  ];

  function b64u16(s) {
    const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
    const a = new Uint16Array(bin.length / 2);
    for (let i = 0; i < a.length; i++) a[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    return a;
  }

  // 1kmの格子（スギ人工林があるものだけ）を配列にほどく。ha は 20m メッシュの数 × 0.04。
  function decodeCells(nat) {
    const c = nat.cells, h = nat.meta.cell_ha;
    const u = b64u16(c.u), gy = b64u16(c.gy), gx = b64u16(c.gx), n26 = b64u16(c.n26), n21 = b64u16(c.n21);
    const n = u.length;
    const lat = new Float32Array(n), lon = new Float32Array(n), ha26 = new Float32Array(n), ha21 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      lat[i] = (gy[i] + 0.5) / 120; lon[i] = (gx[i] + 0.5) / 80;
      ha26[i] = n26[i] * h; ha21[i] = n21[i] * h;
    }
    return { n, u, lat, lon, ha26, ha21 };
  }

  function distKm(lat0, lon0, lat, lon) {
    const dy = (lat - lat0) * KM_DEG, dx = (lon - lon0) * KM_DEG * Math.cos(((lat + lat0) / 2) * Math.PI / 180);
    return Math.sqrt(dx * dx + dy * dy);
  }

  // 都市（lat0, lon0）から半径 R km 以内の格子を、市町村ごとに集める。
  // inHa = 圏内のスギ人工林（age 年生以上）の面積、near = 距離の重み（1−d/R）を掛けた面積。
  function reach(cells, nUnits, lat0, lon0, R, age) {
    const inHa = new Float64Array(nUnits), near = new Float64Array(nUnits);
    const ha = age === 21 ? cells.ha21 : cells.ha26;
    for (let i = 0; i < cells.n; i++) {
      if (ha[i] <= 0) continue;
      if (Math.abs(cells.lat[i] - lat0) * KM_DEG > R) continue;
      const d = distKm(lat0, lon0, cells.lat[i], cells.lon[i]);
      if (d > R) continue;
      inHa[cells.u[i]] += ha[i];
      near[cells.u[i]] += ha[i] * (1 - d / R);
    }
    return { inHa, near };
  }

  // 候補 = 圏内の面積が minHa 以上の市町村（都市自身を除く）
  function candidates(reachRes, city, minHa) {
    const out = [];
    for (let j = 0; j < reachRes.inHa.length; j++) {
      if (j !== city && reachRes.inHa[j] >= minHa) out.push(j);
    }
    return out;
  }

  function normalize(w) {
    let s = 0;
    for (const x of w) s += x;
    return s > 0 ? w.map((x) => x / s) : w.map(() => 0);
  }

  // 全ルールの配分比率を返す。{in:[...], near:[...], all:[...], cur:[...], mix:[...]}（cand の並びと同じ）
  function shares(U, cand, rr, age, mixAlpha) {
    const hA = age === 21 ? U.ha21 : U.ha26;
    const sIn = normalize(cand.map((j) => rr.inHa[j]));
    const sNear = normalize(cand.map((j) => rr.near[j]));
    const sAll = normalize(cand.map((j) => hA[j]));
    const sCur = normalize(cand.map((j) => Math.max(U.jouyo[j], 0)));
    const a = mixAlpha / 100;
    const sMix = sIn.map((x, i) => a * x + (1 - a) * sCur[i]);
    return { in: sIn, near: sNear, all: sAll, cur: sCur, mix: sMix };
  }

  // 比べ方の要約: 上位3の割合、1%以上を受け取る市町村の数、現行比率（D）との差の合計の半分（入れ替わる割合）
  function summarize(sh) {
    const out = {};
    for (const r of RULES) {
      const s = sh[r.id].slice().sort((a, b) => b - a);
      out[r.id] = { top3: (s[0] || 0) + (s[1] || 0) + (s[2] || 0), n1: s.filter((x) => x >= 0.01).length };
    }
    const cur = sh.cur;
    for (const r of RULES) {
      let d = 0;
      for (let i = 0; i < cur.length; i++) d += Math.abs(sh[r.id][i] - cur[i]);
      out[r.id].shift = d / 2; // 現行比率から動く割合（0〜1）
    }
    return out;
  }

  // 衛星（ESA WorldCover）の樹木被覆の面積と、森林簿のスギ人工林面積の比（参考）。地上の森林簿と衛星の大きさが合うかを見る。
  function satRatio(U, j) {
    if (!U.tree || U.tree[j] <= 0) return null;
    return U.ha[j] / U.tree[j];
  }

  const fmtMan = (man) => (man >= 10000 ? (Math.round(man / 100) / 100).toLocaleString('ja-JP') + '億円' : Math.round(man).toLocaleString('ja-JP') + '万円');

  return { KM_DEG, DEFAULTS, RADII, RULES, decodeCells, distKm, reach, candidates, shares, summarize, satRatio, fmtMan, normalize };
});
