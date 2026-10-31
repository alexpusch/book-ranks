import { useEffect, useState, useSyncExternalStore } from 'react';
import { importBooks, queueBook, type Board, type BoardChange } from '../board/board';
import { getModelDownloadProgress, subscribeModelDownload } from '../integrations/chromeAi/prompt';
import { useStoredPreference } from '../app/useStoredPreference';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.';
}

export function BookEntry({ board, onChange, onNotice }: {
  board: Board; onChange: BoardChange; onNotice: (notice: string) => void;
}) {
  const [input, setInput] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const preference = useStoredPreference('shelf-life.entry-mode', ['ai', 'structured', 'bulk'], null);
  const [selectedEntryMode, setEntryMode] = useState(preference.value);
  const aiEnabled = new URLSearchParams(window.location.search).get('ai') === 'true';
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const entryMode = selectedEntryMode === 'bulk' ? 'bulk'
    : aiEnabled && aiAvailable ? selectedEntryMode ?? (aiReady ? 'ai' : 'structured') : 'structured';
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [entryOpen, setEntryOpen] = useState(true);
  const [inputError, setInputError] = useState('');
  const downloadProgress = useSyncExternalStore(subscribeModelDownload, getModelDownloadProgress);
  const downloading = downloadProgress !== null;

  useEffect(() => {
    if (!aiEnabled || downloading) return;
    let cancelled = false;
    async function checkAvailability() {
      try {
        const availability = await window.LanguageModel?.availability();
        if (!cancelled) {
          setAiAvailable(availability === 'available' || availability === 'downloadable' || availability === 'downloading');
          setAiReady(availability === 'available');
          setEntryMode((mode) => mode ?? (availability === 'available' ? 'ai' : 'structured'));
        }
      } catch (error) {
        if (!cancelled) setInputError(`Could not check Chrome AI availability. ${errorMessage(error)}`);
      }
    }
    void checkAvailability();
    return () => { cancelled = true; };
  }, [aiEnabled, downloading]);

  function addBook() {
    setInputError('');
    try {
      const next = entryMode === 'ai' ? queueBook(board, input)
        : importBooks(board, entryMode === 'bulk' ? bulkInput : [{ title, author }]);
      const addedCount = next.books.length - board.books.length;
      if (onChange(() => next)) {
        if (entryMode === 'ai') setInput('');
        else if (entryMode === 'bulk') setBulkInput('');
        else {
          setTitle('');
          setAuthor('');
        }

        onNotice(`Added ${addedCount} ${addedCount === 1 ? 'book' : 'books'} to your reading pile.`);
      }
    } catch (error) {
      setInputError(`Could not add book. ${errorMessage(error)}`);
    }
  }

  function selectEntryMode(mode: 'ai' | 'structured' | 'bulk') {
    setEntryMode(mode);
    preference.select(mode);
    setInputError('');
  }

  return (
    <section className="entry-panel" aria-labelledby="entry-title" data-collapsed={!entryOpen}>
      <h2 id="entry-title">
        <button className="entry-toggle" type="button" aria-expanded={entryOpen}
          aria-controls="entry-form" onClick={() => setEntryOpen((open) => !open)}>
          Add books
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d={entryOpen ? 'm5 12 5-5 5 5' : 'm5 8 5 5 5-5'} />
          </svg>
        </button>
      </h2>
      <form id="entry-form" hidden={!entryOpen} onSubmit={(event) => {
        event.preventDefault();
        addBook();
      }}>
        <div className="entry-modes" role="group" aria-label="Book addition mode">
          <button type="button" aria-pressed={entryMode === 'structured'}
            onClick={() => selectEntryMode('structured')}>Manual entry</button>
          {aiEnabled && aiAvailable && <button type="button" aria-pressed={entryMode === 'ai'}
            onClick={() => selectEntryMode('ai')}>AI assisted</button>}
          <button type="button" aria-pressed={entryMode === 'bulk'}
            onClick={() => selectEntryMode('bulk')}>Bulk insert</button>
        </div>
        <p className="entry-mode-help" id="entry-mode-help">{entryMode === 'ai'
          ? <>Uses Chrome's built-in, on-device LLM to clean up your book details. {!aiReady && <span className="model-download-warning">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M12 3 2 21h20L12 3Z" strokeLinejoin="round" />
              <path d="M12 9v5m0 3v1" />
            </svg>
            This will require initial Gemini Nano download
          </span>}{!aiReady && '. '}<a href="https://developer.chrome.com/docs/ai/prompt-api" target="_blank" rel="noreferrer">About the Prompt API</a></>
          : entryMode === 'bulk'
            ? 'Add one book per line using book title | author(s) name. Authors are optional; blank lines are ignored.'
            : ''}</p>
        {entryMode === 'ai' ? <div className="ai-entry-row"><label className="entry-field" htmlFor="book-input">
          <span>Book title and author in natural language</span>
          <input id="book-input" value={input} onChange={(event) => setInput(event.target.value)}
            placeholder="The Lord of the Rings by J. R. R. Tolkien"
            aria-invalid={!!inputError} aria-describedby={inputError ? 'input-error entry-mode-help' : 'input-help entry-mode-help'} />
        </label>
          <button className="primary-button" type="submit">+ Add book</button>
        </div> : entryMode === 'bulk' ? <div className="bulk-entry">
          <label className="entry-field" htmlFor="bulk-book-input">
            <span>Books to add</span>
            <textarea id="bulk-book-input" rows={5} value={bulkInput}
              onChange={(event) => setBulkInput(event.target.value)}
              placeholder={'Dune | Frank Herbert\nGood Omens | Terry Pratchett, Neil Gaiman'}
              aria-invalid={!!inputError}
              aria-describedby={inputError ? 'input-error entry-mode-help' : 'entry-mode-help'} />
          </label>
          <button className="primary-button" type="submit">+ Add books</button>
        </div> : <div className="structured-fields">
          <label className="entry-field" htmlFor="book-title"><span>Book name</span>
            <input id="book-title" value={title} onChange={(event) => { setTitle(event.target.value); setEntryMode('structured'); }}
              placeholder="The Lord of the Rings" aria-invalid={!!inputError} aria-describedby={inputError ? 'input-error' : 'input-help'} />
          </label>
          <label className="entry-field" htmlFor="book-author"><span>Author <span className="field-optional">(optional)</span></span>
            <input id="book-author" value={author} onChange={(event) => { setAuthor(event.target.value); setEntryMode('structured'); }}
              placeholder="J. R. R. Tolkien" aria-describedby="input-help" />
          </label>
          <button className="primary-button" type="submit">+ Add book</button>
        </div>}
        {aiEnabled && downloadProgress !== null && <div className="model-download">
          <label htmlFor="model-download-progress">Downloading Chrome AI model <span>{Math.round(downloadProgress * 100)}%</span></label>
          <progress id="model-download-progress" max={1} value={downloadProgress} />
        </div>}
        {inputError && <p className="field-error" id="input-error" role="alert">{inputError}</p>}
      </form>
      {preference.warning && <p className="field-error" role="alert">{preference.warning}</p>}
    </section>
  );
}
