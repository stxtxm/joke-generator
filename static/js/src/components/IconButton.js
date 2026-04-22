import React from 'react'

export default function IconButton({ onClick, ariaLabel, iconSrc, active }) {
  const cls = ['icon']
  if (active) cls.push('active')
  return (
    React.createElement('button', { className: cls.join(' '), onClick, 'aria-label': ariaLabel },
      React.createElement('img', { src: iconSrc, width: 20, height: 20, alt: ariaLabel })
    )
  )
}
