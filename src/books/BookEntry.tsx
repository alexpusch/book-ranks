import { useEffect, useState, useSyncExternalStore } from 'react';
import { importBooks, queueBook, type Board, type BoardChange } from '../board/board';
import { getModelDownloadProgress, subscribeModelDownload } from '../integrations/chromeAi/prompt';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.';
}

export function BookEntry({ board, onChange, onNotice }: {
  board: Board; onChange: BoardChange; onNotice: (notice: string) => void;
}) {
  const [input, setInput] = useState('');
  const [selectedEntryMode, setEntryMode] = useState<'ai' | 'structured' | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const entryMode = aiAvailable ? selectedEntryMode ?? (aiReady ? 'ai' : 'structured') : 'structured';
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [entryOpen, setEntryOpen] = useState(true);
  const [inputError, setInputError] = useState('');
  const downloadProgress = useSyncExternalStore(subscribeModelDownload, getModelDownloadProgress);
  const downloading = downloadProgress !== null;

  useEffect(() => {
    if (downloading) return;
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
  }, [downloading]);

  function addBook() {
    setInputError('');
    try {
      const next = entryMode === 'ai' ? queueBook(board, input) : importBooks(board, [{ title, author }]);
      if (onChange(() => next)) {
        if (entryMode === 'ai') setInput('');
        else {
          setTitle('');
          setAuthor('');
        }
        onNotice('Added 1 book to your reading pile.');
      }
    } catch (error) {
      setInputError(`Could not add book. ${errorMessage(error)}`);
    }
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
        {aiAvailable && <div className="entry-modes" role="group" aria-label="Book addition mode">
          <button type="button" aria-pressed={entryMode === 'structured'}
            onClick={() => { setEntryMode('structured'); setInputError(''); }}>Manual entry</button>
          <button type="button" aria-pressed={entryMode === 'ai'}
            onClick={() => { setEntryMode('ai'); setInputError(''); }}>AI assisted</button>
        </div>}
        <p className="entry-mode-help" id="entry-mode-help">{entryMode === 'ai'
          ? <>Uses Chrome's built-in, on-device LLM to clean up your book details. {!aiReady && <span className="model-download-warning">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M12 3 2 21h20L12 3Z" strokeLinejoin="round" />
              <path d="M12 9v5m0 3v1" />
            </svg>
            This will require initial Gemini Nano download
          </span>}{!aiReady && '. '}<a href="https://developer.chrome.com/docs/ai/prompt-api" target="_blank" rel="noreferrer">About the Prompt API</a></>
          : ''}</p>
        {entryMode === 'ai' ? <div className="ai-entry-row"><label className="entry-field" htmlFor="book-input">
          <span>Book title and author in natural language</span>
          <input id="book-input" value={input} onChange={(event) => setInput(event.target.value)}
            placeholder="The Lord of the Rings by J. R. R. Tolkien"
            aria-invalid={!!inputError} aria-describedby={inputError ? 'input-error entry-mode-help' : 'input-help entry-mode-help'} />
        </label>
          <button className="primary-button" type="submit">+ Add book</button>
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
        {downloadProgress !== null && <div className="model-download">
          <label htmlFor="model-download-progress">Downloading Chrome AI model <span>{Math.round(downloadProgress * 100)}%</span></label>
          <progress id="model-download-progress" max={1} value={downloadProgress} />
        </div>}
        {inputError && <p className="field-error" id="input-error" role="alert">{inputError}</p>}
      </form>
    </section>
  );
}
