import { createContext, useContext, useState, useCallback } from 'react'

const Ctx = createContext(null)

export function NotifyProvider({ children }) {
  const [n, setN] = useState({ msg: '', type: '', show: false })

  const notify = useCallback((msg, type = 'success') => {
    setN({ msg, type, show: true })
    setTimeout(() => setN(prev => ({ ...prev, show: false })), 3000)
  }, [])

  return (
    <Ctx.Provider value={notify}>
      {children}
      <div className={`notif${n.show ? ' show' : ''}${n.type ? ' ' + n.type : ''}`}>{n.msg}</div>
    </Ctx.Provider>
  )
}

export const useNotify = () => useContext(Ctx)
