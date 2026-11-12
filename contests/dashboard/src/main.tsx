import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AppShell } from '@/components/layout/AppShell'
import Overview from '@/pages/Overview'

// ポータル（統合ダッシュボード）。各アプリは apps/<id>/index.html の独立ページ。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell>
      <Overview />
    </AppShell>
  </StrictMode>,
)
