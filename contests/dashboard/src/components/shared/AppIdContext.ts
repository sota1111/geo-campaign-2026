import { createContext, useContext } from 'react'

/** 独立アプリページのアプリ id（StandaloneShell が渡す） */
export const AppIdContext = createContext<string | undefined>(undefined)
export const useAppId = () => useContext(AppIdContext)
