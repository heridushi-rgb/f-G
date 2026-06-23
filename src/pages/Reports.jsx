import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmt, exportCSV, monthStart } from '../lib/utils'

export default function Reports() {
  const today = new Date().toISOString().split('T')[0]
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { loadSummary() }, [from, to])

  async function loadSummary() {
    setLoading(true)
    const [itemsRes, paysRes] = await Promise.all([
      sb.from('order_items').select('qty, unit_price, orders(date)').gte('orders.date', from).lte('orders.date', to),
      sb.from('payments').select('amount').gte('date', from).lte('date', to),
    ])
    const items = (itemsRes.data || []).filter(i => i.orders)
    const pays = paysRes.data || []
    const sales = items.reduce((s, i) => s + i.qty * i.unit_price, 0)
    const received = pays.reduce((s, p) => s + p.amount, 0)
    const outstanding = Math.max(0, sales - received)
    setSummary({ sales, received, outstanding })
    setLoading(false)
  }

  async function exportProducts() {
    const { data } = await sb.from('products').select('*').order('name')
    exportCSV((data || []).map(p => ({
      Name: p.name, SKU: p.sku, Category: p.category, Supplier: p.supplier_country,
      Unit: p.unit, CostPrice_RWF: p.cost_price, SalePrice_RWF: p.sale_price,
      QtyOnHand: p.qty_on_hand, ReorderLevel: p.reorder_level,
    })), '4fg_products.csv')
  }

  async function exportCustomers() {
    const [custRes, itemsRes, paysRes] = await Promise.all([
      sb.from('customers').select('*').order('name'),
      sb.from('order_items').select('qty, unit_price, orders(customer_id)'),
      sb.from('payments').select('amount, customer_id'),
    ])
    const items = itemsRes.data || []
    const pays = paysRes.data || []
    const invoiced = {}
    const paid = {}
    for (const i of items) {
      const cid = i.orders?.customer_id
      if (cid) invoiced[cid] = (invoiced[cid] || 0) + i.qty * i.unit_price
    }
    for (const p of pays) {
      if (p.customer_id) paid[p.customer_id] = (paid[p.customer_id] || 0) + p.amount
    }
    exportCSV((custRes.data || []).map(c => ({
      Name: c.name, Phone: c.phone, BusinessName: c.business_name,
      TotalInvoiced_RWF: invoiced[c.id] || 0,
      TotalPaid_RWF: paid[c.id] || 0,
      BalanceOwed_RWF: Math.max(0, (invoiced[c.id] || 0) - (paid[c.id] || 0)),
      Notes: c.notes || '',
    })), '4fg_customers.csv')
  }

  async function exportOrders() {
    const { data } = await sb.from('orders')
      .select('*, customers(name), order_items(qty, unit_price)')
      .gte('date', from).lte('date', to)
      .order('date', { ascending: false })
    exportCSV((data || []).map(o => ({
      Date: o.date, Customer: o.customers?.name,
      Total_RWF: (o.order_items || []).reduce((s, i) => s + i.qty * i.unit_price, 0),
      Status: o.status, Notes: o.notes || '',
    })), `4fg_orders_${from}_to_${to}.csv`)
  }

  async function exportPayments() {
    const { data } = await sb.from('payments')
      .select('*, customers(name), orders(date), accounts(name, currency)')
      .gte('date', from).lte('date', to)
      .order('date', { ascending: false })
    exportCSV((data || []).map(p => ({
      Date: p.date, Customer: p.customers?.name, Amount: p.amount,
      Currency: p.accounts?.currency || 'RWF', Method: p.method,
      Account: p.accounts?.name || '',
      LinkedOrderDate: p.orders?.date || '', Notes: p.notes || '',
    })), `4fg_payments_${from}_to_${to}.csv`)
  }

  async function exportTransactions() {
    const { data } = await sb.from('cash_transactions')
      .select('*, accounts(name, currency)').gte('date', from).lte('date', to)
      .order('date', { ascending: false })
    exportCSV((data || []).map(t => ({
      Date: t.date, Account: t.accounts?.name || '', Currency: t.accounts?.currency || 'RWF',
      Type: t.type, Amount: t.amount, Reason: t.reason,
    })), `4fg_ledger_${from}_to_${to}.csv`)
  }

  return (
    <>
      <div className="card">
        <div className="card-head"><span className="card-title">Date Range</span></div>
        <div className="card-body">
          <div className="form-row" style={{ maxWidth: 460 }}>
            <div className="form-group">
              <label className="form-label">From</label>
              <input className="form-input" type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">To</label>
              <input className="form-input" type="date" value={to} onChange={e => setTo(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {/* Summary for date range */}
      <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', marginBottom: 18 }}>
        <div className="mc">
          <div className="mc-label">Sales (invoiced)</div>
          <div className="mc-value" style={{ fontSize: 18 }}>{loading ? '…' : 'RWF ' + fmt(summary?.sales)}</div>
        </div>
        <div className="mc">
          <div className="mc-label">Payments Received</div>
          <div className="mc-value" style={{ fontSize: 18, color: 'var(--ok)' }}>{loading ? '…' : 'RWF ' + fmt(summary?.received)}</div>
        </div>
        <div className="mc">
          <div className="mc-label">Still Outstanding</div>
          <div className="mc-value" style={{ fontSize: 18, color: summary?.outstanding > 0 ? 'var(--wn)' : 'var(--t3)' }}>{loading ? '…' : 'RWF ' + fmt(summary?.outstanding)}</div>
        </div>
      </div>

      {/* Export section */}
      <div className="card">
        <div className="card-head"><span className="card-title">CSV Exports</span></div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            <ExportCard
              title="Inventory / Products"
              desc="Full product catalog with stock levels and prices"
              onClick={exportProducts}
            />
            <ExportCard
              title="Customers"
              desc="All customers with total invoiced, paid, and balance owed"
              onClick={exportCustomers}
            />
            <ExportCard
              title="Orders"
              desc={`Orders from ${from} to ${to}`}
              onClick={exportOrders}
              dateFiltered
            />
            <ExportCard
              title="Payments"
              desc={`Customer payments from ${from} to ${to}`}
              onClick={exportPayments}
              dateFiltered
            />
            <ExportCard
              title="Ledger Entries"
              desc={`Manual cash transactions from ${from} to ${to}`}
              onClick={exportTransactions}
              dateFiltered
            />
          </div>
        </div>
      </div>
    </>
  )
}

function ExportCard({ title, desc, onClick, dateFiltered }) {
  return (
    <div
      style={{
        border: '1px solid var(--b2)', borderRadius: 'var(--r)', padding: '14px 16px',
        cursor: 'pointer', transition: 'background 0.12s',
      }}
      onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
      onMouseLeave={e => e.currentTarget.style.background = ''}
    >
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>↓ {title}</div>
      <div style={{ fontSize: 11, color: 'var(--t3)' }}>{desc}</div>
      {dateFiltered && <div style={{ fontSize: 10, color: 'var(--brand)', marginTop: 6, fontWeight: 500 }}>uses date range above</div>}
    </div>
  )
}
