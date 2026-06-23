import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmt, exportCSV } from '../lib/utils'
import { useNotify } from '../lib/notify'
import Modal from '../components/Modal'

const EMPTY_FORM = { account: 'bank', type: 'out', amount: '', reason: '', date: '' }

export default function Ledger() {
  const notify = useNotify()
  const [transactions, setTransactions] = useState(null)
  const [payments, setPayments] = useState(null)   // customer payments (for balance calc)
  const [form, setForm] = useState(EMPTY_FORM)
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const [txRes, payRes] = await Promise.all([
      sb.from('cash_transactions').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }),
      sb.from('payments').select('amount, destination'),
    ])
    setTransactions(txRes.data || [])
    setPayments(payRes.data || [])
  }

  function computeBalance(account) {
    const cts = transactions || []
    const pays = payments || []
    const cashIn = cts.filter(t => t.account === account && t.type === 'in').reduce((s, t) => s + t.amount, 0)
    const cashOut = cts.filter(t => t.account === account && t.type === 'out').reduce((s, t) => s + t.amount, 0)
    const fromPays = pays.filter(p => p.destination === account).reduce((s, p) => s + p.amount, 0)
    return cashIn - cashOut + fromPays
  }

  function openNew() {
    setForm({ ...EMPTY_FORM, date: new Date().toISOString().split('T')[0] })
    setModal(true)
  }

  async function save() {
    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) { notify('Enter a valid amount', 'error'); return }
    if (!form.reason.trim()) { notify('Reason is required', 'error'); return }
    setSaving(true)
    const { error } = await sb.from('cash_transactions').insert({
      account: form.account,
      type: form.type,
      amount,
      reason: form.reason.trim(),
      date: form.date,
    })
    setSaving(false)
    if (error) { notify(error.message, 'error'); return }
    notify('Transaction recorded')
    setModal(false)
    load()
  }

  const bankBal = transactions && payments ? computeBalance('bank') : null
  const safeBal = transactions && payments ? computeBalance('safe') : null

  const txAll = transactions || []

  return (
    <>
      {/* Balance Cards */}
      <div className="two-col" style={{ marginBottom: 14 }}>
        <div className="bal-card">
          <div className="bal-label">Bank Account Balance</div>
          <div className={`bal-value ${bankBal === null ? '' : bankBal >= 0 ? 'positive' : 'negative'}`}>
            {bankBal === null ? '—' : 'RWF ' + fmt(bankBal)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
            Includes customer payments routed to bank
          </div>
        </div>
        <div className="bal-card">
          <div className="bal-label">Cash Safe Balance</div>
          <div className={`bal-value ${safeBal === null ? '' : safeBal >= 0 ? 'positive' : 'negative'}`}>
            {safeBal === null ? '—' : 'RWF ' + fmt(safeBal)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
            Includes cash payments received on-site
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">Manual Ledger Entries</span>
          <div style={{ display: 'flex', gap: 7 }}>
            <button className="btn btn-sm" onClick={() => exportCSV(
              txAll.map(t => ({ Date: t.date, Account: t.account, Type: t.type, Amount_RWF: t.amount, Reason: t.reason })),
              '4fg_ledger.csv'
            )}>↓ CSV</button>
            <button className="btn btn-primary btn-sm" onClick={openNew}>+ Add Entry</button>
          </div>
        </div>

        <div style={{ padding: '10px 16px', background: 'var(--s2)', borderBottom: '1px solid var(--b)', fontSize: 11.5, color: 'var(--t2)' }}>
          Use this page to record: expenses paid from bank or safe, supplier payments, and transfers between bank and safe.
          Customer payments received are recorded on the <strong>Payments</strong> page.
        </div>

        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Account</th><th>Type</th><th>Amount (RWF)</th><th>Reason</th></tr>
            </thead>
            <tbody>
              {!transactions
                ? <tr><td colSpan="5"><div className="loading"><span className="spinner" />Loading...</div></td></tr>
                : txAll.length === 0
                  ? <tr><td colSpan="5"><div className="empty">No ledger entries yet</div></td></tr>
                  : txAll.map(t => (
                      <tr key={t.id}>
                        <td style={{ color: 'var(--t3)' }}>{t.date}</td>
                        <td>
                          <span className={`badge ${t.account === 'bank' ? 'badge-b' : 'badge-x'}`}>
                            {t.account === 'bank' ? 'Bank' : 'Safe'}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${t.type === 'in' ? 'badge-g' : 'badge-r'}`}>
                            {t.type === 'in' ? 'Money In' : 'Money Out'}
                          </span>
                        </td>
                        <td className="mono" style={{ fontWeight: 600, color: t.type === 'in' ? 'var(--ok)' : 'var(--er)' }}>
                          {t.type === 'in' ? '+' : '-'}RWF {fmt(t.amount)}
                        </td>
                        <td>{t.reason}</td>
                      </tr>
                    ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Entry Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Add Ledger Entry">
        <div className="alert alert-w" style={{ marginBottom: 14 }}>
          For expenses, supplier payments, or cash transfers between bank and safe.
          Customer payments go on the Payments page instead.
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Account</label>
            <select className="form-input" value={form.account} onChange={e => setForm(f => ({ ...f, account: e.target.value }))}>
              <option value="bank">Bank Account</option>
              <option value="safe">Cash Safe</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Type</label>
            <select className="form-input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              <option value="out">Money Out (expense / payment / transfer out)</option>
              <option value="in">Money In (deposit / transfer in)</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Amount (RWF) *</label>
            <input className="form-input" type="number" step="1" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Date</label>
            <input className="form-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Reason *</label>
          <input className="form-input" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Supplier payment — Guangzhou shipment / Office rent / Safe to bank transfer" />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Entry'}</button>
        </div>
      </Modal>
    </>
  )
}
