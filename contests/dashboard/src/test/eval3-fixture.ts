// テスト用の架空データ（画面・eval-r3.json には出さない）。値は意味を持たない。
const ev = (n: number, over: Record<string, unknown> = {}) => ({
  evaluator: n,
  model: 'fixture',
  portal: { A: [1, 2, 3, 4, 5], goals: { 'P-1': { achieved: n % 2 === 0, value: 'x' } } },
  apps: [
    { purpose: 4, app_title_seen: 'x', B: [1, 1, 1, 1, 1, 1, 1], C: { 'C-SAT1': 2, 'C-SAT2': 2, 'C-SAT3': 2, 'C-SAT4': 2, 'C-SAT5': 2 }, goals: { 'G4-1': { achieved: true, value: 'x', where: 'y' } } },
    { purpose: 8, app_title_seen: 'x', B: [5, 4, 3, 2, 1, 0, 5], C: { 'C-SAT1': 5, 'C-SAT2': 4, 'C-SAT3': 3, 'C-SAT4': 2, 'C-SAT5': 1 }, goals: { 'G8-1': { achieved: n <= 3, value: 'x', where: 'y' } } },
  ],
  ...over,
})
export const FIXTURE_FILES = [1, 2, 3, 4].map((n) => ({ name: `eval-0${n}.json`, text: JSON.stringify(ev(n)) }))
export const BROKEN_FILES = [
  { name: 'eval-05.json', text: '{ not json' },
  {
    name: 'eval-06.json',
    text: JSON.stringify(
      ev(6, {
        apps: [
          { purpose: 99, B: [1, 1, 1, 1, 1, 1, 1], C: {} },
          { purpose: 4, B: [1, 1, 1], C: { 'C-SAT1': 9, 'C-SAT2': 3 }, goals: { 'G4-1': { achieved: 'yes' } } },
        ],
      }),
    ),
  },
]
