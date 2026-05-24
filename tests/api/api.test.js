const { validateJoke, getOllamaPrompt, getGeminiPrompt, HUMOR_STYLES } = require('../../server');

const testStyle = HUMOR_STYLES[0];

describe('Validation', () => {
  test('validateJoke should return false for truncated jokes', () => {
    expect(validateJoke('Voici une blague qui')).toBe(false);
  });
  test('validateJoke should return true for complete jokes', () => {
    expect(validateJoke('Pourquoi les plongeurs plongent-ils toujours en arrière ? Parce que sinon ils tombent dans le bateau.')).toBe(true);
  });
});

describe('Prompt Generation', () => {
  test('getOllamaPrompt should be short and include style + example', () => {
    const bestJokes = [{ content: 'Best joke 1' }];
    const prompt = getOllamaPrompt(bestJokes, testStyle);
    expect(prompt).toContain('Best joke 1');
    expect(prompt).toContain(testStyle.label);
    expect(prompt.length).toBeLessThan(350);
  });

  test('getGeminiPrompt should include best jokes, recent, worst and style hints', () => {
    const bestJokes = [{ content: 'Best joke 1', has_emoji: 0, has_wordplay: 1 }];
    const recentJokes = [{ content: 'Recent joke 1' }];
    const worstJokes = [{ content: 'Worst joke 1' }];
    const stats = { wordplayRate: 0.6, emojiRate: 0.6, avgLength: 50 };
    const prompt = getGeminiPrompt(bestJokes, recentJokes, worstJokes, testStyle, stats);
    expect(prompt).toContain('Best joke 1');
    expect(prompt).toContain('Recent joke 1');
    expect(prompt).toContain('Worst joke 1');
    expect(prompt).toContain(testStyle.label);
  });
});