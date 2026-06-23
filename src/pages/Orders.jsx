import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmt, exportCSV } from '../lib/utils'
import { useNotify } from '../lib/notify'
import Modal from '../components/Modal'

const STATUS_META = {
  pending:        { badge: 'badge-x', label: 'Pending' },
  fulfilled:      { badge: 'badge-b', label: 'Fulfilled' },
  partially_paid: { badge: 'badge-a', label: 'Part Paid' },
  paid:           { badge: 'badge-g', label: 'Paid' },
}

const EMPTY_FORM = { customer_id: '', date: '', status: 'pending', notes: '' }
const EMPTY_LINE = { product_id: '', qty: '1', unit_price: '' }

export default function Orders() {
  const notify = useNotify()
  const [orders, setOrders] = useState(null)
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [lines, setLines] = useState([{ ...EMPTY_LINE }])
  const [viewOrder, setViewOrder] = useState(null)
  const [viewItems, setViewItems] = useState(null)
  const [formModal, setFormModal] = useState(false)
  const [viewModal, setViewModal] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const [ordRes, custRes, prodRes] = await Promise.all([
      sb.from('orders')
        .select('*, customers(name), order_items(qty, unit_price)')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false }),
      sb.from('customers').select('id, name').order('name'),
      sb.from('products').select('id, name, sale_price, qty_on_hand, unit').order('name'),
    ])
    setOrders(ordRes.data || [])
    setCustomers(custRes.data || [])
    setProducts(prodRes.data || [])
  }

  const orderTotal = o => (o.order_items || []).reduce((s, i) => s + i.qty * i.unit_price, 0)

  function openNew() {
    setForm({ ...EMPTY_FORM, date: new Date().toISOString().split('T')[0] })
    setLines([{ ...EMPTY_LINE }])
    setFormModal(true)
  }

  function setLine(i, key, val) {
    setLines(ls => {
      const updated = ls.map((l, idx) => idx === i ? { ...l, [key]: val } : l)
      if (key === 'product_id') {
        const prod = products.find(p => p.id === val)
        if (prod) updated[i].unit_price = String(prod.sale_price || '')
      }
      return updated
    })
  }

  const lineTotal = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.unit_price) || 0), 0)

  async function saveOrder() {
    if (!form.customer_id) { notify('Select a customer', 'error'); return }
    const valid = lines.filter(l => l.product_id && parseFloat(l.qty) > 0)
    if (valid.length === 0) { notify('Add at least one line item with a product and quantity', 'error'); return }

    setSaving(true)

    const { data: ord, error: oe } = await sb.from('orders').insert({
      customer_id: form.customer_id,
      date: form.date,
      status: form.status,
      notes: form.notes || null,
    }).select().single()

    if (oe) { setSaving(false); notify(oe.message, 'error'); return }

    const { error: ie } = await sb.from('order_items').insert(
      valid.map(l => ({
        order_id: ord.id,
        product_id: l.product_id,
        qty: parseFloat(l.qty),
        unit_price: parseFloat(l.unit_price) || 0,
      }))
    )
    if (ie) { setSaving(false); notify(ie.message, 'error'); return }

    // Deduct inventory now if order is created as fulfilled
    if (form.status === 'fulfilled') {
      await deductInventory(ord.id, valid)
    }

    setSaving(false)
    notify('Order created')
    setFormModal(false)
    load()
  }

  async function deductInventory(orderId, lineItems) {
    for (const line of lineItems) {
      const qty = parseFloat(line.qty)
      const prod = products.find(p => p.id === line.product_id)
      if (!prod) continue
      const newQty = Math.max(0, (prod.qty_on_hand || 0) - qty)
      await Promise.all([
        sb.from('stock_movements').insert({
          product_id: line.product_id,
          type: 'out',
          qty: -qty,
          order_id: orderId,
          date: new Date().toISOString().split('T')[0],
          notes: 'Order fulfillment',
        }),
        sb.from('products').update({ qty_on_hand: newQty }).eq('id', line.product_id),
      ])
    }
  }

  async function fulfillOrder(o) {
    if (!window.confirm('Mark this order as fulfilled and deduct inventory?')) return
    const { data: items } = await sb.from('order_items').select('product_id, qty').eq('order_id', o.id)
    await deductInventory(o.id, items || [])
    await sb.from('orders').update({ status: 'fulfilled' }).eq('id', o.id)
    notify('Order fulfilled — inventory deducted')
    load()
  }

  async function markPaid(o) {
    await sb.from('orders').update({ status: 'paid' }).eq('id', o.id)
    notify('Order marked as paid')
    load()
  }

  async function openView(o) {
    setViewOrder(o)
    setViewModal(true)
    setViewItems(null)
    const { data } = await sb.from('order_items').select('*, products(name, unit)').eq('order_id', o.id)
    setViewItems(data || [])
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <span className="card-title">Orders</span>
          <div style={{ display: 'flex', gap: 7 }}>
            <button className="btn btn-sm" onClick={() => exportCSV(
              (orders || []).map(o => ({
                Date: o.date, Customer: o.customers?.name, Items: (o.order_items || []).length,
                Total_RWF: orderTotal(o), Status: o.status, Notes: o.notes || '',
              })), '4fg_orders.csv'
            )}>↓ CSV</button>
            <button className="btn btn-primary btn-sm" onClick={openNew}>+ New Order</button>
          </div>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Customer</th><th>Items</th><th>Total (RWF)</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {!orders
                ? <tr><td colSpan="6"><div className="loading"><span className="spinner" />Loading...</div></td></tr>
                : orders.length === 0
                  ? <tr><td colSpan="6"><div className="empty">No orders yet</div></td></tr>
                  : orders.map(o => {
                      const total = orderTotal(o)
                      const sm = STATUS_META[o.status] || STATUS_META.pending
                      return (
                        <tr key={o.id}>
                          <td style={{ color: 'var(--t3)' }}>{o.date}</td>
                          <td style={{ fontWeight: 500 }}>{o.customers?.name || '—'}</td>
                          <td className="mono" style={{ color: 'var(--t3)' }}>{(o.order_items || []).length}</td>
                          <td className="mono" style={{ fontWeight: 600 }}>RWF {fmt(total)}</td>
                          <td><span className={`badge ${sm.badge}`}>{sm.label}</span></td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-sm" onClick={() => openView(o)}>View</button>
                              {o.status === 'pending' && (
                                <button className="btn btn-sm btn-primary" onClick={() => fulfillOrder(o)}>Fulfill</button>
                              )}
                              {(o.status === 'fulfilled' || o.status === 'partially_paid') && (
                                <button className="btn btn-sm" onClick={() => markPaid(o)}>Mark Paid</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Order Modal */}
      <Modal open={formModal} onClose={() => setFormModal(false)} title="New Order" wide>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Customer *</label>
            <select className="form-input" value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
              <option value="">— select customer —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Order Date</label>
            <input className="form-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="pending">Pending (inventory held)</option>
              <option value="fulfilled">Fulfilled (deduct inventory now)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <input className="form-input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="optional" />
          </div>
        </div>

        <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, marginTop: 4 }}>
          Line Items
        </div>

        {lines.map((line, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 130px 30px', gap: 6, marginBottom: 6, alignItems: 'end' }}>
            <div>
              {i === 0 && <div className="form-label" style={{ marginBottom: 3 }}>Product</div>}
              <select className="form-input" value={line.product_id} onChange={e => setLine(i, 'product_id', e.target.value)}>
                <option value="">— select —</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} (stock: {fmt(p.qty_on_hand)})</option>
                ))}
              </select>
            </div>
            <div>
              {i === 0 && <div className="form-label" style={{ marginBottom: 3 }}>Qty</div>}
              <input className="form-input" type="number" step="0.01" min="0" value={line.qty} onChange={e => setLine(i, 'qty', e.target.value)} />
            </div>
            <div>
              {i === 0 && <div className="form-label" style={{ marginBottom: 3 }}>Unit Price (RWF)</div>}
              <input className="form-input" type="number" step="1" min="0" value={line.unit_price} onChange={e => setLine(i, 'unit_price', e.target.value)} />
            </div>
            <div>
              {i === 0 && <div className="form-label" style={{ marginBottom: 3 }}>&nbsp;</div>}
              <button
                className="btn btn-sm"
                onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))}
                disabled={lines.length === 1}
                style={{ padding: '8px 9px', color: lines.length > 1 ? 'var(--er)' : 'var(--t3)' }}
              >×</button>
            </div>
          </div>
        ))}

        <button className="btn btn-sm" onClick={() => setLines(ls => [...ls, { ...EMPTY_LINE }])} style={{ marginBottom: 14 }}>+ Add Line</button>

        <div style={{ background: 'var(--s2)', padding: '10px 14px', borderRadius: 'var(--rs)', marginBottom: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 12 }}>Order Total: </span>
          <span className="mono" style={{ fontSize: 18, fontWeight: 700, marginLeft: 8 }}>RWF {fmt(lineTotal)}</span>
        </div>

        <div className="form-actions">
          <button className="btn" onClick={() => setFormModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveOrder} disabled={saving}>{saving ? 'Saving…' : 'Create Order'}</button>
        </div>
      </Modal>

      {/* View Order Modal */}
      <Modal open={viewModal} onClose={() => setViewModal(false)} title="Order Details" wide>
        {viewOrder && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 16, padding: '12px 0', borderBottom: '1px solid var(--b)' }}>
              <div>
                <div className="form-label">Customer</div>
                <div style={{ fontWeight: 600, marginTop: 2 }}>{viewOrder.customers?.name || '—'}</div>
              </div>
              <div>
                <div className="form-label">Date</div>
                <div style={{ marginTop: 2 }}>{viewOrder.date}</div>
              </div>
              <div>
                <div className="form-label">Status</div>
                <div style={{ marginTop: 4 }}>
                  <span className={`badge ${STATUS_META[viewOrder.status]?.badge}`}>{STATUS_META[viewOrder.status]?.label}</span>
                </div>
              </div>
            </div>
            {viewOrder.notes && (
              <div className="alert alert-w" style={{ marginBottom: 14 }}>Note: {viewOrder.notes}</div>
            )}
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr><th>Product</th><th>Qty</th><th>Unit Price (RWF)</th><th>Subtotal (RWF)</th></tr>
                </thead>
                <tbody>
                  {!viewItems
                    ? <tr><td colSpan="4"><div className="loading"><span className="spinner" /></div></td></tr>
                    : viewItems.map(item => (
                        <tr key={item.id}>
                          <td style={{ fontWeight: 500 }}>{item.products?.name || '—'}</td>
                          <td className="mono">{fmt(item.qty)} {item.products?.unit}</td>
                          <td className="mono">{fmt(item.unit_price)}</td>
                          <td className="mono" style={{ fontWeight: 600 }}>{fmt(item.qty * item.unit_price)}</td>
                        </tr>
                      ))}
                  {viewItems && viewItems.length > 0 && (
                    <tr style={{ background: 'var(--s2)' }}>
                      <td colSpan="3" style={{ fontWeight: 600 }}>Total</td>
                      <td className="mono" style={{ fontWeight: 700, fontSize: 15 }}>
                        RWF {fmt(viewItems.reduce((s, i) => s + i.qty * i.unit_price, 0))}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
