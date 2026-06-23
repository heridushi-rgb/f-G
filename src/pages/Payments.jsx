import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmt, exportCSV } from '../lib/utils'
import { useNotify } from '../lib/notify'
import Modal from '../components/Modal'

const EMPTY_FORM = { customer_id: '', order_id: '', amount: '', account_id: '', date: '', notes: '' }

export default function Payments() {
  const notify = useNotify()
  const [payments, setPayments] = useState(null)
  const [customers, setCustomers] = useState([])
  const [accounts, setAccounts] = useState([])
  const [custOrders, setCustOrders] = useState([])
  const [orderPaid, setOrderPaid] = useState(0)   // total already paid on selected order
  const [form, setForm] = useState(EMPTY_FORM)
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const [payRes, custRes, accRes] = await Promise.all([
      sb.from('payments')
        .select('*, customers(name), orders(date), accounts(name, currency)')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100),
      sb.from('customers').select('id, name').order('name'),
      sb.from('accounts').select('*').order('sort_order').order('created_at'),
    ])
    setPayments(payRes.data || [])
    setCustomers(custRes.data || [])
    setAccounts(accRes.data || [])
  }

  async function onCustomerChange(customerId) {
    setForm(f => ({ ...f, customer_id: customerId, order_id: '' }))
    setOrderPaid(0)
    if (!customerId) { setCustOrders([]); return }
    const { data } = await sb.from('orders')
      .select('id, date, status, order_items(qty, unit_price)')
      .eq('customer_id', customerId)
      .neq('status', 'paid')
      .order('date', { ascending: false })
    setCustOrders(data || [])
  }

  async function onOrderChange(orderId) {
    setForm(f => ({ ...f, order_id: orderId }))
    if (!orderId) { setOrderPaid(0); return }
    const { data } = await sb.from('payments').select('amount').eq('order_id', orderId)
    setOrderPaid((data || []).reduce((s, p) => s + p.amount, 0))
  }

  function openNew() {
    const defaultAcc = accounts[0]?.id || ''
    setForm({ ...EMPTY_FORM, date: new Date().toISOString().split('T')[0], account_id: defaultAcc })
    setCustOrders([])
    setOrderPaid(0)
    setModal(true)
  }

  async function save() {
    const amount = parseFloat(form.amount)
    if (!form.customer_id) { notify('Select a customer', 'error'); return }
    if (!amount || amount <= 0) { notify('Enter a valid amount', 'error'); return }
    if (!form.account_id) { notify('Select which account the money goes into', 'error'); return }
    setSaving(true)

    // Record the payment
    const { error } = await sb.from('payments').insert({
      customer_id: form.customer_id,
      order_id: form.order_id || null,
      amount,
      account_id: form.account_id,
      date: form.date,
      notes: form.notes || null,
    })
    if (error) { setSaving(false); notify(error.message, 'error'); return }

    // Auto-create a ledger entry so it shows up in account balance
    const custName = customers.find(c => c.id === form.customer_id)?.name || 'Customer'
    await sb.from('cash_transactions').insert({
      account_id: form.account_id,
      type: 'in',
      amount,
      reason: `Payment received from ${custName}${form.order_id ? ' (order)' : ''}`,
      date: form.date,
    })

    // Update order status based on total paid vs order total
    if (form.order_id) {
      const ord = custOrders.find(o => o.id === form.order_id)
      const orderTotal = (ord?.order_items || []).reduce((s, i) => s + i.qty * i.unit_price, 0)
      const totalPaidNow = orderPaid + amount
      const newStatus = totalPaidNow >= orderTotal ? 'paid' : 'partially_paid'
      await sb.from('orders').update({ status: newStatus }).eq('id', form.order_id)
    }

    setSaving(false)
    notify('Payment recorded and added to ledger')
    setModal(false)
    load()
  }

  // Order summary for the selected order
  const selectedOrder = custOrders.find(o => o.id === form.order_id)
  const orderTotal = selectedOrder ? (selectedOrder.order_items || []).reduce((s, i) => s + i.qty * i.unit_price, 0) : 0
  const orderRemaining = Math.max(0, orderTotal - orderPaid)

  return (
    <>
      <div className="card">
        <div className="card-head">
          <span className="card-title">Customer Payments</span>
          <div style={{ display: 'flex', gap: 7 }}>
            <button className="btn btn-sm" onClick={() => exportCSV(
              (payments || []).map(p => ({
                Date: p.date, Customer: p.customers?.name, Amount: p.amount,
                Method: p.method, Account: p.accounts?.name, Currency: p.accounts?.currency,
                OrderDate: p.orders?.date || '', Notes: p.notes || '',
              })), '4fg_payments.csv'
            )}>↓ CSV</button>
            <button className="btn btn-primary btn-sm" onClick={openNew}>+ Record Payment</button>
          </div>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Customer</th><th>Amount</th><th>Into Account</th><th>Linked Order</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {!payments
                ? <tr><td colSpan="6"><div className="loading"><span className="spinner" />Loading...</div></td></tr>
                : payments.length === 0
                  ? <tr><td colSpan="6"><div className="empty">No payments recorded yet</div></td></tr>
                  : payments.map(p => (
                      <tr key={p.id}>
                        <td style={{ color: 'var(--t3)' }}>{p.date}</td>
                        <td style={{ fontWeight: 500 }}>{p.customers?.name || '—'}</td>
                        <td className="mono" style={{ fontWeight: 600, color: 'var(--ok)' }}>
                          {p.accounts?.currency || 'RWF'} {fmt(p.amount)}
                        </td>
                        <td style={{ fontWeight: 500 }}>{p.accounts?.name || '—'}</td>
                        <td style={{ color: 'var(--t3)' }}>{p.orders?.date || '—'}</td>
                        <td style={{ color: 'var(--t3)' }}>{p.notes || '—'}</td>
                      </tr>
                    ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Payment Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Record Payment from Customer" wide>
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
            <select className="form-input" value={form.order_id} onChange={e => onOrderChange(e.target.value)}>
              <option value="">— general balance payment —</option>
              {custOrders.map(o => {
                const t = (o.order_items || []).reduce((s, i) => s + i.qty * i.unit_price, 0)
                return <option key={o.id} value={o.id}>{o.date} — RWF {fmt(t)} ({o.status})</option>
              })}
            </select>
          </div>
        )}

        {/* Order balance summary */}
        {form.order_id && selectedOrder && (
          <div style={{ background: 'var(--s2)', borderRadius: 'var(--rs)', padding: '10px 14px', marginBottom: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <div className="form-label">Order Total</div>
              <div className="mono" style={{ fontWeight: 600 }}>RWF {fmt(orderTotal)}</div>
            </div>
            <div>
              <div className="form-label">Already Paid</div>
              <div className="mono" style={{ fontWeight: 600, color: 'var(--ok)' }}>RWF {fmt(orderPaid)}</div>
            </div>
            <div>
              <div className="form-label">Still Owed</div>
              <div className="mono" style={{ fontWeight: 600, color: orderRemaining > 0 ? 'var(--er)' : 'var(--ok)' }}>
                {orderRemaining > 0 ? `RWF ${fmt(orderRemaining)}` : 'Settled'}
              </div>
            </div>
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Amount (RWF) *</label>
            <input
              className="form-input"
              type="number" step="1" min="0"
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              placeholder={orderRemaining > 0 ? fmt(orderRemaining) : '0'}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Date</label>
            <input className="form-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Money Goes Into *</label>
          <select className="form-input" value={form.account_id} onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}>
            <option value="">— select account —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
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
