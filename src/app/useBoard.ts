import { useEffect, useRef, useState } from 'react';
import type { Board } from '../board/board';
import { loadBoard, resetSavedBoard, saveBoard } from '../board/storage';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.';
}

export function useBoard(setNotice: (notice: string) => void) {
  const [initial] = useState(loadBoard);
  const [board, setBoard] = useState(initial.board);
  const boardRef = useRef(board);
  const [storageBlocked, setStorageBlocked] = useState(initial.blocked);
  const [storageWarning, setStorageWarning] = useState(initial.warning);
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    if (storageBlocked) return;
    try {
      saveBoard(board);
      setStorageWarning(null);
    } catch (error) {
      setStorageWarning(`Autosave failed. Changes are only in this tab. ${errorMessage(error)}`);
    }
  }, [board, storageBlocked]);

  function change(operation: (current: Board) => Board): boolean {
    try {
      const next = operation(boardRef.current);
      boardRef.current = next;
      setBoard(next);
      setActionError('');
      return true;
    } catch (error) {
      setActionError(errorMessage(error));
      return false;
    }
  }

  function retryStorage() {
    try {
      const next = storageBlocked ? resetSavedBoard() : boardRef.current;
      if (!storageBlocked) saveBoard(next);
      boardRef.current = next;
      setBoard(next);
      setStorageBlocked(false);
      setStorageWarning(null);
      setNotice(storageBlocked ? 'Saved data reset. Start a fresh list.' : 'Your list is saved in this browser.');
    } catch (error) {
      setStorageWarning(`Storage is still unavailable. ${errorMessage(error)}`);
    }
  }
  return { board, boardRef, change, storageBlocked, storageWarning, retryStorage, actionError, setActionError };
}
