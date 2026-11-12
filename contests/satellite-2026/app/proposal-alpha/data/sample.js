// 架空サンプル。区間・配電線・数値・設備はすべて架空で、実在の配電線・停電・衛星解析結果ではありません。
window.SAMPLE = {
  refYear: 2026,
  view: [0, 0, 600, 400],
  depot: { x: 300, y: 350, name: '営業所（架空）' },
  river: '330,0 345,80 335,160 370,240 360,320 400,400',
  roads: [
    '0,300 120,290 240,300 300,280 420,270 600,240',
    '300,280 310,200 280,130 220,60 150,0',
    '420,270 470,200 540,180 600,150'
  ],
  forests: [
    '180,40 260,30 300,90 270,170 220,190 170,140 150,90',
    '470,60 560,40 590,110 570,200 520,230 480,180 450,120',
    '20,200 80,180 110,230 90,290 30,280',
    '380,330 460,320 520,350 500,395 400,390'
  ],
  sections: [
    { id: 'F1-01', feeder: 'F1', name: '架空F1線 第1区間', pts: [[60,70],[130,90]], lenM: 520, p90: 9, tallPct: 5, change: '変化なし', terrain: '平地', customers: 45, facility: 'なし', road: '市道沿い', lastCut: 2023, pastFall: false },
    { id: 'F1-02', feeder: 'F1', name: '架空F1線 第2区間', pts: [[130,90],[200,110],[250,150]], lenM: 780, p90: 14, tallPct: 18, change: '変化なし', terrain: '斜面', customers: 120, facility: 'なし', road: '市道沿い', lastCut: 2019, pastFall: false },
    { id: 'F1-03', feeder: 'F1', name: '架空F1線 第3区間（谷筋）', pts: [[250,150],[290,200]], lenM: 610, p90: 22, tallPct: 56, change: '倒木・裸地化の疑い', changeDate: '2026-09-18', terrain: '谷筋・急斜面', customers: 420, facility: '避難所', road: '幹線道路沿い', lastCut: 2014, pastFall: true },
    { id: 'F1-04', feeder: 'F1', name: '架空F1線 第4区間', pts: [[290,200],[300,260]], lenM: 480, p90: 17, tallPct: 35, change: '樹冠の拡大', changeDate: '2026-09-18', terrain: '谷筋・急斜面', customers: 380, facility: 'なし', road: '幹線道路沿い', lastCut: 2017, pastFall: false },
    { id: 'F1-05', feeder: 'F1', name: '架空F1線 第5区間', pts: [[300,260],[310,320]], lenM: 450, p90: 11, tallPct: 12, change: '変化なし', terrain: '平地', customers: 640, facility: '通信設備', road: '幹線道路沿い', lastCut: 2022, pastFall: false },
    { id: 'F2-01', feeder: 'F2', name: '架空F2線 第1区間', pts: [[320,330],[390,310],[450,300]], lenM: 900, p90: 13, tallPct: 14, change: '変化なし', terrain: '平地', customers: 900, facility: '病院', road: '幹線道路沿い', lastCut: 2024, pastFall: false },
    { id: 'F2-02', feeder: 'F2', name: '架空F2線 第2区間', pts: [[450,300],[500,260]], lenM: 560, p90: 13, tallPct: 22, change: '変化なし', terrain: '斜面', customers: 210, facility: 'なし', road: '市道沿い', lastCut: null, pastFall: false },
    { id: 'F2-03', feeder: 'F2', name: '架空F2線 第3区間（山すそ）', pts: [[500,260],[540,200],[560,150]], lenM: 840, p90: 20, tallPct: 48, change: '倒木・裸地化の疑い', changeDate: '2026-09-18', terrain: '斜面', customers: 260, facility: 'なし', road: '道路なし', lastCut: null, pastFall: false },
    { id: 'F2-04', feeder: 'F2', name: '架空F2線 第4区間（山間）', pts: [[560,150],[540,90]], lenM: 700, p90: 24, tallPct: 62, change: '変化なし', terrain: '谷筋・急斜面', customers: 70, facility: 'なし', road: '道路なし', lastCut: 2012, pastFall: false },
    { id: 'F2-05', feeder: 'F2', name: '架空F2線 第5区間', pts: [[540,90],[480,50]], lenM: 620, p90: 16, tallPct: 30, change: '樹冠の拡大', changeDate: '2026-09-18', terrain: '斜面', customers: 35, facility: '避難所', road: '市道沿い', lastCut: 2020, pastFall: true },
    { id: 'F3-01', feeder: 'F3', name: '架空F3線 第1区間', pts: [[40,330],[100,320]], lenM: 400, p90: 6, tallPct: 2, change: '変化なし', terrain: '平地', customers: 300, facility: 'なし', road: '市道沿い', lastCut: 2024, pastFall: false },
    { id: 'F3-02', feeder: 'F3', name: '架空F3線 第2区間', pts: [[100,320],[160,340],[220,350]], lenM: 760, p90: 12, tallPct: 15, change: '変化なし', terrain: '平地', customers: 520, facility: '通信設備', road: '市道沿い', lastCut: 2021, pastFall: false },
    { id: 'F3-03', feeder: 'F3', name: '架空F3線 第3区間', pts: [[220,350],[270,370]], lenM: 430, p90: 15, tallPct: 26, change: '樹冠の拡大', changeDate: '2026-09-18', terrain: '斜面', customers: 150, facility: 'なし', road: '市道沿い', lastCut: 2018, pastFall: false },
    { id: 'F3-04', feeder: 'F3', name: '架空F3線 第4区間（集落の裏山）', pts: [[40,330],[50,260],[90,220]], lenM: 690, p90: 19, tallPct: 41, change: '変化なし', terrain: '谷筋・急斜面', customers: 85, facility: 'なし', road: '市道沿い', lastCut: null, pastFall: true }
  ]
};
