// サンプル（架空）データ。実在の地点・区域・衛星解析結果ではない。
window.SAMPLE = {
  notice: 'サンプル（架空）データ',
  refDate: '2026-11-10',
  city: '架空市（地図は模式図）',
  origin: { x: 300, y: 215, name: '架空市役所（仮）' },
  zones: [
    { type: '特定盛土等規制区域', points: '40,40 330,30 360,170 200,210 60,190' },
    { type: '宅地造成等工事規制区域', points: '330,30 570,60 560,230 360,170' },
    { type: '宅地造成等工事規制区域', points: '60,190 200,210 250,370 80,360' }
  ],
  river: '20,120 150,150 260,260 330,380',
  roads: ['10,215 590,215', '300,10 300,390'],
  sites: [
    { id: 'A-01', name: '北谷 造成地', x: 110, y: 90, zone: '特定盛土等規制区域', change: '新設', terrain: '谷埋め', permit: '許可・届出なし', detected: '2026-10-12', areaM2: 4200, seasonal: false, note: '光学の裸地化とSARの後方散乱の変化が重なる候補（想定）' },
    { id: 'A-02', name: '東山 斜面', x: 250, y: 110, zone: '特定盛土等規制区域', change: '拡大', terrain: '斜面', permit: '許可・届出あり', detected: '2026-09-28', areaM2: 1800, seasonal: false, note: '許可範囲を超えた拡大かの確認が必要（想定）' },
    { id: 'A-03', name: '川沿い 資材置場', x: 190, y: 175, zone: '特定盛土等規制区域', change: '変位', terrain: '斜面', permit: '確認中', detected: '2026-10-30', areaM2: 900, seasonal: false, note: '沈下・変位の傾向（想定）' },
    { id: 'A-04', name: '北端 林道脇', x: 70, y: 60, zone: '特定盛土等規制区域', change: '変位', terrain: '谷埋め', permit: '許可・届出あり', detected: '2026-11-07', areaM2: 600, seasonal: false, note: '大雨後に変位（想定）' },
    { id: 'B-01', name: '南原 農地', x: 450, y: 120, zone: '宅地造成等工事規制区域', change: '植生消失', terrain: '平地', permit: '許可・届出なし', detected: '2026-10-20', areaM2: 2600, seasonal: true, note: '耕起による季節変動の可能性' },
    { id: 'B-02', name: '西町 宅地造成', x: 500, y: 170, zone: '宅地造成等工事規制区域', change: '拡大', terrain: '斜面', permit: '許可・届出あり', detected: '2026-08-15', areaM2: 3100, seasonal: false, note: '許可済み工事の進捗と思われる（想定）' },
    { id: 'B-03', name: '中央 谷戸', x: 400, y: 70, zone: '宅地造成等工事規制区域', change: '新設', terrain: '谷埋め', permit: '確認中', detected: '2026-11-02', areaM2: 1500, seasonal: false, note: '新規検出（想定）' },
    { id: 'C-01', name: '南丘 造成', x: 120, y: 290, zone: '宅地造成等工事規制区域', change: '新設', terrain: '斜面', permit: '許可・届出なし', detected: '2026-10-05', areaM2: 2200, seasonal: false, note: '区域内の無届の疑い（想定）' },
    { id: 'C-02', name: '南谷 堆積', x: 190, y: 330, zone: '宅地造成等工事規制区域', change: '拡大', terrain: '谷埋め', permit: '許可・届出なし', detected: '2026-09-10', areaM2: 5200, seasonal: false, note: '過去の巡視記録なし' },
    { id: 'C-03', name: '駅南 空地', x: 150, y: 230, zone: '宅地造成等工事規制区域', change: '植生消失', terrain: '平地', permit: '確認中', detected: '2026-11-05', areaM2: 700, seasonal: false, note: '草刈りの可能性もあり' },
    { id: 'D-01', name: '区域外 山林縁', x: 540, y: 300, zone: '区域外', change: '新設', terrain: '斜面', permit: '確認中', detected: '2026-10-25', areaM2: 1300, seasonal: false, note: '区域外のため指定権者の対象か要確認' },
    { id: 'D-02', name: '東端 残土置場', x: 480, y: 260, zone: '区域外', change: '拡大', terrain: '平地', permit: '確認中', detected: '2026-10-01', areaM2: 2900, seasonal: false, note: '区域外' }
  ]
};
