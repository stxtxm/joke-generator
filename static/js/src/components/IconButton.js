import React from 'react'

export default function IconButton({ onClick, ariaLabel, iconSrc, active, disabled }) {
  return (
    React.createElement('button', { className: 'icon' + (active ? ' active' : '') + (disabled ? ' disabled' : ''), onClick: disabled ? undefined : onClick, 'aria-label': ariaLabel, 'aria-disabled': disabled },
      React.createElement('img', { src: iconSrc, width: 20, height: 20, alt: ariaLabel })
    )
  )
}
