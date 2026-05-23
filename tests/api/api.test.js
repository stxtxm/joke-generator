const { validateJoke, getPromptForModel, HUMOR_STYLES } = require('../../server');

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
  test('getPromptForModel should include best jokes and style', () => {
    const bestJokes = [{ content: 'Best joke 1' }];
    const recentJokes = [{ content: 'Recent joke 1' }];
    const worstJokes = [{ content: 'Worst joke 1' }];
    const stats = { wordplayRate: 0.6, emojiRate: 0.6, avgLength: 50 };

    const prompt = getPromptForModel('qwen:1.8b', bestJokes, recentJokes, worstJokes, testStyle, stats);

    expect(prompt).toContain('Best joke 1');
    expect(prompt).toContain('Recent joke 1');
    expect(prompt).toContain('Worst joke 1');
    expect(prompt).toContain(testStyle.label);
    expect(prompt).toContain('jeux de mots');
    expect(prompt).toContain('emojis');
  });
});