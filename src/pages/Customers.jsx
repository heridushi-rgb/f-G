import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmt, exportCSV } from '../lib/utils'
import { useNotify } from '../lib/notify'
import Modal from '../components/Modal'

const EMPTY_FORM = { id: '', name: '', phone: '', business_name: '', notes: '' }

export default function Customers() {
  const notify = useNotify()
  const [customers, setCustomers] = useState(null)
  const [balances, setBalances] = useState({})   // { customer_id: { invoiced, paid } }
  const [custOrders, setCustOrders] = useState(null)
  const [custPays, setCustPays] = useState(null)
  const [viewCust, setViewCust] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formModal, setFormModal] = useState(false)
  const [viewModal, setViewModal] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const [custRes, itemsRes, paysRes] = await Promise.all([
      sb.from('customers').select('*').order('name'),
      sb.from('order_items').select('qty, unit_price, orders(customer_id)'),
      sb.from('payments').select('amount, customer_id'),
    ])

    const custs = custRes.data || []
    const items = itemsRes.data || []
    const pays = paysRes.data || []

    // Compute per-customer totals
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
  }

  function openNew() {
    setForm(EMPTY_FORM)
    setFormModal(true)
  }

  function openEdit(c) {
    setForm({ id: c.id, name: c.name, phone: c.phone || '', business_name: c.business_name || '', notes: c.notes || '' })
    setFormModal(true)
  }

  async function save() {
    if (!form.name.trim()) { notify('Name is required', 'error'); return }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      phone: form.phone || null,
      business_name: form.business_name || null,
      notes: form.notes || null,
    }
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
    setCustOrders(null)
    setCustPays(null)
    const [ordRes, payRes] = await Promise.all([
      sb.from('orders').select('*, order_items(qty, unit_price)').eq('customer_id', c.id).order('date', { ascending: false }),
      sb.from('payments').select('*').eq('customer_id', c.id).order('date', { ascending: false }),
    ])
    setCustOrders(ordRes.data || [])
    setCustPays(payRes.data || [])
  }

  const STATUS_BADGE = {
    pending:        <span className="badge badge-x">Pending</span>,
    fulfilled:      <span className="badge badge-b">Fulfilled</span>,
    partially_paid: <span className="badge badge-a">Part Paid</span>,
    paid:           <span className="badge badge-g">Paid</span>,
  }

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
                              <button className="btn btn-sm" onClick={() => openView(c)}>History</button>
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

      {/* Customer History */}
      <Modal open={viewModal} onClose={() => setViewModal(false)} title={viewCust?.name || 'Customer'} wide>
        {viewCust && (() => {
          const b = balances[viewCust.id] || { invoiced: 0, paid: 0 }
          const owed = Math.max(0, b.invoiced - b.paid)
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16, padding: '12px 0', borderBottom: '1px solid var(--b)' }}>
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
                    {owed > 0 ? 'RWF ' + fmt(owed) : 'Settled'}
                  </div>
                </div>
              </div>

              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, marginTop: 4 }}>Orders</div>
              <div className="tbl-wrap" style={{ marginBottom: 20 }}>
                <table>
                  <thead><tr><th>Date</th><th>Total (RWF)</th><th>Status</th></tr></thead>
                  <tbody>
                    {!custOrders
                      ? <tr><td colSpan="3"><div className="loading"><span className="spinner" /></div></td></tr>
                      : custOrders.length === 0
                        ? <tr><td colSpan="3"><div className="empty">No orders</div></td></tr>
                        : custOrders.map(o => {
                            const total = (o.order_items || []).reduce((s, i) => s + i.qty * i.unit_price, 0)
                            return (
                              <tr key={o.id}>
                                <td>{o.date}</td>
                                <td className="mono">{fmt(total)}</td>
                                <td>{STATUS_BADGE[o.status] || STATUS_BADGE.pending}</td>
                              </tr>
                            )
                          })}
                  </tbody>
                </table>
              </div>

              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Payments Received</div>
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Amount (RWF)</th><th>Method</th><th>Destination</th><th>Notes</th></tr></thead>
                  <tbody>
                    {!custPays
                      ? <tr><td colSpan="5"><div className="loading"><span className="spinner" /></div></td></tr>
                      : custPays.length === 0
                        ? <tr><td colSpan="5"><div className="empty">No payments recorded</div></td></tr>
                        : custPays.map(p => (
                            <tr key={p.id}>
                              <td>{p.date}</td>
                              <td className="mono" style={{ fontWeight: 600, color: 'var(--ok)' }}>{fmt(p.amount)}</td>
                              <td>{p.method?.replace('_', ' ')}</td>
                              <td><span className={`badge ${p.destination === 'bank' ? 'badge-b' : 'badge-x'}`}>{p.destination}</span></td>
                              <td style={{ color: 'var(--t3)' }}>{p.notes || '—'}</td>
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
