import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmt, exportCSV } from '../lib/utils'
import { useNotify } from '../lib/notify'
import Modal from '../components/Modal'

const UNITS = ['piece', 'box', 'kg', 'set', 'carton', 'bag', 'litre', 'pair', 'roll', 'other']
const COUNTRIES = ['China', 'Kenya', 'Other']

const EMPTY_PROD = { id: '', name: '', sku: '', category: '', supplier_country: 'China', unit: 'piece', cost_price: '', sale_price: '', qty_on_hand: '', reorder_level: '' }

function generateSKU(name, category) {
  const prefix = (category || name || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'PRD'
  const suffix = Math.floor(1000 + Math.random() * 9000)
  return `${prefix}-${suffix}`
}
const EMPTY_STOCK_IN = { product_id: '', qty: '', unit_cost: '', supplier_note: '', date: '', notes: '' }
const EMPTY_ADJUST = { product_id: '', direction: 'out', qty: '', notes: '' }

function stockStatus(p) {
  if (p.qty_on_hand === 0) return { badge: 'badge-r', label: 'Out' }
  if (p.reorder_level > 0 && p.qty_on_hand <= p.reorder_level * 0.5) return { badge: 'badge-r', label: 'Critical' }
  if (p.reorder_level > 0 && p.qty_on_hand <= p.reorder_level) return { badge: 'badge-a', label: 'Low' }
  return { badge: 'badge-g', label: 'OK' }
}

export default function Inventory() {
  const notify = useNotify()
  const [products, setProducts] = useState(null)
  const [movements, setMovements] = useState(null)
  const [histProduct, setHistProduct] = useState(null)
  const [form, setForm] = useState(EMPTY_PROD)
  const [stockIn, setStockIn] = useState(EMPTY_STOCK_IN)
  const [adjust, setAdjust] = useState(EMPTY_ADJUST)
  const [formModal, setFormModal] = useState(false)
  const [stockInModal, setStockInModal] = useState(false)
  const [adjustModal, setAdjustModal] = useState(false)
  const [histModal, setHistModal] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await sb.from('products').select('*').order('name')
    setProducts(data || [])
  }

  // --- Add / Edit product ---
  function openNew() {
    setForm(EMPTY_PROD)
    setFormModal(true)
  }

  function openEdit(p) {
    setForm({
      id: p.id, name: p.name, sku: p.sku || '', category: p.category || '',
      supplier_country: p.supplier_country || 'China', unit: p.unit || 'piece',
      cost_price: p.cost_price ?? '', sale_price: p.sale_price ?? '',
      qty_on_hand: p.qty_on_hand ?? '', reorder_level: p.reorder_level ?? '',
    })
    setFormModal(true)
  }

  async function saveProduct() {
    if (!form.name.trim()) { notify('Product name is required', 'error'); return }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      sku: form.sku || null,
      category: form.category || null,
      supplier_country: form.supplier_country || null,
      unit: form.unit || 'piece',
      cost_price: parseFloat(form.cost_price) || 0,
      sale_price: parseFloat(form.sale_price) || 0,
      qty_on_hand: parseFloat(form.qty_on_hand) || 0,
      reorder_level: parseFloat(form.reorder_level) || 0,
    }
    const { error } = form.id
      ? await sb.from('products').update(payload).eq('id', form.id)
      : await sb.from('products').insert(payload)
    setSaving(false)
    if (error) { notify(error.message, 'error'); return }
    notify(form.id ? 'Product updated' : 'Product added')
    setFormModal(false)
    load()
  }

  // --- Stock In ---
  function openStockIn(p) {
    setStockIn({ ...EMPTY_STOCK_IN, product_id: p?.id || '', date: new Date().toISOString().split('T')[0] })
    setStockInModal(true)
  }

  async function saveStockIn() {
    const qty = parseFloat(stockIn.qty)
    if (!stockIn.product_id) { notify('Select a product', 'error'); return }
    if (!qty || qty <= 0) { notify('Enter a valid quantity', 'error'); return }
    setSaving(true)
    const { error: me } = await sb.from('stock_movements').insert({
      product_id: stockIn.product_id,
      type: 'in',
      qty,
      unit_cost: parseFloat(stockIn.unit_cost) || null,
      supplier_note: stockIn.supplier_note || null,
      notes: stockIn.notes || null,
      date: stockIn.date,
    })
    if (me) { setSaving(false); notify(me.message, 'error'); return }
    const prod = products.find(p => p.id === stockIn.product_id)
    await sb.from('products').update({ qty_on_hand: (prod.qty_on_hand || 0) + qty }).eq('id', stockIn.product_id)
    setSaving(false)
    notify('Stock received')
    setStockInModal(false)
    load()
  }

  // --- Manual Adjustment ---
  function openAdjust(p) {
    setAdjust({ ...EMPTY_ADJUST, product_id: p?.id || '' })
    setAdjustModal(true)
  }

  async function saveAdjust() {
    const qty = parseFloat(adjust.qty)
    if (!adjust.product_id) { notify('Select a product', 'error'); return }
    if (!qty || qty <= 0) { notify('Enter a valid quantity', 'error'); return }
    const prod = products.find(p => p.id === adjust.product_id)
    const delta = adjust.direction === 'in' ? qty : -qty
    const newQty = (prod.qty_on_hand || 0) + delta
    if (newQty < 0) { notify('Stock cannot go below 0', 'error'); return }
    setSaving(true)
    await sb.from('stock_movements').insert({
      product_id: adjust.product_id,
      type: 'adjustment',
      qty: delta,
      notes: adjust.notes || null,
      date: new Date().toISOString().split('T')[0],
    })
    await sb.from('products').update({ qty_on_hand: newQty }).eq('id', adjust.product_id)
    setSaving(false)
    notify('Stock adjusted')
    setAdjustModal(false)
    load()
  }

  // --- History ---
  async function openHistory(p) {
    setHistProduct(p)
    setHistModal(true)
    setMovements(null)
    const { data } = await sb.from('stock_movements').select('*').eq('product_id', p.id).order('date', { ascending: false }).order('created_at', { ascending: false }).limit(60)
    setMovements(data || [])
  }

  const prodOptions = (products || []).map(p => (
    <option key={p.id} value={p.id}>{p.name} (on hand: {fmt(p.qty_on_hand)})</option>
  ))

  return (
    <>
      <div className="card">
        <div className="card-head">
          <span className="card-title">Products & Inventory</span>
          <div style={{ display: 'flex', gap: 7 }}>
            <button className="btn btn-sm" onClick={() => exportCSV((products || []).map(p => ({
              Name: p.name, SKU: p.sku, Category: p.category, Supplier: p.supplier_country,
              Unit: p.unit, CostPrice_RWF: p.cost_price, SalePrice_RWF: p.sale_price,
              QtyOnHand: p.qty_on_hand, ReorderLevel: p.reorder_level,
            })), '4fg_inventory.csv')}>↓ CSV</button>
            <button className="btn btn-sm" onClick={() => openStockIn(null)}>+ Stock In</button>
            <button className="btn btn-primary btn-sm" onClick={openNew}>+ Add Product</button>
          </div>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>SKU</th><th>Category</th><th>Supplier</th><th>Unit</th>
                <th>Cost (RWF)</th><th>Price (RWF)</th><th>In Stock</th><th>Reorder</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!products
                ? <tr><td colSpan="11"><div className="loading"><span className="spinner" />Loading...</div></td></tr>
                : products.length === 0
                  ? <tr><td colSpan="11"><div className="empty">No products yet — add your first product above</div></td></tr>
                  : products.map(p => {
                      const s = stockStatus(p)
                      return (
                        <tr key={p.id}>
                          <td style={{ fontWeight: 500 }}>{p.name}</td>
                          <td style={{ color: 'var(--t3)' }}>{p.sku || '—'}</td>
                          <td>{p.category || '—'}</td>
                          <td>{p.supplier_country || '—'}</td>
                          <td style={{ color: 'var(--t3)' }}>{p.unit}</td>
                          <td className="mono">{fmt(p.cost_price)}</td>
                          <td className="mono">{fmt(p.sale_price)}</td>
                          <td className="mono" style={{ fontWeight: 600 }}>{fmt(p.qty_on_hand)}</td>
                          <td className="mono" style={{ color: 'var(--t3)' }}>{fmt(p.reorder_level)}</td>
                          <td><span className={`badge ${s.badge}`}>{s.label}</span></td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-sm" onClick={() => openStockIn(p)}>Stock In</button>
                              <button className="btn btn-sm" onClick={() => openAdjust(p)}>Adjust</button>
                              <button className="btn btn-sm" onClick={() => openEdit(p)}>Edit</button>
                              <button className="btn btn-sm" onClick={() => openHistory(p)}>History</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Product */}
      <Modal open={formModal} onClose={() => setFormModal(false)} title={form.id ? 'Edit Product' : 'Add Product'} wide>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Product Name *</label>
            <input
              className="form-input"
              value={form.name}
              onChange={e => {
                const name = e.target.value
                setForm(f => ({
                  ...f,
                  name,
                  sku: f.sku ? f.sku : generateSKU(name, f.category),
                }))
              }}
              placeholder="e.g. Cotton T-Shirt"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">SKU</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="form-input" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="auto-generated" style={{ flex: 1 }} />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setForm(f => ({ ...f, sku: generateSKU(f.name, f.category) }))}
                title="Generate new SKU"
                style={{ flexShrink: 0 }}
              >↺</button>
            </div>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Category</label>
            <input className="form-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="e.g. Clothing" />
          </div>
          <div className="form-group">
            <label className="form-label">Supplier Country</label>
            <select className="form-input" value={form.supplier_country} onChange={e => setForm(f => ({ ...f, supplier_country: e.target.value }))}>
              {COUNTRIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Unit</label>
            <select className="form-input" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
              {UNITS.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Reorder Alert Level</label>
            <input className="form-input" type="number" step="1" min="0" value={form.reorder_level} onChange={e => setForm(f => ({ ...f, reorder_level: e.target.value }))} placeholder="0" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Cost Price (RWF)</label>
            <input className="form-input" type="number" step="1" min="0" value={form.cost_price} onChange={e => setForm(f => ({ ...f, cost_price: e.target.value }))} placeholder="0" />
          </div>
          <div className="form-group">
            <label className="form-label">Sale Price (RWF)</label>
            <input className="form-input" type="number" step="1" min="0" value={form.sale_price} onChange={e => setForm(f => ({ ...f, sale_price: e.target.value }))} placeholder="0" />
          </div>
        </div>
        {!form.id && (
          <div className="form-group">
            <label className="form-label">Opening Stock Quantity (optional)</label>
            <input className="form-input" type="number" step="0.01" min="0" value={form.qty_on_hand} onChange={e => setForm(f => ({ ...f, qty_on_hand: e.target.value }))} placeholder="0" />
          </div>
        )}
        <div className="form-actions">
          <button className="btn" onClick={() => setFormModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveProduct} disabled={saving}>{saving ? 'Saving…' : 'Save Product'}</button>
        </div>
      </Modal>

      {/* Stock In */}
      <Modal open={stockInModal} onClose={() => setStockInModal(false)} title="Receive Stock (Stock In)">
        <div className="form-group">
          <label className="form-label">Product *</label>
          <select className="form-input" value={stockIn.product_id} onChange={e => setStockIn(s => ({ ...s, product_id: e.target.value }))}>
            <option value="">— select product —</option>
            {prodOptions}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Quantity *</label>
            <input className="form-input" type="number" step="0.01" min="0" value={stockIn.qty} onChange={e => setStockIn(s => ({ ...s, qty: e.target.value }))} placeholder="0" />
          </div>
          <div className="form-group">
            <label className="form-label">Unit Cost (RWF, optional)</label>
            <input className="form-input" type="number" step="1" min="0" value={stockIn.unit_cost} onChange={e => setStockIn(s => ({ ...s, unit_cost: e.target.value }))} placeholder="0" />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Supplier Note</label>
          <input className="form-input" value={stockIn.supplier_note} onChange={e => setStockIn(s => ({ ...s, supplier_note: e.target.value }))} placeholder="e.g. Alibaba — Guangzhou, shipment #4" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Date *</label>
            <input className="form-input" type="date" value={stockIn.date} onChange={e => setStockIn(s => ({ ...s, date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <input className="form-input" value={stockIn.notes} onChange={e => setStockIn(s => ({ ...s, notes: e.target.value }))} placeholder="optional" />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setStockInModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveStockIn} disabled={saving}>{saving ? 'Saving…' : 'Receive Stock'}</button>
        </div>
      </Modal>

      {/* Adjust Stock */}
      <Modal open={adjustModal} onClose={() => setAdjustModal(false)} title="Adjust Stock">
        <div className="form-group">
          <label className="form-label">Product *</label>
          <select className="form-input" value={adjust.product_id} onChange={e => setAdjust(a => ({ ...a, product_id: e.target.value }))}>
            <option value="">— select product —</option>
            {prodOptions}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Adjustment Type</label>
            <select className="form-input" value={adjust.direction} onChange={e => setAdjust(a => ({ ...a, direction: e.target.value }))}>
              <option value="out">Remove stock (damage / loss / correction)</option>
              <option value="in">Add stock (found / correction)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Quantity *</label>
            <input className="form-input" type="number" step="0.01" min="0" value={adjust.qty} onChange={e => setAdjust(a => ({ ...a, qty: e.target.value }))} placeholder="0" />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Reason</label>
          <input className="form-input" value={adjust.notes} onChange={e => setAdjust(a => ({ ...a, notes: e.target.value }))} placeholder="e.g. damaged on delivery" />
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setAdjustModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveAdjust} disabled={saving}>{saving ? 'Saving…' : 'Save Adjustment'}</button>
        </div>
      </Modal>

      {/* Movement History */}
      <Modal open={histModal} onClose={() => setHistModal(false)} title={`Movement History — ${histProduct?.name || ''}`} wide>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Qty Change</th><th>Unit Cost</th><th>Supplier / Notes</th></tr></thead>
            <tbody>
              {!movements
                ? <tr><td colSpan="5"><div className="loading"><span className="spinner" />Loading...</div></td></tr>
                : movements.length === 0
                  ? <tr><td colSpan="5"><div className="empty">No movements recorded</div></td></tr>
                  : movements.map(m => (
                      <tr key={m.id}>
                        <td style={{ color: 'var(--t3)' }}>{m.date}</td>
                        <td>
                          {m.type === 'in' && <span className="badge badge-g">In</span>}
                          {m.type === 'out' && <span className="badge badge-r">Out</span>}
                          {m.type === 'adjustment' && <span className="badge badge-b">Adjust</span>}
                        </td>
                        <td className="mono" style={{ fontWeight: 600, color: m.qty > 0 ? 'var(--ok)' : 'var(--er)' }}>
                          {m.qty > 0 ? '+' : ''}{fmt(m.qty)}
                        </td>
                        <td className="mono">{m.unit_cost ? 'RWF ' + fmt(m.unit_cost) : '—'}</td>
                        <td style={{ color: 'var(--t2)' }}>{m.supplier_note || m.notes || '—'}</td>
                      </tr>
                    ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </>
  )
}
