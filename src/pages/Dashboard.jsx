import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmt, weekStart, monthStart } from '../lib/utils'

export default function Dashboard() {
  const [accounts, setAccounts] = useState(null)
  const [accountBals, setAccountBals] = useState({})
  const [metrics, setMetrics] = useState(null)
  const [topProducts, setTopProducts] = useState(null)
  const [lowStock, setLowStock] = useState(null)
  const [recentOrders, setRecentOrders] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    const ws = weekStart()
    const ms = monthStart()

    const [accRes, ctRes, payRes, itemsRes, prodsRes, ordersRes] = await Promise.all([
      sb.from('accounts').select('*').order('sort_order').order('created_at'),
      sb.from('cash_transactions').select('account_id, type, amount'),
      sb.from('payments').select('amount, order_id'),
      sb.from('order_items').select('qty, unit_price, product_id, orders(date), products(name)'),
      sb.from('products').select('id, name, qty_on_hand, reorder_level').order('name'),
      sb.from('orders').select('id, date, status, customers(name), order_items(qty, unit_price)').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(6),
    ])

    const accs = accRes.data || []
    const cts = ctRes.data || []
    const pays = payRes.data || []
    const items = itemsRes.data || []
    const prods = prodsRes.data || []

    // Balance per account — only from cash_transactions (payments auto-create a cash_transaction on save)
    const bals = {}
    for (const acc of accs) {
      const txIn  = cts.filter(t => t.account_id === acc.id && t.type === 'in').reduce((s, t) => s + t.amount, 0)
      const txOut = cts.filter(t => t.account_id === acc.id && t.type === 'out').reduce((s, t) => s + t.amount, 0)
      bals[acc.id] = txIn - txOut
    }

    // AR: total invoiced minus total payments received
    const totalInvoiced = items.reduce((s, i) => s + i.qty * i.unit_price, 0)
    const totalPaid = pays.reduce((s, p) => s + p.amount, 0)
    const ar = Math.max(0, totalInvoiced - totalPaid)

    // Sales this week / month
    const weekSales = items.filter(i => i.orders?.date >= ws).reduce((s, i) => s + i.qty * i.unit_price, 0)
    const monthSales = items.filter(i => i.orders?.date >= ms).reduce((s, i) => s + i.qty * i.unit_price, 0)

    // Top products by revenue
    const prodRevenue = {}
    for (const i of items) {
      if (!i.products) continue
      prodRevenue[i.products.name] = (prodRevenue[i.products.name] || 0) + i.qty * i.unit_price
    }
    const top = Object.entries(prodRevenue).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, rev]) => ({ name, rev }))

    setAccounts(accs)
    setAccountBals(bals)
    setMetrics({ ar, weekSales, monthSales })
    setTopProducts(top)
    setLowStock(prods.filter(p => p.qty_on_hand <= p.reorder_level && p.reorder_level > 0).slice(0, 8))
    setRecentOrders(ordersRes.data || [])
  }

  const orderTotal = o => (o.order_items || []).reduce((s, i) => s + i.qty * i.unit_price, 0)

  const STATUS_BADGE = {
    pending:        <span className="badge badge-x">Pending</span>,
    fulfilled:      <span className="badge badge-b">Fulfilled</span>,
    partially_paid: <span className="badge badge-a">Part Paid</span>,
    paid:           <span className="badge badge-g">Paid</span>,
  }

  const TYPE_LABEL = { mobile_money: 'Mobile Money', cash: 'Cash / Safe', bank: 'Bank' }

  return (
    <>
      {/* Account balances — one card per account */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 10, marginBottom: 18 }}>
        {!accounts
          ? <div className="loading"><span className="spinner" />Loading...</div>
          : accounts.map(acc => {
              const bal = accountBals[acc.id] ?? 0
              return (
                <div key={acc.id} className="mc">
                  <div className="mc-label">{TYPE_LABEL[acc.type] || acc.type} · {acc.currency}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', marginBottom: 4 }}>{acc.name}</div>
                  <div className="mc-value" style={{ fontSize: 18, color: bal >= 0 ? 'var(--ok)' : 'var(--er)' }}>
                    {acc.currency} {fmt(Math.abs(bal))}{bal < 0 ? ' DR' : ''}
                  </div>
                </div>
              )
            })}
      </div>

      {/* Summary metrics */}
      <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', marginBottom: 18 }}>
        <div className="mc">
          <div className="mc-label">Total Owed by Clients (AR)</div>
          <div className="mc-value" style={{ fontSize: 18, color: metrics?.ar > 0 ? 'var(--wn)' : 'var(--t)' }}>
            {metrics ? 'RWF ' + fmt(metrics.ar) : '—'}
          </div>
          {metrics?.ar > 0 && <div className="mc-sub wn">clients owe you</div>}
        </div>
        <div className="mc">
          <div className="mc-label">Sales This Week</div>
          <div className="mc-value" style={{ fontSize: 18 }}>{metrics ? 'RWF ' + fmt(metrics.weekSales) : '—'}</div>
        </div>
        <div className="mc">
          <div className="mc-label">Sales This Month</div>
          <div className="mc-value" style={{ fontSize: 18 }}>{metrics ? 'RWF ' + fmt(metrics.monthSales) : '—'}</div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head"><span className="card-title">Recent Orders</span></div>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Date</th><th>Total</th><th>Status</th></tr></thead>
              <tbody>
                {!recentOrders
                  ? <tr><td colSpan="4"><div className="loading"><span className="spinner" />Loading...</div></td></tr>
                  : recentOrders.length === 0
                    ? <tr><td colSpan="4"><div className="empty">No orders yet</div></td></tr>
                    : recentOrders.map(o => (
                        <tr key={o.id}>
                          <td style={{ fontWeight: 500 }}>{o.customers?.name || '—'}</td>
                          <td style={{ color: 'var(--t3)' }}>{o.date}</td>
                          <td className="mono">RWF {fmt(orderTotal(o))}</td>
                          <td>{STATUS_BADGE[o.status] || STATUS_BADGE.pending}</td>
                        </tr>
                      ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-head"><span className="card-title">Top Products (by revenue)</span></div>
            <div className="tbl-wrap">
              <table>
                <thead><tr><th>Product</th><th>Revenue (RWF)</th></tr></thead>
                <tbody>
                  {!topProducts
                    ? <tr><td colSpan="2"><div className="loading"><span className="spinner" />Loading...</div></td></tr>
                    : topProducts.length === 0
                      ? <tr><td colSpan="2"><div className="empty">No sales yet</div></td></tr>
                      : topProducts.map((p, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 500 }}>{p.name}</td>
                            <td className="mono">{fmt(p.rev)}</td>
                          </tr>
                        ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><span className="card-title">Low Stock Alerts</span></div>
            <div className="tbl-wrap">
              <table>
                <thead><tr><th>Product</th><th>In Stock</th><th>Reorder At</th></tr></thead>
                <tbody>
                  {!lowStock
                    ? <tr><td colSpan="3"><div className="loading"><span className="spinner" />Loading...</div></td></tr>
                    : lowStock.length === 0
                      ? <tr><td colSpan="3"><div className="empty">All stock levels OK</div></td></tr>
                      : lowStock.map(p => (
                          <tr key={p.id}>
                            <td style={{ fontWeight: 500 }}>{p.name}</td>
                            <td className="mono" style={{ color: p.qty_on_hand === 0 ? 'var(--er)' : 'var(--wn)', fontWeight: 600 }}>{fmt(p.qty_on_hand)}</td>
                            <td className="mono" style={{ color: 'var(--t3)' }}>{fmt(p.reorder_level)}</td>
                          </tr>
                        ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
