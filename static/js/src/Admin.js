import React, { useEffect, useState } from 'react'

export default function Admin() {
  const [models, setModels] = useState({ list: [], current: '' })

  async function load() {
    try {
      const mr = await fetch('/admin/models')
      const mj = await mr.json()
      setModels({ list: mj.models, current: mj.current })
    } catch (e) {
      console.error('Admin load failed', e)
    }
  }

  useEffect(() => { load() }, [])

  async function setModel(m) {
    await fetch('/admin/set-model', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model: m }) })
    load()
  }

  async function resetDb() {
    if (!confirm('Are you sure you want to reset the database? This cannot be undone.')) return
    const r = await fetch('/admin/reset-db', { method: 'POST' })
    const j = await r.json()
    j.ok ? alert('Database reset!') : alert('Reset failed: ' + j.error)
  }

  async function resetRules() {
    if (!confirm('Reset adaptive prompt rules? This will not affect jokes or ratings.')) return
    const r = await fetch('/admin/reset-rules', { method: 'POST' })
    const j = await r.json()
    j.ok ? alert('Prompt rules reset!') : alert('Reset failed: ' + j.error)
  }

  return (
    React.createElement('div', { className: 'admin' },
      React.createElement('h2', null, 'Admin Panel'),

      React.createElement('div', { className: 'box' },
        React.createElement('h3', null, 'Model Selection'),
        React.createElement('select', {
            value: models.current,
            onChange: e => setModel(e.target.value),
            style: { width: '100%', padding: '8px', background: '#071026', color: '#e6eef8' }
        },
            models.list.map(m => React.createElement('option', { key: m, value: m }, m))
        )
      ),

      React.createElement('div', { className: 'box' },
        React.createElement('button', { onClick: resetDb, style: { background: '#ef4444', color: 'white', border: 'none', padding: '10px', borderRadius: '4px', marginRight: '8px' } }, 'Reset Database'),
        React.createElement('button', { onClick: resetRules, style: { background: '#f59e0b', color: 'white', border: 'none', padding: '10px', borderRadius: '4px' } }, 'Reset Prompt Rules')
      )
    )
  )
}
