import React from 'react'

export default function JokeCard({ joke, loading }) {
  return (
    React.createElement('div', { id: 'joke', className: 'joke', style: { opacity: loading ? 0.6 : 1 } }, joke)
  )
}
