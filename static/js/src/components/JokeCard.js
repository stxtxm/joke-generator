import React, { useState, useEffect } from 'react'

export default function JokeCard({ joke, loading }) {
  const [showAnim, setShowAnim] = useState(false)

  useEffect(() => {
    if (!loading && joke) {
      setShowAnim(true)
      const t = setTimeout(() => setShowAnim(false), 350)
      return () => clearTimeout(t)
    }
  }, [loading, joke])

  if (loading) {
    return (
      React.createElement('div', { id: 'joke', className: 'joke loading' },
        React.createElement('div', { className: 'dots' },
          React.createElement('span'),
          React.createElement('span'),
          React.createElement('span')
        )
      )
    )
  }
  return React.createElement('div', { id: 'joke', className: 'joke' + (showAnim ? ' animate' : '') }, joke)
}
