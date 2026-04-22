const { validateJoke, getPromptForModel } = require('../../server');

describe('Validation', () => {
  test('validateJoke should return false for truncated jokes', () => {
    expect(validateJoke('Voici une blague qui')).toBe(false);
  });
  test('validateJoke should return true for complete jokes', () => {
    expect(validateJoke('Pourquoi les plongeurs plongent-ils toujours en arrière ? Parce que sinon ils tombent dans le bateau.')).toBe(true);
  });
});

describe('Prompt Generation', () => {
  test('getPromptForModel should include best jokes and exclude worst/recent', () => {
    const bestJokes = [{ content: 'Best joke 1' }];
    const recentJokes = [{ content: 'Recent joke 1' }];
    const worstJokes = [{ content: 'Worst joke 1' }];
    const stats = { totalLikes: 6, wordplayRate: 0.6, emojiRate: 0.4, avgLength: 50 };
    
    const prompt = getPromptForModel('gemma2:2b', bestJokes, recentJokes, worstJokes, stats);
    
    expect(prompt).toContain('Best joke 1');
    expect(prompt).toContain('Recent joke 1');
    expect(prompt).toContain('Worst joke 1');
    expect(prompt).toContain('privilégie les jeux de mots');
    expect(prompt).toContain('utilise souvent des emojis');
    expect(prompt).toContain('très concis');
  });
});
