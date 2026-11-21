import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import './index.css'
import { AppShell } from '@/components/layout/AppShell'
import OntologyPage from '@/pages/OntologyPage'

// つながり図（ontology/index.html）。graph.json と next-actions.json をビルド時に public/ontology/ へ写して読む。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell>
      <OntologyPage />
    </AppShell>
  </StrictMode>,
)
