import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmt, exportCSV } from '../lib/utils'
import { useNotify } from '../lib/notify'
import Modal from '../components/Modal'

const ACCOUNT_TYPES = [
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'cash',         label: 'Cash Safe / Till' },
  { value: 'bank',         label: 'Bank Account' },
]
const TYPE_LABEL = { mobile_money: 'Mobile Money', cash: 'Cash / Safe', bank: 'Bank' }
const TYPE_BADGE = { mobile_money: 'badge-a', cash: 'badge-x', bank: 'badge-b' }

const EMPTY_TX  = { account_id: '', type: 'out', amount: '', reason: '', date: '' }
const EMPTY_ACC = { id: '', name: '', type: 'bank', currency: 'RWF' }

export default function Ledger() {
  const notify = useNotify()
  const [accounts, setAccounts] = useState(null)
  const [transactions, setTransactions] = useState(null)
  const [payments, setPayments] = useState(null)
  const [filterAcc, setFilterAcc] = useState('')
  const [txForm, setTxForm] = useState(EMPTY_TX)
  const [accForm, setAccForm] = useState(EMPTY_ACC)
  const [txModal, setTxModal] = useState(false)
  const [accModal, setAccModal] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const [accRes, txRes, payRes] = await Promise.all([
      sb.from('accounts').select('*').order('sort_order').order('created_at'),
      sb.from('cash_transactions').select('*, accounts(name, currency)').order('date', { ascending: false }).order('created_at', { ascending: false }),
      sb.from('payments').select('amount, account_id'),
    ])
    setAccounts(accRes.data || [])
    setTransactions(txRes.data || [])
    setPayments(payRes.data || [])
  }

  function getBalance(accountId) {
    const txs = (transactions || []).filter(t => t.account_id === accountId)
    const fromTx = txs.reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0)
    const fromPay = (payments || []).filter(p => p.account_id === accountId).reduce((s, p) => s + p.amount, 0)
    return fromTx + fromPay
  }

  // ── Add transaction ──
  function openTx(accountId) {
    setTxForm({ ...EMPTY_TX, account_id: accountId || '', date: new Date().toISOString().split('T')[0] })
    setTxModal(true)
  }

  async function saveTx() {
    const amount = parseFloat(txForm.amount)
    if (!txForm.account_id) { notify('Select an account', 'error'); return }
    if (!amount || amount <= 0) { notify('Enter a valid amount', 'error'); return }
    if (!txForm.reason.trim()) { notify('Reason is required', 'error'); return }
    setSaving(true)
    const { error } = await sb.from('cash_transactions').insert({
      account_id: txForm.account_id,
      type: txForm.type,
      amount,
      reason: txForm.reason.trim(),
      date: txForm.date,
    })
    setSaving(false)
    if (error) { notify(error.message, 'error'); return }
    notify('Entry recorded')
    setTxModal(false)
    load()
  }

  // ── Add / edit account ──
  function openAddAcc() {
    setAccForm(EMPTY_ACC)
    setAccModal(true)
  }

  function openEditAcc(acc) {
    setAccForm({ id: acc.id, name: acc.name, type: acc.type, currency: acc.currency })
    setAccModal(true)
  }

  async function saveAcc() {
    if (!accForm.name.trim()) { notify('Account name is required', 'error'); return }
    setSaving(true)
    const payload = { name: accForm.name.trim(), type: accForm.type, currency: accForm.currency }
    const { error } = accForm.id
      ? await sb.from('accounts').update(payload).eq('id', accForm.id)
      : await sb.from('accounts').insert(payload)
    setSaving(false)
    if (error) { notify(error.message, 'error'); return }
    notify(accForm.id ? 'Account updated' : 'Account added')
    setAccModal(false)
    load()
  }

  const visibleTx = filterAcc
    ? (transactions || []).filter(t => t.account_id === filterAcc)
    : (transactions || [])

  const selectedAccName = filterAcc ? accounts?.find(a => a.id === filterAcc)?.name : null

  return (
    <>
      {/* Account balance cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10, marginBottom: 14 }}>
        {!accounts
          ? <div className="loading"><span className="spinner" />Loading...</div>
          : accounts.map(acc => {
              const bal = getBalance(acc.id)
              const active = filterAcc === acc.id
              return (
                <div
                  key={acc.id}
                  className="bal-card"
                  onClick={() => setFilterAcc(f => f === acc.id ? '' : acc.id)}
                  style={{ cursor: 'pointer', outline: active ? '2px solid var(--brand)' : 'none', transition: 'outline 0.1s' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div>
                      <span className={`badge ${TYPE_BADGE[acc.type]}`} style={{ marginBottom: 4 }}>{TYPE_LABEL[acc.type]}</span>
                      <div style={{ fontWeight: 600, fontSize: 13, marginTop: 4 }}>{acc.name}</div>
                    </div>
                    <button
                      className="btn btn-sm"
                      onClick={e => { e.stopPropagation(); openEditAcc(acc) }}
                    >Edit</button>
                  </div>
                  <div className={`bal-value ${bal >= 0 ? 'positive' : 'negative'}`} style={{ fontSize: 20 }}>
                    {acc.currency} {fmt(Math.abs(bal))}{bal < 0 ? ' DR' : ''}
                  </div>
                  {active && <div style={{ fontSize: 10, color: 'var(--brand)', marginTop: 6, fontWeight: 500 }}>● filtered below</div>}
                </div>
              )
            })}

        {/* Add account tile */}
        <div
          onClick={openAddAcc}
          style={{
            border: '1.5px dashed var(--b2)', borderRadius: 'var(--r)', padding: '16px 20px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', minHeight: 100, color: 'var(--t3)', gap: 4, transition: 'background 0.12s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
          onMouseLeave={e => e.currentTarget.style.background = ''}
        >
          <span style={{ fontSize: 22 }}>+</span>
          <span style={{ fontSize: 11.5 }}>Add Account</span>
          <span style={{ fontSize: 10, textAlign: 'center' }}>Bank · Mobile Money · Safe</span>
        </div>
      </div>

      {/* Transactions table */}
      <div className="card">
        <div className="card-head">
          <span className="card-title">
            {selectedAccName ? `Transactions — ${selectedAccName}` : 'All Transactions'}
            {filterAcc && (
              <button
                onClick={() => setFilterAcc('')}
                style={{ marginLeft: 8, fontSize: 10, color: 'var(--t3)', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 5px' }}
              >× show all</button>
            )}
          </span>
          <div style={{ display: 'flex', gap: 7 }}>
            <button className="btn btn-sm" onClick={() => exportCSV(
              visibleTx.map(t => ({ Date: t.date, Account: t.accounts?.name, Currency: t.accounts?.currency, Type: t.type, Amount: t.amount, Reason: t.reason })),
              '4fg_ledger.csv'
            )}>↓ CSV</button>
            <button className="btn btn-primary btn-sm" onClick={() => openTx(filterAcc)}>+ Add Entry</button>
          </div>
        </div>

        <div style={{ padding: '9px 16px', background: 'var(--s2)', borderBottom: '1px solid var(--b)', fontSize: 11.5, color: 'var(--t2)' }}>
          Record here: expenses, supplier payments, transfers between accounts.
          Customer payments go on the <strong>Payments</strong> page.
        </div>

        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Account</th><th>Type</th><th>Amount</th><th>Reason</th></tr>
            </thead>
            <tbody>
              {!transactions
                ? <tr><td colSpan="5"><div className="loading"><span className="spinner" />Loading...</div></td></tr>
                : visibleTx.length === 0
                  ? <tr><td colSpan="5"><div className="empty">No entries yet — click "+ Add Entry" to record an expense or transfer</div></td></tr>
                  : visibleTx.map(t => (
                      <tr key={t.id}>
                        <td style={{ color: 'var(--t3)' }}>{t.date}</td>
                        <td style={{ fontWeight: 500 }}>{t.accounts?.name || '—'}</td>
                        <td>
                          <span className={`badge ${t.type === 'in' ? 'badge-g' : 'badge-r'}`}>
                            {t.type === 'in' ? 'Money In' : 'Money Out'}
                          </span>
                        </td>
                        <td className="mono" style={{ fontWeight: 600, color: t.type === 'in' ? 'var(--ok)' : 'var(--er)' }}>
                          {t.type === 'in' ? '+' : '−'}{t.accounts?.currency || 'RWF'} {fmt(t.amount)}
                        </td>
                        <td>{t.reason}</td>
                      </tr>
                    ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Transaction Modal */}
      <Modal open={txModal} onClose={() => setTxModal(false)} title="Add Ledger Entry">
        <div className="alert alert-w">
          For expenses, supplier payments, or transfers between accounts — not for customer payments (use the Payments page for those).
        </div>
        <div className="form-group">
          <label className="form-label">Account *</label>
          <select className="form-input" value={txForm.account_id} onChange={e => setTxForm(f => ({ ...f, account_id: e.target.value }))} autoFocus>
            <option value="">— select account —</option>
            {(accounts || []).map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Type</label>
            <select className="form-input" value={txForm.type} onChange={e => setTxForm(f => ({ ...f, type: e.target.value }))}>
              <option value="out">Money Out (expense / payment / transfer out)</option>
              <option value="in">Money In (deposit / transfer in)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Amount *</label>
            <input className="form-input" type="number" step="0.01" min="0" value={txForm.amount} onChange={e => setTxForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Date</label>
            <input className="form-input" type="date" value={txForm.date} onChange={e => setTxForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Reason *</label>
            <input className="form-input" value={txForm.reason} onChange={e => setTxForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Rent / Supplier payment / Safe → Bank" />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setTxModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveTx} disabled={saving}>{saving ? 'Saving…' : 'Save Entry'}</button>
        </div>
      </Modal>

      {/* Add / Edit Account Modal */}
      <Modal open={accModal} onClose={() => setAccModal(false)} title={accForm.id ? 'Edit Account' : 'Add Account'}>
        <div className="form-group">
          <label className="form-label">Account Name *</label>
          <input
            className="form-input"
            value={accForm.name}
            onChange={e => setAccForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Bank of Kigali, BPR, MTN MoMo, Shop Till"
            autoFocus
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Type</label>
            <select className="form-input" value={accForm.type} onChange={e => setAccForm(f => ({ ...f, type: e.target.value }))}>
              {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Currency</label>
            <select className="form-input" value={accForm.currency} onChange={e => setAccForm(f => ({ ...f, currency: e.target.value }))}>
              <option value="RWF">RWF — Rwandan Franc</option>
              <option value="USD">USD — US Dollar</option>
            </select>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setAccModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveAcc} disabled={saving}>
            {saving ? 'Saving…' : accForm.id ? 'Update Account' : 'Add Account'}
          </button>
        </div>
      </Modal>
    </>
  )
}
