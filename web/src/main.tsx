import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@radix-ui/react-tooltip'
import './index.css'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/dates/styles.css'
import App from './App.tsx'
import { MantineProvider, createTheme } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { ModalsProvider } from '@mantine/modals'
import { DatesProvider } from '@mantine/dates'
import 'dayjs/locale/ru'

const theme = createTheme({
  fontFamily: 'Inter, system-ui, sans-serif',
  primaryColor: 'blue',
  defaultRadius: 'md',
  colors: {
    dark: ['#f8fafc', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#334155', '#1e293b', '#101929', '#0b1322', '#060b16'],
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} forceColorScheme="dark" defaultColorScheme="dark">
      <ModalsProvider>
        <DatesProvider settings={{ locale: 'ru', firstDayOfWeek: 1, consistentWeeks: true }}>
          <TooltipProvider delayDuration={200}>
            <Notifications position="bottom-right" />
            <App />
          </TooltipProvider>
        </DatesProvider>
      </ModalsProvider>
    </MantineProvider>
  </StrictMode>,
)
