const { validateJoke, getOllamaPrompt, getGeminiPrompt } = require('../../server');
describe('Joke Generation Logic', () => {
  test('validateJoke should reject short jokes', () => {
    expect(validateJoke('Trop court.')).toBe(false);
  });

  test('validateJoke should reject jokes without punctuation', () => {
    expect(validateJoke('Ceci est une blague sans ponctuation')).toBe(false);
  });

  test('getOllamaPrompt should be short even with empty bestJokes', () => {
    const prompt = getOllamaPrompt([], { label: 'Test', desc: 'test', id: 'test', temperature: 0.8 });
    expect(prompt.length).toBeLessThan(400);
    expect(prompt).toContain('Test');
  });

  test('getGeminiPrompt should handle empty bestJokes gracefully', () => {
    const prompt = getGeminiPrompt([], [], [], { label: 'Test', desc: 'test', id: 'test', temperature: 0.8 }, { wordplayRate: 0, emojiRate: 0, avgLength: 0 });
    expect(prompt).not.toContain('undefined');
    expect(prompt).toContain('Test');
  });

  test('validateJoke should accept a cynical twist', () => {
    const joke = 'Pourquoi le travail ? Parce que la paresse est un luxe.';
    expect(validateJoke(joke)).toBe(true);
  });
});
