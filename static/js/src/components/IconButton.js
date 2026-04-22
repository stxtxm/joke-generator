import React from 'react'

export default function IconButton({ onClick, ariaLabel, iconSrc, active }) {
  return (
    React.createElement('button', { className: 'icon' + (active ? ' active' : ''), onClick, 'aria-label': ariaLabel },
      React.createElement('img', { src: iconSrc, width: 20, height: 20, alt: ariaLabel })
    )
  )
}
