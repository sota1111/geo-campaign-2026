/* 大規模修繕プラットフォーム: 画面の純ロジック（DOM・通信に触れない。node のテストからも使う）。
 * データ: data/buildings.json（tools/extract_plateau.py。PLATEAU の建物）、data/mlit-survey.json（国交省調査の転記）、data/demo.json（架空のデモ）。
 * 表現の方針: 「適正料金」を一点で断定しない。出すのは「目安の範囲」と「分布での位置」だけ。 */
(function (root) {
  'use strict';

  const TAX_RATE = 0.1; // 標準税率（国交省調査の金額は消費税を含まないので、税込の見積はここで割る）
  const DEFAULT_STOREY_H = 3.0; // 階高の仮定（m）。画面で変えられる。PLATEAU に階数が入っていないための仮置き

  const DISCLAIMER = '国交省調査の分布から計算した目安と位置です。適正な金額であることを保証しません（工事費は規模・劣化・仕様で大きく変わります）';
  const UNIT_SQM = 70; // 戸数の仮置き: 延床 ÷ 1戸あたり70㎡（仮定。根拠のある値ではない。画面で戸数を直せる）
  const SCALE_MAX = { floors: 40, tfa: 50000 }; // これを超える建物は、この画面の目安の対象外とする（設計上の線引き）
  const SCALE_SMALL_TFA = 800; // これ未満は、共同住宅でない可能性を警告する（設計上の線引き）
  const PER_UNIT_SQM = { min: 30, max: 150 }; // 1戸あたり延床がこの外なら、戸数と延床の食い違いとみなす（設計上の線引き）
  const LICENSE_NOTE = '国交省調査（令和3年度）の二次利用条件は要確認です。出典と加工（転記・計算）の旨を表示しています';
  const RESPONSIBILITY = '数値は作成者が公開資料から転記・計算したもので、国土交通省・各自治体が内容を保証したものではありません';

  const LINKS = [
    { id: 'etsuran', name: '建設業者・宅建業者等企業情報検索システム（国土交通省）', url: 'https://etsuran2.mlit.go.jp/TAKKEN/', note: '許可番号・業種・有効期限などを、会社名で個別に確認します。' },
    { id: 'nega', name: 'ネガティブ情報等検索サイト（国土交通省）', url: 'https://www.mlit.go.jp/nega-inf/', note: '行政処分の情報を、事業者名で個別に確認する入口です。この画面は処分情報を取り込んだり、会社を格付けしたりしません。' },
    { id: 'jftc', name: '公正取引委員会の公表（2026年9月28日）マンション大規模修繕工事の入札談合に対する排除措置命令・課徴金納付命令', url: 'https://www.jftc.go.jp/houdou/pressrelease/2026/sep/260928_daiyon.manshon.html', note: '公式発表ページへのリンクです（公表内容は発表ページで確認してください）。' },
    { id: 'survey', name: '令和3年度マンション大規模修繕工事に関する実態調査（国土交通省）報告書', url: 'https://www.mlit.go.jp/jutakukentiku/house/content/001619430.pdf', note: 'この画面の「目安」の元の統計です。発注方法は p.56〜57。' },
  ];

  const CHECKLIST = [
    { id: 'scope', text: '見積の範囲をそろえる。足場・仮設、下地補修（数量は予定か精算か）、シーリング、防水、塗装、付帯部が会社ごとに同じ範囲か。', basis: '一般的な確認項目' },
    { id: 'tax', text: '消費税・諸経費・共通仮設費の扱いをそろえる。国交省調査の金額は、共通仮設費と消費税を含まない。', basis: '報告書 p.4、概要 p.1' },
    { id: 'method', text: '発注方式を確認する。「設計・監理方式」は設計事務所等に調査診断・設計・工事監理を委託し、「責任施工方式」は施工会社に設計から工事までを任せる。', basis: '報告書 p.56' },
    { id: 'fee', text: '設計コンサルタントを入れる場合、施工会社から設計コンサルタントへ、請負金額に応じた手数料・紹介料が支払われないか、書面で確認する。', basis: '公取委 2026-09-28 の公表（施工会社が請負金額の一定割合を設計コンサルタントに支払っていた旨）' },
    { id: 'info', text: '設計予算などの情報が、特定の施工会社にだけ渡っていないか。見積依頼の条件・質問への回答を全社に同じに出しているか。', basis: '公取委 2026-09-28 の公表（設計予算などの情報提供が認定された事案）' },
    { id: 'license', text: '建設業許可の業種・有効期限、行政処分の有無を、公的な検索で確認する（上のリンク）。', basis: '国土交通省の検索システム' },
    { id: 'warranty', text: '保証の内容と期間、大規模修繕瑕疵保険の扱い（保険料は諸経費②に入る）を比べる。', basis: '概要 p.1' },
    { id: 'record', text: '同じくらいの規模・工法の施工実績、工程、居住者への連絡方法を比べる。口コミは1件で判断せず、投稿者の利害関係の申告も見る。', basis: '一般的な確認項目' },
  ];

  // ---- 数の表示 ----
  const nf = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });
  const fmt = (x, d) => (x == null || !isFinite(x) ? '—' : d === 0 ? nf0.format(x) : nf.format(x));
  const fmtMan = (x) => (x == null || !isFinite(x) ? '—' : nf0.format(Math.round(x)) + '万円');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---- 建物 ----
  const floorsFromHeight = (h, storeyH) => Math.max(1, Math.round(h / (storeyH > 0 ? storeyH : DEFAULT_STOREY_H)));
  const floorAreaEst = (area, floors) => area * floors; // 屋根面積を各階の床面積とみなした上限寄りの概算
  const wallArea = (perimeter, height) => perimeter * height; // 開口部・パラペット・隣棟との接面は考えない参考値
  function enrich(b, storeyH) {
    const floors = floorsFromHeight(b.h, storeyH);
    return Object.assign({}, b, { floors, tfa: floorAreaEst(b.area, floors), wall: wallArea(b.per, b.h) });
  }
  function validateBuildings(d) {
    if (!d || !d.meta || !d.stats || !Array.isArray(d.buildings) || !d.buildings.length) return false;
    return d.buildings.every((b) => b.id && isFinite(b.lat) && isFinite(b.lon) && b.h > 0 && b.area > 0 && b.per > 0 && Array.isArray(b.ring) && b.ring.length >= 4);
  }
  function fillRates(stats) {
    const t = stats.total || 0;
    const pct = (n) => (t ? (n / t) * 100 : 0);
    return [
      { key: 'height', label: '高さ（計測高さ）', n: stats.height, pct: pct(stats.height) },
      { key: 'roofArea', label: '屋根外形の面積', n: stats.roofArea, pct: pct(stats.roofArea) },
      { key: 'town', label: '住所（町丁目）', n: stats.town, pct: pct(stats.town) },
      { key: 'name', label: '建物名称', n: stats.name, pct: pct(stats.name) },
      { key: 'year', label: '建築年', n: stats.year, pct: pct(stats.year) },
      { key: 'floors', label: '地上階数', n: stats.floors, pct: pct(stats.floors) },
      { key: 'tfa', label: '延床面積', n: stats.tfa, pct: pct(stats.tfa) },
      { key: 'usage', label: '用途', n: stats.usage, pct: pct(stats.usage) },
    ];
  }
  /** 建物の規模の検査。対象外（超高層・大規模）なら blocked、小さすぎるなら small */
  function scaleCheck(b) {
    if (b.floors > SCALE_MAX.floors || b.tfa > SCALE_MAX.tfa) return { blocked: true, small: false, text: 'マンションの規模ではない可能性が高い建物です（推定' + b.floors + '階・延床約' + nf0.format(Math.round(b.tfa)) + '㎡）。目安は出しません' };
    if (b.tfa < SCALE_SMALL_TFA) return { blocked: false, small: true, text: '延床が' + SCALE_SMALL_TFA + '㎡未満の推定です。共同住宅でない可能性があります' };
    return { blocked: false, small: false, text: '' };
  }
  const unitsFromTfa = (tfa) => Math.max(1, Math.round(tfa / UNIT_SQM));
  /** 戸数と延床の整合（1戸あたり延床）。外れたら bad */
  function consistency(units, tfa) {
    if (!(units > 0) || !(tfa > 0)) return null;
    const per = tfa / units;
    return { per, bad: per < PER_UNIT_SQM.min || per > PER_UNIT_SQM.max };
  }
  /** 似た建物。階数（推定）の差が±2以内で、延床（推定）の比が近い順。築年は PLATEAU に入っていないので使えない。 */
  function similar(list, target, n, storeyH, bonus) {
    const out = [];
    const seen = new Set();
    for (const b of list) {
      if (b.id === target.id) continue;
      const e = b.floors != null ? b : enrich(b, storeyH);
      const df = e.floors - target.floors;
      if (Math.abs(df) > 2) continue;
      if (e.floors > SCALE_MAX.floors || e.tfa > SCALE_MAX.tfa) continue;
      const ratio = e.tfa / target.tfa;
      // 延床の比を主に、高さ・外周の比と距離で差を付ける（同点を減らす）
      let dist = Math.abs(Math.log(ratio));
      if (target.h > 0 && e.h > 0) dist += 0.5 * Math.abs(Math.log(e.h / target.h));
      if (target.per > 0 && e.per > 0) dist += 0.3 * Math.abs(Math.log(e.per / target.per));
      let km = null;
      if (isFinite(target.lat) && isFinite(e.lat)) { km = Math.hypot((e.lon - target.lon) * 90.3, (e.lat - target.lat) * 111); dist += 0.01 * km; }
      if (bonus) dist -= bonus(e); // 名前の分かる建物をわずかに先にする等（呼び出し側が決める）
      out.push({ b: e, df, ratio, dist, km });
    }
    out.sort((a, b) => a.dist - b.dist || a.b.id.localeCompare(b.b.id));
    const res = [];
    for (const x of out) {
      const k = (x.b.town || '') + '|' + x.b.floors + '|' + Math.round(x.b.tfa / 50); // 同じ町・同じ規模の重複はまとめる
      if (seen.has(k)) continue;
      seen.add(k); res.push(x);
      if (res.length >= n) break;
    }
    return res;
  }
  function similarByInput(list, floors, tfa, n, storeyH) {
    return similar(list, { id: '', floors, tfa }, n, storeyH);
  }
  function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // ---- 修繕費の目安 ----
  const exTax = (amount, taxIncluded) => (taxIncluded ? amount / (1 + TAX_RATE) : amount);
  /** 値 v が分布（下位25%値・中央値・上位25%値）のどこか。四分位の3点しか無いので、位置は区間で答える（外側の割合は推定しない） */
  function position(v, s) {
    const diffPct = ((v - s.median) / s.median) * 100;
    let band, text;
    if (v > s.q3) { band = 'above-q3'; text = '高め（上位25%に入る）'; }
    else if (v > s.median) { band = 'median-q3'; text = 'やや高め（中央値〜上位25%値）'; }
    else if (v >= s.q1) { band = 'q1-median'; text = 'やや安め（下位25%値〜中央値）'; }
    else { band = 'below-q1'; text = '安め（下位25%に入る）'; }
    const rel = Math.abs(diffPct) < 0.05 ? '中央値と同じ' : diffPct > 1000 ? '中央値の10倍を超えます（桁を確認）' : '中央値より' + fmt(Math.abs(diffPct), 1) + '%' + (diffPct > 0 ? '高い' : '低い');
    return { value: v, median: s.median, q1: s.q1, q3: s.q3, diffPct, band, text, rel };
  }
  /** 築年から工事回数の見当。回数別の平均修繕周期（概要 p.1）を足し上げた築年（1回目15.6、2回目29.6、3回目42.5…）に最も近いものを選ぶ */
  function countHint(age, years) {
    if (!(age > 0)) return null;
    const c1 = years['1'], c2 = c1 + years['2'], c3 = c2 + years['3'];
    const cum = [c1, c2, c3];
    let best = 0;
    cum.forEach((c, i) => { if (Math.abs(age - c) < Math.abs(age - cum[best])) best = i; });
    return { count: String(best + 1), cum };
  }
  /** inputs: { units, tfa, age, count('1'|'2'|'3'), quote(万円), quoteTaxIn(bool) } */
  function estimate(inputs, survey) {
    const set = survey.byCount[inputs.count] || survey.byCount['1'];
    const conflict = consistency(inputs.units, inputs.tfa);
    const res = { label: set.label, set, ranges: [], positions: [], quoteEx: null, hint: countHint(inputs.age, survey.cycle.years), conflict: conflict && conflict.bad ? conflict : null };
    const useSqm = !res.conflict; // 食い違うときは延床あたりを出さない（戸あたりを主にする）
    const bases = [['perUnit', inputs.units, '戸'], ['perSqm', useSqm ? inputs.tfa : 0, '㎡']];
    for (const [key, mult, unit] of bases) {
      if (mult > 0) {
        const s = set[key];
        res.ranges.push({ key, basis: mult, unit, low: s.q1 * mult, mid: s.median * mult, high: s.q3 * mult, stat: s });
      }
    }
    if (inputs.quote > 0) {
      const q = exTax(inputs.quote, inputs.quoteTaxIn);
      res.quoteEx = q;
      if (inputs.units > 0) res.positions.push(Object.assign({ key: 'perUnit', label: '戸あたり（万円/戸）', stat: set.perUnit }, position(q / inputs.units, set.perUnit)));
      if (useSqm && inputs.tfa > 0) res.positions.push(Object.assign({ key: 'perSqm', label: '床面積あたり（万円/㎡）', stat: set.perSqm }, position(q / inputs.tfa, set.perSqm)));
      res.positions.push(Object.assign({ key: 'total', label: '総額（万円。規模の違いを考えない参考）', stat: set.total, scaleFree: true }, position(q, set.total)));
    }
    res.primary = res.ranges[0] || null; // 戸あたりがあれば戸あたり、無ければ延床あたり
    res.primaryPos = res.primary ? res.positions.find((p) => p.key === res.primary.key) || null : null;
    return res;
  }
  /** 複数社の見積を、同じ基準（estimate の主指標）で位置づける。rows: [{name, amount(万円), taxIn}] */
  function compareQuotes(rows, inputs, survey) {
    return rows.filter((r) => r.amount > 0).map((r) => {
      const e = estimate(Object.assign({}, inputs, { quote: r.amount, quoteTaxIn: !!r.taxIn }), survey);
      return { name: r.name, amount: r.amount, ex: e.quoteEx, pos: e.primaryPos, primary: e.primary };
    });
  }
  /** 口コミを会社ごとに数える（件数と、利害関係ありの件数だけ。平均点・順位は出さない） */
  function reviewCounts(reviews, name) {
    const q = (name || '').trim();
    if (!q) return { n: 0, related: 0 };
    const hit = reviews.filter((r) => r.company.includes(q) || q.includes(r.company));
    return { n: hit.length, related: hit.filter((r) => r.stake === 'related').length };
  }

  // ---- 口コミの並び（操作できない設計。投稿日の新しい順だけ。評価・会社・申告で並べ替えない） ----
  function sortReviews(list) {
    return list.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }

  // ---- 点群 ----
  const MAX_POINTS = 3000000;
  const PLY_SIZE = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  function plyRead(dv, off, type, le) {
    switch (type) {
      case 'char': case 'int8': return dv.getInt8(off);
      case 'uchar': case 'uint8': return dv.getUint8(off);
      case 'short': case 'int16': return dv.getInt16(off, le);
      case 'ushort': case 'uint16': return dv.getUint16(off, le);
      case 'int': case 'int32': return dv.getInt32(off, le);
      case 'uint': case 'uint32': return dv.getUint32(off, le);
      case 'float': case 'float32': return dv.getFloat32(off, le);
      default: return dv.getFloat64(off, le);
    }
  }
  function parsePLY(ab) {
    const head = new TextDecoder('latin1').decode(new Uint8Array(ab, 0, Math.min(ab.byteLength, 65536)));
    const m = /end_header\r?\n/.exec(head);
    if (!head.startsWith('ply') || !m) throw new Error('PLY のヘッダーを読めません');
    const bodyStart = m.index + m[0].length;
    const lines = head.slice(0, m.index).split(/\r?\n/);
    let format = null, count = 0, props = [], inVertex = false, seenOther = false;
    for (const ln of lines) {
      const t = ln.trim().split(/\s+/);
      if (t[0] === 'format') format = t[1];
      else if (t[0] === 'element') {
        if (t[1] === 'vertex') { if (seenOther) throw new Error('vertex が先頭の要素でない PLY は読めません'); inVertex = true; count = parseInt(t[2], 10); }
        else { inVertex = false; seenOther = true; }
      } else if (t[0] === 'property' && inVertex) {
        if (t[1] === 'list') throw new Error('vertex に list 型の属性がある PLY は読めません');
        props.push({ type: t[1], name: t[2] });
      }
    }
    if (!format || !count) throw new Error('PLY に点がありません');
    const ix = props.findIndex((p) => p.name === 'x'), iy = props.findIndex((p) => p.name === 'y'), iz = props.findIndex((p) => p.name === 'z');
    if (ix < 0 || iy < 0 || iz < 0) throw new Error('PLY に x, y, z がありません');
    const stride = Math.max(1, Math.ceil(count / MAX_POINTS));
    const out = new Float32Array(Math.ceil(count / stride) * 3);
    let n = 0;
    if (format === 'ascii') {
      const body = new TextDecoder('utf-8').decode(new Uint8Array(ab, bodyStart)).split(/\r?\n/);
      for (let i = 0; i < count && i < body.length; i += stride) {
        const t = body[i].trim().split(/\s+/);
        const x = +t[ix], y = +t[iy], z = +t[iz];
        if (isFinite(x) && isFinite(y) && isFinite(z)) { out[n++] = x; out[n++] = y; out[n++] = z; }
      }
    } else if (format === 'binary_little_endian' || format === 'binary_big_endian') {
      const le = format === 'binary_little_endian';
      const offs = []; let rec = 0;
      for (const p of props) { if (!PLY_SIZE[p.type]) throw new Error('PLY の型を読めません: ' + p.type); offs.push(rec); rec += PLY_SIZE[p.type]; }
      const dv = new DataView(ab, bodyStart);
      if (bodyStart + rec * count > ab.byteLength) throw new Error('PLY のデータが途中で終わっています');
      for (let i = 0; i < count; i += stride) {
        const b = i * rec;
        out[n++] = plyRead(dv, b + offs[ix], props[ix].type, le);
        out[n++] = plyRead(dv, b + offs[iy], props[iy].type, le);
        out[n++] = plyRead(dv, b + offs[iz], props[iz].type, le);
      }
    } else throw new Error('PLY の形式を読めません: ' + format);
    return { points: out.subarray(0, n), count: n / 3, total: count, format: 'PLY' };
  }
  function parseLAS(ab) {
    const dv = new DataView(ab);
    if (ab.byteLength < 227 || String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'LASF') throw new Error('LAS のヘッダーを読めません');
    const major = dv.getUint8(24), minor = dv.getUint8(25);
    const offset = dv.getUint32(96, true), fmtId = dv.getUint8(104), recLen = dv.getUint16(105, true);
    if (fmtId & 0x80) throw new Error('圧縮された LAZ は、この画面では読めません。LAS か PLY に変換してください');
    let total = dv.getUint32(107, true);
    if (major === 1 && minor >= 4 && total === 0 && ab.byteLength >= 375) total = Number(dv.getBigUint64(247, true));
    const sx = dv.getFloat64(131, true), sy = dv.getFloat64(139, true), sz = dv.getFloat64(147, true);
    const ox = dv.getFloat64(155, true), oy = dv.getFloat64(163, true), oz = dv.getFloat64(171, true);
    total = Math.min(total, Math.floor((ab.byteLength - offset) / recLen));
    const stride = Math.max(1, Math.ceil(total / MAX_POINTS));
    const out = new Float32Array(Math.ceil(total / stride) * 3);
    let n = 0;
    for (let i = 0; i < total; i += stride) {
      const b = offset + i * recLen;
      out[n++] = dv.getInt32(b, true) * sx + ox;
      out[n++] = dv.getInt32(b + 4, true) * sy + oy;
      out[n++] = dv.getInt32(b + 8, true) * sz + oz;
    }
    return { points: out.subarray(0, n), count: n / 3, total, format: 'LAS ' + major + '.' + minor };
  }
  function parseXYZ(text) {
    const lines = text.split(/\r?\n/);
    const stride = Math.max(1, Math.ceil(lines.length / MAX_POINTS));
    const out = new Float32Array(Math.ceil(lines.length / stride) * 3);
    let n = 0, total = 0;
    for (let i = 0; i < lines.length; i += stride) {
      const t = lines[i].trim().split(/[\s,;]+/);
      if (t.length < 3) continue;
      const x = +t[0], y = +t[1], z = +t[2];
      if (isFinite(x) && isFinite(y) && isFinite(z)) { out[n++] = x; out[n++] = y; out[n++] = z; }
    }
    total = n / 3;
    return { points: out.subarray(0, n), count: n / 3, total, format: 'XYZ（テキスト）' };
  }
  function parseCloud(ab, name) {
    const lower = (name || '').toLowerCase();
    if (lower.endsWith('.laz')) throw new Error('圧縮された LAZ は、この画面では読めません。LAS か PLY に変換してください');
    const sig = new TextDecoder('latin1').decode(new Uint8Array(ab, 0, Math.min(4, ab.byteLength)));
    if (sig.startsWith('ply')) return parsePLY(ab);
    if (sig === 'LASF') return parseLAS(ab);
    if (/\.(xyz|txt|csv|pts)$/.test(lower)) return parseXYZ(new TextDecoder('utf-8').decode(new Uint8Array(ab)));
    throw new Error('対応する形式は PLY・LAS・XYZ（テキスト）です');
  }
  function convexHull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    const up = [];
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  const ringPerimeter = (h) => { let s = 0; for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; };
  const ringArea = (h) => { let s = 0; for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
  function percentile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))]; }
  /** 点群の概算。up は上方向の軸（'z' か 'y'）。高さは 1〜99 パーセンタイルの差（外れ値を除く）。外周は水平面に落とした凸包。 */
  function analyzeCloud(cloud, up) {
    const P = cloud.points, n = cloud.count;
    if (n < 10) throw new Error('点が少なすぎます');
    const hAxis = up === 'y' ? 1 : 2, a1 = 0, a2 = up === 'y' ? 2 : 1;
    const step = Math.max(1, Math.floor(n / 150000));
    const hs = [], xy = [];
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (let i = 0; i < n; i += step) {
      const x = P[i * 3 + a1], y = P[i * 3 + a2], h = P[i * 3 + hAxis];
      hs.push(h); xy.push([x, y]);
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    const sorted = Float64Array.from(hs).sort();
    const h1 = percentile(sorted, 0.01), h99 = percentile(sorted, 0.99);
    const height = h99 - h1;
    const hull = convexHull(xy);
    const perimeter = ringPerimeter(hull), area = ringArea(hull);
    const w = maxx - minx, d = maxy - miny;
    const slender = Math.min(w, d) / Math.max(w, d, 1e-9) < 0.15; // 細長い＝壁の1面だけの可能性
    const wallLen = slender ? perimeter / 2 : perimeter;
    return { n, total: cloud.total, up: up === 'y' ? 'y' : 'z', width: w, depth: d, height, h1, h99, perimeter, hullArea: area, slender, wallLen, wall: wallLen * height, hull, sample: xy.filter((_, i) => i % Math.max(1, Math.floor(xy.length / 6000)) === 0) };
  }
  /** 見本の合成点群（18m×12m×9mの箱の外壁だけ。乱数は固定）。実在の建物ではない */
  function synthCloud() {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const W = 18, D = 12, H = 9, step = 0.2;
    const pts = [];
    const jit = () => (rnd() - 0.5) * 0.02;
    for (let z = 0; z <= H + 1e-9; z += step) {
      for (let x = 0; x < W; x += step) { pts.push(x + jit(), 0 + jit(), z); pts.push(W - x + jit(), D + jit(), z); }
      for (let y = 0; y < D; y += step) { pts.push(W + jit(), y + jit(), z); pts.push(0 + jit(), D - y + jit(), z); }
    }
    return { points: Float32Array.from(pts), count: pts.length / 3, total: pts.length / 3, format: '合成（18m×12m×高さ9mの箱の外壁。実在しない）' };
  }
  /** 選んだ建物の外形（経緯度の輪）を、低層部の高さ lowH(m) まで測ったとみなす合成の点群（操作の練習用。実測ではない） */
  function synthCloudFor(ring, lowH) {
    if (!ring || ring.length < 3) return synthCloud();
    const lon0 = ring[0][0], lat0 = ring[0][1], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
    const xy = ring.map((p) => [(p[0] - lon0) * kx, (p[1] - lat0) * ky]);
    const H = Math.max(1, lowH), step = 0.25, pts = [];
    for (let i = 0; i < xy.length; i++) {
      const a = xy[i], b = xy[(i + 1) % xy.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      for (let t = 0; t < len; t += step) {
        const x = a[0] + ((b[0] - a[0]) * t) / len, y = a[1] + ((b[1] - a[1]) * t) / len;
        for (let z = 0; z <= H + 1e-9; z += step) pts.push(x, y, z);
      }
      if (pts.length > 2400000) break;
    }
    return { points: Float32Array.from(pts), count: pts.length / 3, total: pts.length / 3, format: '合成（選んだ建物の外形を高さ' + H + 'mまで測ったとみなす。実測ではない）' };
  }
  function toPLY(cloud) {
    const head = 'ply\nformat ascii 1.0\ncomment 合成データ（実在の建物ではありません）\nelement vertex ' + cloud.count + '\nproperty float x\nproperty float y\nproperty float z\nend_header\n';
    const rows = [];
    for (let i = 0; i < cloud.count; i++) rows.push(cloud.points[i * 3].toFixed(3) + ' ' + cloud.points[i * 3 + 1].toFixed(3) + ' ' + cloud.points[i * 3 + 2].toFixed(3));
    return head + rows.join('\n') + '\n';
  }

  const api = { TAX_RATE, DEFAULT_STOREY_H, UNIT_SQM, SCALE_MAX, SCALE_SMALL_TFA, PER_UNIT_SQM, scaleCheck, unitsFromTfa, consistency, compareQuotes, reviewCounts, DISCLAIMER, LICENSE_NOTE, RESPONSIBILITY, LINKS, CHECKLIST, fmt, fmtMan, esc, floorsFromHeight, floorAreaEst, wallArea, enrich, validateBuildings, fillRates, similar, similarByInput, pointInRing, exTax, position, countHint, estimate, sortReviews, parsePLY, parseLAS, parseXYZ, parseCloud, convexHull, ringPerimeter, ringArea, analyzeCloud, synthCloud, synthCloudFor, toPLY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Lib = api;
})(typeof window !== 'undefined' ? window : globalThis);
