export const fmt = n => Number(n || 0).toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
export const fmtDec = n => Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const weekStart = () => {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay() + 1)
  return d.toISOString().split('T')[0]
}

export const monthStart = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function exportCSV(rows, filename) {
  if (!rows.length) return
  const h = Object.keys(rows[0])
  const csv = [h.join(','), ...rows.map(r =>
    h.map(k => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(',')
  )].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = filename
  a.click()
}
