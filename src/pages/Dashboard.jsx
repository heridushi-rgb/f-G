import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmt, weekStart, monthStart } from '../lib/utils'

export default function Dashboard() {
  const [metrics, setMetrics] = useState(null)
  const [topProducts, setTopProducts] = useState(null)
  const [lowStock, setLowStock] = useState(null)
  const [recentOrders, setRecentOrders] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    const ws = weekStart()
    const ms = monthStart()

    const [ctRes, payRes, itemsRes, prodsRes, ordersRes] = await Promise.all([
      sb.from('cash_transactions').select('account, type, amount'),
      sb.from('payments').select('amount, destination, date, customer_id'),
      sb.from('order_items').select('qty, unit_price, product_id, order_id, orders(date, customer_id), products(name)'),
      sb.from('products').select('id, name, qty_on_hand, reorder_level').order('name'),
      sb.from('orders').select('id, date, status, customer_id, customers(name), order_items(qty, unit_price)').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(6),
    ])

    const cts = ctRes.data || []
    const pays = payRes.data || []
    const items = itemsRes.data || []
    const prods = prodsRes.data || []

    // Bank balance = manual cash_transactions + customer payments routed to bank
    const bankBal =
      cts.filter(t => t.account === 'bank' && t.type === 'in').reduce((s, t) => s + t.amount, 0) -
      cts.filter(t => t.account === 'bank' && t.type === 'out').reduce((s, t) => s + t.amount, 0) +
      pays.filter(p => p.destination === 'bank').reduce((s, p) => s + p.amount, 0)

    // Safe balance
    const safeBal =
      cts.filter(t => t.account === 'safe' && t.type === 'in').reduce((s, t) => s + t.amount, 0) -
      cts.filter(t => t.account === 'safe' && t.type === 'out').reduce((s, t) => s + t.amount, 0) +
      pays.filter(p => p.destination === 'safe').reduce((s, p) => s + p.amount, 0)

    // AR: total invoiced across all orders minus total payments received
    const totalInvoiced = items.reduce((s, i) => s + i.qty * i.unit_price, 0)
    const totalPaid = pays.reduce((s, p) => s + p.amount, 0)
    const ar = Math.max(0, totalInvoiced - totalPaid)

    // Weekly and monthly sales
    const weekSales = items.filter(i => i.orders?.date >= ws).reduce((s, i) => s + i.qty * i.unit_price, 0)
    const monthSales = items.filter(i => i.orders?.date >= ms).reduce((s, i) => s + i.qty * i.unit_price, 0)

    // Top products by revenue (all time)
    const prodRevenue = {}
    for (const i of items) {
      if (!i.products) continue
      prodRevenue[i.products.name] = (prodRevenue[i.products.name] || 0) + i.qty * i.unit_price
    }
    const top = Object.entries(prodRevenue).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, rev]) => ({ name, rev }))

    setMetrics({ bankBal, safeBal, ar, weekSales, monthSales })
    setTopProducts(top)
    setLowStock(prods.filter(p => p.qty_on_hand <= p.reorder_level && p.reorder_level > 0).slice(0, 8))
    setRecentOrders(ordersRes.data || [])
  }

  const orderTotal = o => (o.order_items || []).reduce((s, i) => s + i.qty * i.unit_price, 0)

  const STATUS_BADGE = {
    pending: <span className="badge badge-x">Pending</span>,
    fulfilled: <span className="badge badge-b">Fulfilled</span>,
    partially_paid: <span className="badge badge-a">Part Paid</span>,
    paid: <span className="badge badge-g">Paid</span>,
  }

  return (
    <>
      <div className="metrics" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
        <div className="mc">
          <div className="mc-label">Bank Account</div>
          <div className="mc-value" style={{ fontSize: 18, color: metrics?.bankBal >= 0 ? 'var(--ok)' : 'var(--er)' }}>
            {metrics ? 'RWF ' + fmt(metrics.bankBal) : '—'}
          </div>
        </div>
        <div className="mc">
          <div className="mc-label">Cash Safe</div>
          <div className="mc-value" style={{ fontSize: 18, color: metrics?.safeBal >= 0 ? 'var(--ok)' : 'var(--er)' }}>
            {metrics ? 'RWF ' + fmt(metrics.safeBal) : '—'}
          </div>
        </div>
        <div className="mc">
          <div className="mc-label">Total Owed (AR)</div>
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
