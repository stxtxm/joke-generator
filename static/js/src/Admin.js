import React, { useEffect, useState } from 'react'

export default function Admin() {
  const [examples, setExamples] = useState([])
  const [text, setText] = useState('')
  const [notes, setNotes] = useState('')
  const [approved, setApproved] = useState(false)
  const [exportsText, setExportsText] = useState('')

  async function load() {
    try {
      const r = await fetch('/admin/curated')
      const rows = await r.json()
      setExamples(rows)
    } catch (e) {
      console.error(e)
    }
  }

  const [status, setStatus] = useState({ running: false, logTail: '' })

  async function loadStatus() {
    const r = await fetch('/admin/train-status')
    const j = await r.json()
    setStatus(j)
  }

  useEffect(() => {
    load()
    loadStatus()
    const interval = setInterval(loadStatus, 2000)
    return () => clearInterval(interval)
  }, [])

  async function triggerTrain() {
    const r = await fetch('/admin/trigger-train', { method: 'POST' })
    const j = await r.json()
    if (j.error) alert(j.error)
    loadStatus()
  }

  async function add() {
    if (!text.trim()) return alert('content required')
    await fetch('/admin/curated', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ content: text, notes, approved: approved ? 1 : 0 }) })
    setText(''); setNotes(''); setApproved(false)
    load()
  }

  async function del(id) {
    await fetch('/admin/curated/' + id, { method: 'DELETE' })
    load()
  }

  async function triggerExport() {
    const r = await fetch('/admin/trigger-export')
    const j = await r.json()
    setExportsText(JSON.stringify(j, null, 2))
  }

  async function listExports() {
    const r = await fetch('/admin/exports-list')
    const j = await r.json()
    setExportsText(JSON.stringify(j, null, 2))
  }

  return (
    React.createElement('div', { className: 'admin' },
      React.createElement('h2', null, 'Curated Examples'),
      React.createElement('div', { className: 'box' },
        React.createElement('label', null, 'Example text'),
        React.createElement('textarea', { rows: 3, value: text, onChange: e => setText(e.target.value) }),
        React.createElement('label', null, 'Notes (optional)'),
        React.createElement('input', { value: notes, onChange: e => setNotes(e.target.value) }),
        React.createElement('div', null,
          React.createElement('label', null, React.createElement('input', { type: 'checkbox', checked: approved, onChange: e => setApproved(e.target.checked) }), ' Approved')
        ),
        React.createElement('button', { onClick: add }, 'Add Example')
      ),

      React.createElement('div', { className: 'box' },
        React.createElement('h3', null, 'Existing'),
        React.createElement('ul', null, examples.map(rw => React.createElement('li', { key: rw.id },
          React.createElement('strong', null, rw.approved ? '✓' : ''), ' ', rw.content, ' ', React.createElement('button', { onClick: () => del(rw.id) }, 'Del')
        )))
      ),

      React.createElement('div', { className: 'box' },
        React.createElement('h3', null, 'Training'),
        React.createElement('button', { onClick: triggerTrain, disabled: status.running }, status.running ? 'Training in progress...' : 'Trigger Fine-tuning'),
        React.createElement('pre', { style: { marginTop: '12px' } }, status.logTail)
      ),

      React.createElement('div', { className: 'box' },
        React.createElement('h3', null, 'Exports'),
        React.createElement('div', null,
          React.createElement('button', { onClick: triggerExport }, 'Trigger Export Now'), ' ',
          React.createElement('button', { onClick: listExports }, 'List Exports')
        ),
        React.createElement('pre', null, exportsText)
      )
    )
  )
}
