import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmt, exportCSV } from '../lib/utils'
import { useNotify } from '../lib/notify'
import Modal from '../components/Modal'

const EMPTY_FORM = { id: '', name: '', phone: '', business_name: '', notes: '' }
const EMPTY_PAY  = { order_id: '', amount: '', account_id: '', date: '' }
const METHOD_LABEL = { mobile_money: 'Mobile Money', cash: 'Cash', bank_transfer: 'Bank Transfer', check: 'Check' }

const STATUS_BADGE = {
  pending:        <span className="badge badge-x">Pending</span>,
  fulfilled:      <span className="badge badge-b">Fulfilled</span>,
  partially_paid: <span className="badge badge-a">Part Paid</span>,
  paid:           <span className="badge badge-g">Paid</span>,
}

export default function Customers() {
  const notify = useNotify()
  const [customers, setCustomers] = useState(null)
  const [balances, setBalances] = useState({})
  const [accounts, setAccounts] = useState([])
  const [custOrders, setCustOrders] = useState(null)
  const [custPays, setCustPays] = useState(null)
  const [viewCust, setViewCust] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [payForm, setPayForm] = useState(EMPTY_PAY)
  const [formModal, setFormModal] = useState(false)
  const [viewModal, setViewModal] = useState(false)
  const [paySection, setPaySection] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const [custRes, itemsRes, paysRes, accRes] = await Promise.all([
      sb.from('customers').select('*').order('name'),
      sb.from('order_items').select('qty, unit_price, orders(customer_id)'),
      sb.from('payments').select('amount, customer_id'),
      sb.from('accounts').select('*').order('sort_order').order('created_at'),
    ])

    const custs = custRes.data || []
    const items = itemsRes.data || []
    const pays  = paysRes.data || []

    const bals = {}
    for (const item of items) {
      const cid = item.orders?.customer_id
      if (!cid) continue
      if (!bals[cid]) bals[cid] = { invoiced: 0, paid: 0 }
      bals[cid].invoiced += item.qty * item.unit_price
    }
    for (const pay of pays) {
      if (!pay.customer_id) continue
      if (!bals[pay.customer_id]) bals[pay.customer_id] = { invoiced: 0, paid: 0 }
      bals[pay.customer_id].paid += pay.amount
    }

    setCustomers(custs)
    setBalances(bals)
    setAccounts(accRes.data || [])
  }

  function openNew() { setForm(EMPTY_FORM); setFormModal(true) }
  function openEdit(c) {
    setForm({ id: c.id, name: c.name, phone: c.phone || '', business_name: c.business_name || '', notes: c.notes || '' })
    setFormModal(true)
  }

  async function save() {
    if (!form.name.trim()) { notify('Name is required', 'error'); return }
    setSaving(true)
    const payload = { name: form.name.trim(), phone: form.phone || null, business_name: form.business_name || null, notes: form.notes || null }
    const { error } = form.id
      ? await sb.from('customers').update(payload).eq('id', form.id)
      : await sb.from('customers').insert(payload)
    setSaving(false)
    if (error) { notify(error.message, 'error'); return }
    notify(form.id ? 'Customer updated' : 'Customer added')
    setFormModal(false)
    load()
  }

  async function openView(c) {
    setViewCust(c)
    setViewModal(true)
    setPaySection(false)
    setCustOrders(null)
    setCustPays(null)
    setPayForm({ ...EMPTY_PAY, date: new Date().toISOString().split('T')[0], account_id: accounts[0]?.id || '' })
    const [ordRes, payRes] = await Promise.all([
      sb.from('orders').select('id, date, status, order_items(qty, unit_price)').eq('customer_id', c.id).order('date', { ascending: false }),
      sb.from('payments').select('*, accounts(name, currency)').eq('customer_id', c.id).order('date', { ascending: false }),
    ])
    setCustOrders(ordRes.data || [])
    setCustPays(payRes.data || [])
  }

  async function savePayment() {
    const amount = parseFloat(payForm.amount)
    if (!amount || amount <= 0) { notify('Enter a valid amount', 'error'); return }
    if (!payForm.account_id) { notify('Select which account to deposit into', 'error'); return }
    setSaving(true)

    const { error } = await sb.from('payments').insert({
      customer_id: viewCust.id,
      order_id: payForm.order_id || null,
      amount,
      account_id: payForm.account_id,
      date: payForm.date,
    })
    if (error) { setSaving(false); notify(error.message, 'error'); return }

    // Auto ledger entry
    await sb.from('cash_transactions').insert({
      account_id: payForm.account_id,
      type: 'in',
      amount,
      reason: `Payment from ${viewCust.name}${payForm.order_id ? ' (order)' : ''}`,
      date: payForm.date,
    })

    // Update order status if linked
    if (payForm.order_id) {
      const ord = custOrders?.find(o => o.id === payForm.order_id)
      const orderTotal = (ord?.order_items || []).reduce((s, i) => s + i.qty * i.unit_price, 0)
      const existingPaid = (custPays || []).filter(p => p.order_id === payForm.order_id).reduce((s, p) => s + p.amount, 0)
      const totalPaidNow = existingPaid + amount
      const newStatus = totalPaidNow >= orderTotal ? 'paid' : 'partially_paid'
      await sb.from('orders').update({ status: newStatus }).eq('id', payForm.order_id)
    }

    setSaving(false)
    notify('Payment recorded — ledger updated')
    setPaySection(false)
    // Refresh the view data and balances
    await openView(viewCust)
    load()
  }

  // Build a combined chronological statement for the history view
  function buildStatement(orders, pays) {
    const events = []
    for (const o of (orders || [])) {
      const total = (o.order_items || []).reduce((s, i) => s + i.qty * i.unit_price, 0)
      events.push({ date: o.date, type: 'order', label: 'Order', sub: STATUS_BADGE[o.status] || STATUS_BADGE.pending, debit: total, credit: 0, id: o.id })
    }
    for (const p of (pays || [])) {
      events.push({ date: p.date, type: 'payment', label: `Payment (${METHOD_LABEL[p.method] || p.method})`, sub: p.accounts?.name || '—', debit: 0, credit: p.amount, id: p.id })
    }
    // Sort oldest first so running balance makes sense, then reverse for display
    events.sort((a, b) => a.date.localeCompare(b.date))
    let running = 0
    for (const e of events) {
      running += e.debit - e.credit
      e.balance = running
    }
    events.reverse() // newest on top
    return events
  }

  // For the payment form: orders that are not fully paid
  const unpaidOrders = (custOrders || []).filter(o => o.status !== 'paid')

  return (
    <>
      <div className="card">
        <div className="card-head">
          <span className="card-title">Customers</span>
          <div style={{ display: 'flex', gap: 7 }}>
            <button className="btn btn-sm" onClick={() => exportCSV(
              (customers || []).map(c => {
                const b = balances[c.id] || { invoiced: 0, paid: 0 }
                return { Name: c.name, Phone: c.phone, BusinessName: c.business_name, TotalInvoiced_RWF: b.invoiced, TotalPaid_RWF: b.paid, BalanceOwed_RWF: Math.max(0, b.invoiced - b.paid) }
              }), '4fg_customers.csv'
            )}>↓ CSV</button>
            <button className="btn btn-primary btn-sm" onClick={openNew}>+ Add Customer</button>
          </div>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Business</th><th>Phone</th><th>Total Invoiced</th><th>Total Paid</th><th>Balance Owed</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {!customers
                ? <tr><td colSpan="7"><div className="loading"><span className="spinner" />Loading...</div></td></tr>
                : customers.length === 0
                  ? <tr><td colSpan="7"><div className="empty">No customers yet</div></td></tr>
                  : customers.map(c => {
                      const b = balances[c.id] || { invoiced: 0, paid: 0 }
                      const owed = Math.max(0, b.invoiced - b.paid)
                      return (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 500 }}>{c.name}</td>
                          <td style={{ color: 'var(--t3)' }}>{c.business_name || '—'}</td>
                          <td style={{ color: 'var(--t3)' }}>{c.phone || '—'}</td>
                          <td className="mono">RWF {fmt(b.invoiced)}</td>
                          <td className="mono" style={{ color: 'var(--ok)' }}>RWF {fmt(b.paid)}</td>
                          <td className="mono" style={{ fontWeight: 600, color: owed > 0 ? 'var(--er)' : 'var(--t3)' }}>
                            {owed > 0 ? 'RWF ' + fmt(owed) : '—'}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-sm" onClick={() => openView(c)}>Statement</button>
                              <button className="btn btn-sm" onClick={() => openEdit(c)}>Edit</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Customer */}
      <Modal open={formModal} onClose={() => setFormModal(false)} title={form.id ? 'Edit Customer' : 'Add Customer'}>
        <div className="form-group">
          <label className="form-label">Full Name *</label>
          <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Jean-Pierre Habimana" autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">Business Name</label>
          <input className="form-input" value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))} placeholder="e.g. Sunrise Boutique (optional)" />
        </div>
        <div className="form-group">
          <label className="form-label">Phone</label>
          <input className="form-input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+250 7XX XXX XXX" />
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <input className="form-input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="optional" />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setFormModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Customer'}</button>
        </div>
      </Modal>

      {/* Customer Statement & Payment Modal */}
      <Modal open={viewModal} onClose={() => setViewModal(false)} title={viewCust?.name || 'Customer'} wide>
        {viewCust && (() => {
          const b = balances[viewCust.id] || { invoiced: 0, paid: 0 }
          const owed = Math.max(0, b.invoiced - b.paid)
          const statement = buildStatement(custOrders, custPays)

          return (
            <>
              {/* Summary header */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16, padding: '12px 14px', background: 'var(--s2)', borderRadius: 'var(--rs)' }}>
                <div>
                  <div className="form-label">Total Invoiced</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>RWF {fmt(b.invoiced)}</div>
                </div>
                <div>
                  <div className="form-label">Total Paid</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ok)', marginTop: 4 }}>RWF {fmt(b.paid)}</div>
                </div>
                <div>
                  <div className="form-label">Balance Owed</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 600, color: owed > 0 ? 'var(--er)' : 'var(--t3)', marginTop: 4 }}>
                    {owed > 0 ? 'RWF ' + fmt(owed) : 'Settled ✓'}
                  </div>
                </div>
              </div>

              {/* Record Payment section */}
              {owed > 0 && !paySection && (
                <button className="btn btn-primary btn-sm" onClick={() => setPaySection(true)} style={{ marginBottom: 14 }}>
                  + Record Payment
                </button>
              )}

              {paySection && (
                <div style={{ marginBottom: 16, padding: '14px', background: 'var(--brand-l)', borderRadius: 'var(--r)', border: '1px solid #b8ddc9' }}>
                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10, color: 'var(--brand-d)' }}>
                    Record Payment from {viewCust.name}
                  </div>
                  {unpaidOrders.length > 0 && (
                    <div className="form-group">
                      <label className="form-label">Link to Order (optional)</label>
                      <select className="form-input" value={payForm.order_id} onChange={e => setPayForm(f => ({ ...f, order_id: e.target.value }))}>
                        <option value="">— general balance payment —</option>
                        {unpaidOrders.map(o => {
                          const t = (o.order_items || []).reduce((s, i) => s + i.qty * i.unit_price, 0)
                          return <option key={o.id} value={o.id}>{o.date} — RWF {fmt(t)} ({o.status})</option>
                        })}
                      </select>
                    </div>
                  )}
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Amount (RWF) *</label>
                      <input
                        className="form-input"
                        type="number" step="1" min="0"
                        value={payForm.amount}
                        onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                        placeholder={fmt(owed)}
                        autoFocus
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Date</label>
                      <input className="form-input" type="date" value={payForm.date} onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Deposit Into *</label>
                    <select className="form-input" value={payForm.account_id} onChange={e => setPayForm(f => ({ ...f, account_id: e.target.value }))}>
                      <option value="">— select account —</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 7 }}>
                    <button className="btn" onClick={() => setPaySection(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={savePayment} disabled={saving}>{saving ? 'Saving…' : 'Confirm Payment'}</button>
                  </div>
                </div>
              )}

              {/* Flowing balance statement */}
              <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Account Statement
              </div>
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Detail</th>
                      <th style={{ color: 'var(--er)' }}>Charged (RWF)</th>
                      <th style={{ color: 'var(--ok)' }}>Paid (RWF)</th>
                      <th>Running Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!custOrders
                      ? <tr><td colSpan="6"><div className="loading"><span className="spinner" /></div></td></tr>
                      : statement.length === 0
                        ? <tr><td colSpan="6"><div className="empty">No history yet</div></td></tr>
                        : statement.map((e, i) => (
                            <tr key={`${e.type}-${e.id}`} style={{ background: e.type === 'payment' ? '#f6fdf9' : '' }}>
                              <td style={{ color: 'var(--t3)' }}>{e.date}</td>
                              <td style={{ fontWeight: 500 }}>{e.label}</td>
                              <td>{e.sub}</td>
                              <td className="mono" style={{ color: 'var(--er)' }}>
                                {e.debit > 0 ? fmt(e.debit) : ''}
                              </td>
                              <td className="mono" style={{ color: 'var(--ok)', fontWeight: e.type === 'payment' ? 600 : 400 }}>
                                {e.credit > 0 ? fmt(e.credit) : ''}
                              </td>
                              <td className="mono" style={{ fontWeight: 600, color: e.balance > 0 ? 'var(--er)' : e.balance < 0 ? 'var(--ok)' : 'var(--t3)' }}>
                                {e.balance === 0 ? 'Settled' : (e.balance > 0 ? '' : '−') + 'RWF ' + fmt(Math.abs(e.balance))}
                              </td>
                            </tr>
                          ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        })()}
      </Modal>
    </>
  )
}
