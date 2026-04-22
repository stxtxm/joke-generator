import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import JokeCard from '../../static/js/src/components/JokeCard';

test('renders joke correctly', () => {
  render(<JokeCard joke="Ceci est une blague" loading={false} />);
  expect(screen.getByText('Ceci est une blague')).toBeInTheDocument();
});
