import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { NotifyProvider } from './lib/notify'
import { sb } from './lib/supabase'
import Shell from './components/Shell'
import Login from './pages/Login'

export default function App() {
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null))
    const { data: { subscription } } = sb.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  if (user === undefined) return null

  return (
    <NotifyProvider>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/*" element={user ? <Shell user={user} /> : <Navigate to="/login" replace />} />
      </Routes>
    </NotifyProvider>
  )
}
