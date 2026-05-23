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

  return [...ollamaModels, 'gpto'];
}

module.exports = { getAvailableModels };
