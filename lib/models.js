const { execSync } = require('child_process');

async function getAvailableModels() {
  const ollamaModels = [];
  try {
    // Check if ollama is reachable before trying
    const res = execSync('curl -s http://ollama:11434/api/tags').toString();
    const json = JSON.parse(res);
    json.models.forEach(m => ollamaModels.push(m.name));
  } catch (e) {
    console.log("Ollama not reachable, skipping models");
  }

  // Always include gemini
  return [...ollamaModels, 'gemini-flash-latest'];
}

module.exports = { getAvailableModels };
