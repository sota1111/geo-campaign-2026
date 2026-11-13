export interface Stat { mean: number; min: number; max: number; n: number }
export interface GoalTally { achieved: number; n: number }
export interface Eval3App { n: number; B: (Stat | null)[]; C: Record<string, Stat | null>; goals: Record<string, GoalTally> }
export interface Eval3Data {
  date: string
  model: string
  source: string
  evaluatorFiles: number
  evaluatorCount: number
  collected: boolean
  warnings: string[]
  portal: { A: (Stat | null)[]; goals: Record<string, GoalTally>; n: number } | null
  apps: Record<string, Eval3App>
}
export const PURPOSE_TO_APP: Record<number, string>
export const EVAL3_DATE: string
export function isScore(v: unknown): v is number
export function stat(values: (number | null)[]): Stat | null
export function aggregate(files: { name: string; text: string }[]): Eval3Data
