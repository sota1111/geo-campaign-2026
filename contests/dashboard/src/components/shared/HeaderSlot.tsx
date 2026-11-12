import { createContext } from 'react'

/**
 * StandaloneShell の細いヘッダー右側の差し込み口。PageHeader compact がここへバッジ・出典ボタン等を描画する。
 * undefined = Shell の外（フォールバックで自分の行を出す）／ { el: null } = Shell 内だが口がまだ未マウント
 */
export const HeaderSlotContext = createContext<{ el: HTMLElement | null } | undefined>(undefined)
