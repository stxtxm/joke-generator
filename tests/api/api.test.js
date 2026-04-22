const { validateJoke } = require('../../server'); // Need to export this in server.js

describe('Validation', () => {
  test('validateJoke should return false for truncated jokes', () => {
    expect(validateJoke('Voici une blague qui')).toBe(false);
  });
  test('validateJoke should return true for complete jokes', () => {
    expect(validateJoke('Pourquoi les plongeurs plongent-ils toujours en arrière ? Parce que sinon ils tombent dans le bateau.')).toBe(true);
  });
});
