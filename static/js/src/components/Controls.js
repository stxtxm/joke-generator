import React from 'react'
import IconButton from './IconButton.js'

export default function Controls({ onGenerate, onRate, loading, metrics, userRating }) {
  return (
    React.createElement('div', { className: 'actions' },
      React.createElement('button', { onClick: onGenerate, disabled: loading, className: 'primary' }, loading ? 'Génération…' : 'Nouvelle blague'),
      React.createElement(IconButton, { onClick: () => onRate(1), ariaLabel: "J'aime", iconSrc: '/like.svg', active: userRating === 1 }),
      React.createElement(IconButton, { onClick: () => onRate(-1), ariaLabel: "Je n'aime pas", iconSrc: '/dislike.svg', active: userRating === -1 })
    )
  )
}
