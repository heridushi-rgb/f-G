import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmt, exportCSV } from '../lib/utils'
import { useNotify } from '../lib/notify'
import Modal from '../components/Modal'

const METHODS = ['cash', 'mobile_money', 'bank_transfer', 'check']
const METHOD_LABEL = { cash: 'Cash', mobile_money: 'Mobile Money', bank_transfer: 'Bank Transfer', check: 'Check' }

// Default destination based on payment method
function defaultDestination(method) {
  return method === 'cash' ? 'safe' : 'bank'
}

const EMPTY_FORM = {
  customer_id: '', order_id: '', amount: '', method: 'cash',
  destination: 'safe', date: '', notes: '',
}

export default function Payments() {
  const notify = useNotify()
  const [payments, setPayments] = useState(null)
  const [customers, setCustomers] = useState([])
  const [custOrders, setCustOrders] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const [payRes, custRes] = await Promise.all([
      sb.from('payments').select('*, customers(name), orders(date)').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(100),
      sb.from('customers').select('id, name').order('name'),
    ])
    setPayments(payRes.data || [])
    setCustomers(custRes.data || [])
  }

  async function onCustomerChange(customerId) {
    setForm(f => ({ ...f, customer_id: customerId, order_id: '' }))
    if (!customerId) { setCustOrders([]); return }
    const { data } = await sb.from('orders').select('id, date, status, order_items(qty, unit_price)').eq('customer_id', customerId).order('date', { ascending: false })
    setCustOrders(data || [])
  }

  function onMethodChange(method) {
    setForm(f => ({ ...f, method, destination: defaultDestination(method) }))
  }

  function openNew() {
    setForm({ ...EMPTY_FORM, date: new Date().toISOString().split('T')[0] })
    setCustOrders([])
    setModal(true)
  }

  async function save() {
    const amount = parseFloat(form.amount)
    if (!form.customer_id) { notify('Select a customer', 'error'); return }
    if (!amount || amount <= 0) { notify('Enter a valid amount', 'error'); return }
    setSaving(true)
    const { error } = await sb.from('payments').insert({
      customer_id: form.customer_id,
      order_id: form.order_id || null,
      amount,
      method: form.method,
      destination: form.destination,
      date: form.date,
      notes: form.notes || null,
    })
    // Update order status to partially_paid if linked and not already paid
    if (!error && form.order_id) {
      const ord = custOrders.find(o => o.id === form.order_id)
      if (ord && ord.status !== 'paid') {
        await sb.from('orders').update({ status: 'partially_paid' }).eq('id', form.order_id)
      }
    }
    setSaving(false)
    if (error) { notify(error.message, 'error'); return }
    notify('Payment recorded')
    setModal(false)
    load()
  }

  const orderLabel = o => {
    const total = (o.order_items || []).reduce((s, i) => s + i.qty * i.unit_price, 0)
    return `${o.date} — RWF ${fmt(total)} (${o.status})`
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <span className="card-title">Customer Payments</span>
          <div style={{ display: 'flex', gap: 7 }}>
            <button className="btn btn-sm" onClick={() => exportCSV(
              (payments || []).map(p => ({
                Date: p.date, Customer: p.customers?.name, Amount_RWF: p.amount,
                Method: p.method, Destination: p.destination,
                OrderDate: p.orders?.date || '', Notes: p.notes || '',
              })), '4fg_payments.csv'
            )}>↓ CSV</button>
            <button className="btn btn-primary btn-sm" onClick={openNew}>+ Record Payment</button>
          </div>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Customer</th><th>Amount (RWF)</th><th>Method</th><th>Goes To</th><th>Linked Order</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {!payments
                ? <tr><td colSpan="7"><div className="loading"><span className="spinner" />Loading...</div></td></tr>
                : payments.length === 0
                  ? <tr><td colSpan="7"><div className="empty">No payments recorded yet</div></td></tr>
                  : payments.map(p => (
                      <tr key={p.id}>
                        <td style={{ color: 'var(--t3)' }}>{p.date}</td>
                        <td style={{ fontWeight: 500 }}>{p.customers?.name || '—'}</td>
                        <td className="mono" style={{ fontWeight: 600, color: 'var(--ok)' }}>RWF {fmt(p.amount)}</td>
                        <td>{METHOD_LABEL[p.method] || p.method}</td>
                        <td>
                          <span className={`badge ${p.destination === 'bank' ? 'badge-b' : 'badge-x'}`}>
                            {p.destination === 'bank' ? 'Bank' : 'Safe'}
                          </span>
                        </td>
                        <td style={{ color: 'var(--t3)' }}>{p.orders?.date || '—'}</td>
                        <td style={{ color: 'var(--t3)' }}>{p.notes || '—'}</td>
                      </tr>
                    ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Payment Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Record Payment from Customer">
        <div className="form-group">
          <label className="form-label">Customer *</label>
          <select className="form-input" value={form.customer_id} onChange={e => onCustomerChange(e.target.value)}>
            <option value="">— select customer —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {custOrders.length > 0 && (
          <div className="form-group">
            <label className="form-label">Link to Order (optional)</label>
            <select className="form-input" value={form.order_id} onChange={e => setForm(f => ({ ...f, order_id: e.target.value }))}>
              <option value="">— general payment (no specific order) —</option>
              {custOrders.map(o => <option key={o.id} value={o.id}>{orderLabel(o)}</option>)}
            </select>
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Amount (RWF) *</label>
            <input className="form-input" type="number" step="1" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
          </div>
          <div className="form-group">
            <label className="form-label">Date</label>
            <input className="form-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Payment Method</label>
            <select className="form-input" value={form.method} onChange={e => onMethodChange(e.target.value)}>
              {METHODS.map(m => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Money Goes To</label>
            <select className="form-input" value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}>
              <option value="safe">Cash Safe</option>
              <option value="bank">Bank Account</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Notes (optional)</label>
          <input className="form-input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. MoMo ref: TX-123456" />
        </div>

        <div className="form-actions">
          <button className="btn" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Record Payment'}</button>
        </div>
      </Modal>
    </>
  )
}
