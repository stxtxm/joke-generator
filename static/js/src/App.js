import React, { useState, useEffect } from 'react'
import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import JokeCard from './components/JokeCard.js'
import Controls from './components/Controls.js'
import Admin from './Admin.js'
import { generateJoke, rateJoke, getMetrics } from './lib/api.js'

export default function App() {
  const [joke, setJoke] = useState('Appuyez sur "Nouvelle blague" pour commencer.')
  const [loading, setLoading] = useState(false)
  const [metrics, setMetrics] = useState({ likes: 0, dislikes: 0, rating: 0 })
  const [userRating, setUserRating] = useState(0)
  const location = useLocation()

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
      setUserRating(0)
    } catch (e) {
      setJoke('Erreur réseau')
    } finally {
      setLoading(false)
    }
  }

  function handleRate(r) {
    if (!joke || joke.startsWith('Appuyez') || loading) return
    if (userRating === r) {
      setUserRating(0)
      rateJoke(joke, 0).catch(() => {})
      return
    }
    setUserRating(r)
    rateJoke(joke, r).then(resp => {
      if (resp.metrics) setMetrics(resp.metrics)
    }).catch(() => {
      setUserRating(0)
    })
  }

  return (
    React.createElement('main', { className: 'wrap' },
      React.createElement('section', { className: 'card', 'aria-live': 'polite' },
        React.createElement('div', { className: 'logo' }),
        React.createElement('h2', { className: 'title' }, 'Joke Generator'),
        React.createElement('div', { className: 'nav' },
          React.createElement(NavLink, { to: '/', className: ({ isActive }) => isActive ? 'active' : '', end: true }, 'App'),
          React.createElement(NavLink, { to: '/admin', className: ({ isActive }) => isActive ? 'active' : '' }, 'Admin')
        ),
        React.createElement('div', { key: location.pathname, className: 'page-enter-active' },
          React.createElement(Routes, null,
            React.createElement(Route, { path: '/', element: React.createElement(React.Fragment, null,
              React.createElement(JokeCard, { joke, loading }),
              React.createElement(Controls, { onGenerate: fetchJoke, onRate: handleRate, loading, metrics, userRating })
            ) }),
            React.createElement(Route, { path: '/admin', element: React.createElement(Admin) })
          )
        )
      )
    )
  )
}
