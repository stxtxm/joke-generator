export async function generateJoke() {
  const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
  if (!res.ok) throw new Error('Gen failed')
  return res.json()
}

export async function rateJoke(joke, rating) {
  const res = await fetch('/api/rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ joke, rating }) })
  if (!res.ok) throw new Error('Rate failed')
  return res.json()
}

export async function getMetrics(joke) {
  const q = new URLSearchParams({ content: joke })
  const res = await fetch(`/api/joke/metrics?${q.toString()}`)
  if (!res.ok) return { likes: 0, dislikes: 0, rating: 0 }
  return res.json()
}
