const { validateJoke, getPromptForModel } = require('../../server');

describe('Joke Generation Logic', () => {
  test('validateJoke should reject short jokes', () => {
    expect(validateJoke('Trop court.')).toBe(false);
  });

  test('validateJoke should reject jokes without punctuation', () => {
    expect(validateJoke('Ceci est une blague sans ponctuation')).toBe(false);
  });

  test('getPromptForModel should not contain "UNIQUEMENT" or placeholder instructions', () => {
    const prompt = getPromptForModel('test', [], [], [], { wordplayRate: 0, emojiRate: 0, avgLength: 100 });
    // The prompt should tell the model what to do, not include its own instructions to us
    expect(prompt).not.toContain('Ta réponse doit être UNIQUEMENT la blague');
  });

  test('validateJoke should accept a cynical twist', () => {
    const joke = 'Pourquoi le travail ? Parce que la paresse est un luxe.';
    // Note: Our current hasTwist logic requires '?'
    expect(validateJoke(joke)).toBe(true);
  });
});
