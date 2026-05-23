async function getAvailableModels() {
  const ollamaModels = [];
  try {
    const res = await fetch('http://joke-ollama:11434/api/tags');
    if (res.ok) {
        const json = await res.json();
        json.models.forEach(m => ollamaModels.push(m.name));
    }
  } catch (e) {
    console.log("Ollama not reachable, skipping models", e.message);
  }

  // Always include gemini and the gpto service
  return [...ollamaModels, 'gemini-1.5-flash', 'gemini-2.5-flash-lite', 'gpto'];
}

module.exports = { getAvailableModels };
