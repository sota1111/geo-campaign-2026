import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import { StandaloneShell } from '@/components/layout/StandaloneShell'

/** 独立アプリページの起動。ハッシュが空なら '#/' にして、共有リンクの形を揃える */
export function mountStandalone(appId: string, App: ComponentType) {
  if (!window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search + '#/')
  }
  const app = document.getElementById('root')!
  createRoot(app).render(
    <StrictMode>
      <StandaloneShell appId={appId}>
        <App />
      </StandaloneShell>
    </StrictMode>,
  )
}
