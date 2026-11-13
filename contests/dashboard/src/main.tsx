import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AppShell } from '@/components/layout/AppShell'
import Portal from '@/pages/Portal'

// ポータル（統合ダッシュボード）。各アプリは apps/<id>/index.html の独立ページ。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell>
      <Portal />
    </AppShell>
  </StrictMode>,
)
