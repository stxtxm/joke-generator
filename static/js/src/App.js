import React, { useState, useEffect } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import JokeCard from './components/JokeCard.js'
import Controls from './components/Controls.js'
import Admin from './Admin.js'
import { generateJoke, rateJoke, getMetrics } from './lib/api.js'

export default function App() {
  const [joke, setJoke] = useState('Appuyez sur "Nouvelle blague" pour commencer.')
  const [loading, setLoading] = useState(false)
  const [metrics, setMetrics] = useState({ likes: 0, dislikes: 0, rating: 0 })

  useEffect(() => {
    function onKey(e) {
      if (e.code === 'Space') fetchJoke()
    }
    window.addEventListener('keyup', onKey)
    return () => window.removeEventListener('keyup', onKey)
  }, [])

  async function fetchJoke() {
    setLoading(true)
    try {
      const res = await generateJoke()
      setJoke(res.joke || 'Erreur lors de la génération')
      setMetrics({ likes: 0, dislikes: 0, rating: 0 })
    } catch (e) {
      setJoke('Erreur réseau')
    } finally {
      setLoading(false)
    }
  }

  async function handleRate(r) {
    // optimistic UI: apply feedback immediately
    if (!joke || joke.startsWith('Appuyez') || joke.startsWith('Erreur')) return
    try {
      const resp = await rateJoke(joke, r)
      setMetrics(resp.metrics || { likes: 0, dislikes: 0, rating: 0 })
    } catch (e) {
      // ignore
    }
  }

  return (
    React.createElement('main', { className: 'wrap' },
      React.createElement('section', { className: 'card', 'aria-live': 'polite' },
        React.createElement('div', { className: 'logo' }),
        React.createElement('h2', { className: 'title' }, 'Joke Generator'),
        React.createElement('div', { className: 'nav' },
          React.createElement(Link, { to: '/' }, 'App'),
          React.createElement(Link, { to: '/admin' }, 'Admin')
        ),
        React.createElement(Routes, null,
          React.createElement(Route, { path: '/', element: React.createElement(React.Fragment, null,
            React.createElement(JokeCard, { joke, loading }),
            React.createElement(Controls, { onGenerate: fetchJoke, onRate: handleRate, loading, metrics })
          ) }),
          React.createElement(Route, { path: '/admin', element: React.createElement(Admin) })
        )
      )
    )
  )
}
