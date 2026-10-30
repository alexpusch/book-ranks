import { render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createBoard } from '../board/board';
import { ExportBoard } from './ExportBoard';

const originalUrl = window.location.href;
afterEach(() => window.history.replaceState(null, '', originalUrl));

it.each([
  ['/book-ranklist/', '/book-ranklist/'],
  ['/book-ranklist/?source=share&list=private', '/book-ranklist/'],
  ['/book-ranklist/?source=share#rankings', '/book-ranklist/#rankings'],
])('adds the current URL without its query string for %s', (current, expected) => {
  window.history.replaceState(null, '', current);
  const { container } = render(<ExportBoard board={createBoard()} />);
  const board = container.querySelector('.export-board')!;
  expect(board.lastElementChild).toHaveClass('export-url');
  expect(board.lastElementChild?.textContent).toBe(`${window.location.origin}${expected}`);
});
