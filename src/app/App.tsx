import { useEffect, useRef, useState } from 'react';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { BookContent } from '../books/BookContent';
import { BookEntry } from '../books/BookEntry';
import { BookProvider } from '../books/BookProvider';
import { TierSettings } from '../ranking/TierSettings';
import { Gallery } from '../ranking/Gallery';
import { RankingBoard } from '../ranking/RankingBoard';
import { useRankingDrag } from '../ranking/useRankingDrag';
import { ExportBoard } from '../export/ExportBoard';
import { CoverExportError, exportJpeg } from '../export/exportJpeg';
import { GALLERY, moveBook, removeBook } from '../board/board';
import { useBoard } from './useBoard';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.';
}

export function App() {
  const [notice, setNotice] = useState('');
  const { board, boardRef, change, storageBlocked, storageWarning, retryStorage, actionError, setActionError } = useBoard(setNotice);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [coverExportFailed, setCoverExportFailed] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const { sensors, collisionDetection, activeBook, onDragStart, onDragEnd, onDragCancel } =
    useRankingDrag(boardRef, change, setNotice, (error) => setActionError(errorMessage(error)));

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    return () => { delete document.documentElement.dataset.theme; };
  }, [darkMode]);

  async function download(allowPlaceholders = false) {
    setExporting(true);
    setActionError('');
    setCoverExportFailed(false);
    try {
      if (!exportRef.current) throw new Error('The export board is not ready.');
      await exportJpeg(exportRef.current, allowPlaceholders);
      setNotice('Your tier list JPEG is ready.');
    } catch (error) {
      setActionError(`Export failed. ${errorMessage(error)}`);
      setCoverExportFailed(error instanceof CoverExportError);
    } finally {
      setExporting(false);
    }
  }

  const rankedCount = board.books.length - board.gallery.length;

  return (
    <BookProvider board={board} onChange={change}>
      <main>
        {storageWarning && <div className="warning-banner" role="alert"><div><strong>Browser storage needs attention</strong><p>{storageWarning}</p></div>
          <button className="secondary-button" onClick={retryStorage}>{storageBlocked ? 'Reset saved data and current list' : 'Retry saving'}</button></div>}
        <BookEntry board={board} onChange={change} onNotice={setNotice} />
        <DndContext sensors={sensors} collisionDetection={collisionDetection}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
          <Gallery board={board} onRemove={(id) => {
            if (change((current) => removeBook(current, id))) setNotice('Book removed.');
          }} />
          {actionError && <div className="error-banner" role="alert">{actionError}</div>}
          {coverExportFailed && <div className="warning-banner">
            <button onClick={() => void download()}>Retry export</button>
            <button onClick={() => void download(true)}>Export with placeholders for failed covers</button>
          </div>}
          <p className="sr-only" role="status" aria-live="polite">{notice}</p>
          <section className="ranking-section" aria-labelledby="ranking-title">
            <div className="section-heading board-heading">
              <div><h2 id="ranking-title">Rank the books</h2>
                <p>{rankedCount} of {board.books.length} books ranked <span aria-hidden="true">·</span></p></div>
              <div className="board-toolbar">
                <button className="secondary-button" onClick={() => setSettingsOpen(true)}>⚙ Tier settings</button>
                <button className="theme-toggle" type="button" role="switch" aria-checked={darkMode}
                  aria-label={darkMode ? 'Light mode' : 'Dark mode'} title={darkMode ? 'Light mode' : 'Dark mode'}
                  onClick={() => setDarkMode((dark) => !dark)}>
                  <span className="theme-switch-track" aria-hidden="true">
                    <span className="theme-switch-thumb">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7">
                        {darkMode ? <>
                          <circle cx="12" cy="12" r="4" />
                          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
                        </> : <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />}
                      </svg>
                    </span>
                  </span>
                </button>
              </div>
            </div>
            <RankingBoard board={board} onRemove={(id) => {
              if (change((current) => moveBook(current, id, GALLERY))) setNotice('Book returned to your reading pile.');
            }} />
          </section>
          <DragOverlay>{activeBook ? <article className="book-card drag-preview"><BookContent book={activeBook} /></article> : null}</DragOverlay>
        </DndContext>
        <footer className="site-footer"></footer>
      </main>
      <button className="floating-export-button" onClick={() => void download()} disabled={exporting}
        aria-label={exporting ? 'Creating JPEG...' : 'Download'}>
        <span className="floating-export-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 3.75v10.5m0 0 4-4m-4 4-4-4M5 15.75v3.5h14v-3.5" />
            <path d="m18.7 3.6.45 1.3 1.3.45-1.3.45-.45 1.3-.45-1.3-1.3-.45 1.3-.45.45-1.3Z" />
          </svg>
        </span>
        <span className="floating-export-copy">
          <span>{exporting ? 'Creating JPEG...' : 'Download'}</span>
        </span>
      </button>
      {settingsOpen && <TierSettings board={board} onChange={change} onClose={() => setSettingsOpen(false)} />}
      <div className="export-stage" aria-hidden="true"><div ref={exportRef}><ExportBoard board={board} /></div></div>
    </BookProvider>
  );
}
