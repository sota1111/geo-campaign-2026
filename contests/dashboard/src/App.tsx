import { Suspense } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import Overview from '@/pages/Overview'
import { getApp } from '@/apps/registry'

function AppPage() {
  const { id = '' } = useParams()
  const app = getApp(id)
  if (!app) return <Navigate to="/" replace />
  const C = app.Component
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">読み込み中…</p>}>
      <C />
    </Suspense>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="apps/:id" element={<AppPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
