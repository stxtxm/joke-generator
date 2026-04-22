import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './src/App.js'

const root = createRoot(document.getElementById('root'))
root.render(
  React.createElement(BrowserRouter, null, React.createElement(App))
)
