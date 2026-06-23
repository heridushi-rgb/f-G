import { useState } from 'react'
import { NavLink, Routes, Route, useLocation, Link } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useNotify } from '../lib/notify'
import Modal from './Modal'
import Dashboard from '../pages/Dashboard'
import Inventory from '../pages/Inventory'
import Orders from '../pages/Orders'
import Customers from '../pages/Customers'
import Payments from '../pages/Payments'
import Ledger from '../pages/Ledger'
import Reports from '../pages/Reports'

const TITLES = {
  '/': 'Dashboard',
  '/inventory': 'Inventory',
  '/orders': 'Orders',
  '/customers': 'Customers',
  '/payments': 'Payments',
  '/ledger': 'Ledger',
  '/reports': 'Reports',
}

export default function Shell({ user }) {
  const { pathname } = useLocation()
  const notify = useNotify()
  const username = (user.email || '').split('@')[0] || 'user'
  const initials = username.slice(0, 2).toUpperCase()
  const navCls = ({ isActive }) => `nav-item${isActive ? ' active' : ''}`

  const [moreOpen, setMoreOpen] = useState(false)
  const [pwModal, setPwModal] = useState(false)
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  async function changePassword() {
    if (newPw.length < 8) { notify('Password must be at least 8 characters', 'error'); return }
    if (newPw !== confirmPw) { notify('Passwords do not match', 'error'); return }
    setPwSaving(true)
    const { error } = await sb.auth.updateUser({ password: newPw })
    setPwSaving(false)
    if (error) { notify(error.message, 'error'); return }
    notify('Password updated successfully')
    setPwModal(false)
    setNewPw(''); setConfirmPw('')
  }

  function openChangePw() {
    setShowMenu(false)
    setNewPw(''); setConfirmPw('')
    setPwModal(true)
  }

  async function signOut() {
    setShowMenu(false)
    await sb.auth.signOut()
  }

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-name">4FG Trading</div>
          <div className="brand-tag">4F and G Trading Ltd</div>
        </div>
        <div className="nav-sec">
          <div className="nav-lbl">Main</div>
          <NavLink to="/" end className={navCls}><span className="nav-icon">▦</span>Dashboard</NavLink>
          <NavLink to="/inventory" className={navCls}><span className="nav-icon">⊞</span>Inventory</NavLink>
          <NavLink to="/orders" className={navCls}><span className="nav-icon">≡</span>Orders</NavLink>
          <NavLink to="/customers" className={navCls}><span className="nav-icon">◉</span>Customers</NavLink>
        </div>
        <div className="nav-sec">
          <div className="nav-lbl">Finance</div>
          <NavLink to="/payments" className={navCls}><span className="nav-icon">↓</span>Payments</NavLink>
          <NavLink to="/ledger" className={navCls}><span className="nav-icon">⇌</span>Ledger</NavLink>
        </div>
        <div className="nav-sec">
          <div className="nav-lbl">Reports</div>
          <NavLink to="/reports" className={navCls}><span className="nav-icon">↗</span>Reports & Export</NavLink>
        </div>
        <div className="nav-bottom">
          <button
            className="nav-item"
            style={{ width: '100%', color: 'rgba(255,255,255,0.28)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '11.5px' }}
            onClick={signOut}
          >
            <span className="nav-icon">←</span>Sign out
          </button>
        </div>
      </nav>

      <div className="main">
        <div className="topbar">
          <span className="topbar-title">{TITLES[pathname] || '4FG Trading'}</span>
          <div className="topbar-right" style={{ position: 'relative' }}>
            <span style={{ fontSize: 11, color: 'var(--t3)' }}>{username}</span>
            <div
              className="avatar"
              style={{ cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setShowMenu(m => !m)}
              title="Account options"
            >
              {initials}
            </div>
            {showMenu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowMenu(false)} />
                <div style={{
                  position: 'absolute', top: 38, right: 0, background: '#fff',
                  border: '1px solid var(--b2)', borderRadius: 'var(--r)',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.12)', zIndex: 100,
                  minWidth: 170, padding: '4px 0'
                }}>
                  <div style={{ padding: '6px 14px 4px', fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Signed in as
                  </div>
                  <div style={{ padding: '0 14px 8px', fontSize: 12, fontWeight: 600, borderBottom: '1px solid var(--b)' }}>
                    {username}
                  </div>
                  <button
                    onClick={openChangePw}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t)', fontFamily: 'inherit' }}
                    onMouseEnter={e => e.target.style.background = 'var(--s2)'}
                    onMouseLeave={e => e.target.style.background = 'none'}
                  >
                    Change password
                  </button>
                  <button
                    onClick={signOut}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--er)', fontFamily: 'inherit' }}
                    onMouseEnter={e => e.target.style.background = 'var(--er-l)'}
                    onMouseLeave={e => e.target.style.background = 'none'}
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/ledger" element={<Ledger />} />
            <Route path="/reports" element={<Reports />} />
          </Routes>
        </div>
      </div>

      {/* Mobile bottom navigation */}
      <div className="bottom-nav">
        {moreOpen && <div className="more-overlay open" onClick={() => setMoreOpen(false)} />}
        <div className={`more-drawer${moreOpen ? ' open' : ''}`}>
          <NavLink to="/payments" className={({ isActive }) => isActive ? 'active' : ''} onClick={() => setMoreOpen(false)}>
            <span>↓</span> Payments
          </NavLink>
          <NavLink to="/ledger" className={({ isActive }) => isActive ? 'active' : ''} onClick={() => setMoreOpen(false)}>
            <span>⇌</span> Ledger
          </NavLink>
          <NavLink to="/reports" className={({ isActive }) => isActive ? 'active' : ''} onClick={() => setMoreOpen(false)}>
            <span>↗</span> Reports & Export
          </NavLink>
          <button onClick={() => { setMoreOpen(false); signOut() }} style={{ color: 'var(--er)' }}>
            <span>←</span> Sign out
          </button>
        </div>
        <div className="bottom-nav-inner">
          <NavLink to="/" end className={({ isActive }) => `bn-item${isActive ? ' active' : ''}`}>
            <span className="bn-icon">▦</span>Dashboard
          </NavLink>
          <NavLink to="/inventory" className={({ isActive }) => `bn-item${isActive ? ' active' : ''}`}>
            <span className="bn-icon">⊞</span>Inventory
          </NavLink>
          <NavLink to="/orders" className={({ isActive }) => `bn-item${isActive ? ' active' : ''}`}>
            <span className="bn-icon">≡</span>Orders
          </NavLink>
          <NavLink to="/customers" className={({ isActive }) => `bn-item${isActive ? ' active' : ''}`}>
            <span className="bn-icon">◉</span>Customers
          </NavLink>
          <button className={`bn-item${moreOpen ? ' active' : ''}`} onClick={() => setMoreOpen(o => !o)}>
            <span className="bn-icon">···</span>More
          </button>
        </div>
      </div>

      <Modal open={pwModal} onClose={() => setPwModal(false)} title="Change Password">
        <div className="form-group">
          <label className="form-label">New password</label>
          <input
            className="form-input"
            type="password"
            placeholder="Min. 8 characters"
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            autoFocus
          />
        </div>
        <div className="form-group">
          <label className="form-label">Confirm new password</label>
          <input
            className="form-input"
            type="password"
            placeholder="Repeat password"
            value={confirmPw}
            onChange={e => setConfirmPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && changePassword()}
          />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setPwModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={changePassword} disabled={pwSaving}>
            {pwSaving ? 'Saving…' : 'Update Password'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
