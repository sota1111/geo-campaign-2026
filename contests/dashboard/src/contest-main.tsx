import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AppShell } from '@/components/layout/AppShell'
import ContestPage from '@/pages/ContestPage'

// コンペの概要ページ（contest/<id>/index.html）。#root の data-contest がコンペ id。サイドバーはポータルと同じ。
const root = document.getElementById('root')!
const id = root.dataset.contest ?? ''
createRoot(root).render(
  <StrictMode>
    <AppShell activeContest={id}>
      <ContestPage contestId={id} />
    </AppShell>
  </StrictMode>,
)
