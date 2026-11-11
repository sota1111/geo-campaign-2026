import type { SampleRun } from '@/lib/sample'
import { SAMPLE as odpt } from '@/apps/odpt/sample'
import { SAMPLE as udcMoritsuchi } from '@/apps/udc-moritsuchi/sample'
import { SAMPLE as satA } from '@/apps/sat-a/sample'
import { SAMPLE as satB } from '@/apps/sat-b/sample'
import { SAMPLE as bizBusiness } from '@/apps/biz-business/sample'
import { SAMPLE as bizIdea } from '@/apps/biz-idea/sample'
import { SAMPLE as bizRealestate } from '@/apps/biz-realestate/sample'

/** アプリ id → 実行サンプル。各アプリの sample.ts を登録する */
export const SAMPLES: Record<string, SampleRun | undefined> = {
  'odpt': odpt,
  'udc-moritsuchi': udcMoritsuchi,
  'sat-a': satA,
  'sat-b': satB,
  'biz-business': bizBusiness,
  'biz-idea': bizIdea,
  'biz-realestate': bizRealestate,
}

export function getSample(appId: string): SampleRun | undefined {
  return SAMPLES[appId]
}
