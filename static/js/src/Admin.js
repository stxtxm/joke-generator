import React, { useEffect, useState } from 'react'

export default function Admin() {
  const [examples, setExamples] = useState([])
  const [text, setText] = useState('')
  const [notes, setNotes] = useState('')
  const [approved, setApproved] = useState(false)
  const [exportsText, setExportsText] = useState('')
  const [models, setModels] = useState({ list: [], current: '' })

  async function load() {
    try {
      const r = await fetch('/admin/curated')
      const rows = await r.json()
      setExamples(rows)

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

  async function add() {
    if (!text.trim()) return alert('content required')
    await fetch('/admin/curated', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ content: text, notes, approved: approved ? 1 : 0 }) })
    setText(''); setNotes(''); setApproved(false)
    load()
  }

  async function del(id) {
    await fetch('/admin/curated/' + id, { method: 'DELETE' })
    load()
  }

  async function resetDb() {
    if (!confirm('Are you sure you want to reset the database? This cannot be undone.')) return
    const r = await fetch('/admin/reset-db', { method: 'POST' })
    const j = await r.json()
    j.ok ? alert('Database reset!') : alert('Reset failed: ' + j.error)
    load()
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
        React.createElement('button', { onClick: resetDb, style: { background: '#ef4444', color: 'white', border: 'none', padding: '10px', borderRadius: '4px' } }, 'Reset Database')
      ),

      React.createElement('div', { className: 'box' },
        React.createElement('h3', null, 'Curated Examples'),
        React.createElement('label', null, 'Example text'),
        React.createElement('textarea', { rows: 3, value: text, onChange: e => setText(e.target.value) }),
        React.createElement('label', null, 'Notes (optional)'),
        React.createElement('input', { value: notes, onChange: e => setNotes(e.target.value) }),
        React.createElement('div', { style: { marginTop: '10px' } },
          React.createElement('label', null, React.createElement('input', { type: 'checkbox', checked: approved, onChange: e => setApproved(e.target.checked) }), ' Approved')
        ),
        React.createElement('button', { onClick: add }, 'Add Example')
      ),

      React.createElement('div', { className: 'box' },
        React.createElement('h3', null, 'Existing'),
        React.createElement('ul', null, examples.map(rw => React.createElement('li', { key: rw.id },
          React.createElement('strong', null, rw.approved ? '✓ ' : ''), rw.content, ' ', React.createElement('button', { onClick: () => del(rw.id), style: { background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', padding: '2px 8px', fontSize: '12px' } }, 'Del')
        )))
      )
    )
  )
}
