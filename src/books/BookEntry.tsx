import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { importBooks, type Board, type BoardChange } from '../board/board';
import { getModelDownloadProgress, subscribeModelDownload } from '../integrations/chromeAi/prompt';
import { useStoredPreference } from '../app/useStoredPreference';
import { extractBooks } from '../bookResolution/extraction';
import { useBooks } from './BookProvider';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.';
}

export function BookEntry({
  board,
  onChange,
  onNotice,
}: {
  board: Board;
  onChange: BoardChange;
  onNotice: (notice: string) => void;
}) {
  const [input, setInput] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [extracting, setExtracting] = useState(false);
  const extraction = useRef<AbortController | null>(null);
  const { addAiBooks } = useBooks();
  const preference = useStoredPreference('shelf-life.entry-mode', ['ai', 'structured', 'bulk'], null);
  const [selectedEntryMode, setEntryMode] = useState(preference.value);
  const aiEnabled = new URLSearchParams(window.location.search).get('ai') === 'true';
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const entryMode =
    selectedEntryMode === 'bulk'
      ? 'bulk'
      : aiEnabled && aiAvailable
        ? (selectedEntryMode ?? (aiReady ? 'ai' : 'structured'))
        : 'structured';
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [inputError, setInputError] = useState('');
  const downloadProgress = useSyncExternalStore(subscribeModelDownload, getModelDownloadProgress);
  const downloading = downloadProgress !== null;

  useEffect(
    () => () => {
      extraction.current?.abort();
      extraction.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!aiEnabled || downloading) return;
    let cancelled = false;
    async function checkAvailability() {
      try {
        const availability = await window.LanguageModel?.availability();
        if (!cancelled) {
          setAiAvailable(
            availability === 'available' || availability === 'downloadable' || availability === 'downloading',
          );
          setAiReady(availability === 'available');
          setEntryMode((mode) => mode ?? (availability === 'available' ? 'ai' : 'structured'));
        }
      } catch (error) {
        if (!cancelled) setInputError(`Could not check Chrome AI availability. ${errorMessage(error)}`);
      }
    }
    void checkAvailability();
    return () => {
      cancelled = true;
    };
  }, [aiEnabled, downloading]);

  async function addBook() {
    if (entryMode === 'ai') {
      if (extraction.current) return;
      setInputError('');
      if (!input.trim()) {
        setInputError('Enter at least one book title.');
        return;
      }
      const controller = new AbortController();
      extraction.current = controller;
      setExtracting(true);
      try {
        const entries = await extractBooks(input, () => {}, controller.signal);
        controller.signal.throwIfAborted();
        if (!addAiBooks(entries)) throw new Error('Could not add the extracted books. Please try again.');
        setInput('');
        onNotice(`Added ${entries.length} ${entries.length === 1 ? 'book' : 'books'} to your reading pile.`);
      } catch (error) {
        if (!controller.signal.aborted) setInputError(`Could not add books. ${errorMessage(error)}`);
      } finally {
        if (extraction.current === controller) {
          extraction.current = null;
          setExtracting(false);
        }
      }
      return;
    }
    setInputError('');
    try {
      const next = importBooks(board, entryMode === 'bulk' ? bulkInput : [{ title, author }]);
      const addedCount = next.books.length - board.books.length;
      if (onChange(() => next)) {
        if (entryMode === 'bulk') setBulkInput('');
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
    <section className="entry-panel" aria-labelledby="entry-title">
      <h2 id="entry-title">Add books</h2>
      <form
        id="entry-form"
        onSubmit={(event) => {
          event.preventDefault();
          void addBook();
        }}
      >
        <div className="entry-modes" role="group" aria-label="Book addition mode">
          <button type="button" aria-pressed={entryMode === 'structured'} onClick={() => selectEntryMode('structured')}>
            Manual entry
          </button>
          {aiEnabled && aiAvailable && (
            <button type="button" aria-pressed={entryMode === 'ai'} onClick={() => selectEntryMode('ai')}>
              AI assisted
            </button>
          )}
          <button type="button" aria-pressed={entryMode === 'bulk'} onClick={() => selectEntryMode('bulk')}>
            Bulk insert
          </button>
        </div>
        <p className="entry-mode-help" id="entry-mode-help">
          {entryMode === 'ai' ? (
            <>
              Paste a list or library page, including titles and authors. Chrome's built-in, on-device LLM extracts all
              books and adds them together.{' '}
              {!aiReady && (
                <span className="model-download-warning">
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <path d="M12 3 2 21h20L12 3Z" strokeLinejoin="round" />
                    <path d="M12 9v5m0 3v1" />
                  </svg>
                  This will require initial Gemini Nano download
                </span>
              )}
              {!aiReady && '. '}
              <a href="https://developer.chrome.com/docs/ai/prompt-api" target="_blank" rel="noreferrer">
                About the Prompt API
              </a>
            </>
          ) : entryMode === 'bulk' ? (
            'Add one book per line using book title | author(s) name. Authors are optional; blank lines are ignored.'
          ) : (
            ''
          )}
        </p>
        {entryMode === 'ai' ? (
          <div className="bulk-entry">
            <label className="entry-field" htmlFor="book-input">
              <span>Book title and author in natural language</span>
              <textarea
                id="book-input"
                rows={6}
                value={input}
                disabled={extracting}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  'Paste your library or book list here, for example:\nDune by Frank Herbert\nPiranesi by Susanna Clarke'
                }
                aria-invalid={!!inputError}
                aria-describedby={inputError ? 'input-error entry-mode-help' : 'input-help entry-mode-help'}
              />
            </label>
            <button className="primary-button" type="submit" disabled={extracting} aria-busy={extracting}>
              {extracting && (
                <svg
                  className="entry-spinner"
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" opacity=".3" />
                  <path d="M12 3a9 9 0 0 1 9 9" />
                </svg>
              )}
              + Add books
            </button>
          </div>
        ) : entryMode === 'bulk' ? (
          <div className="bulk-entry">
            <label className="entry-field" htmlFor="bulk-book-input">
              <span>Books to add</span>
              <textarea
                id="bulk-book-input"
                rows={5}
                value={bulkInput}
                onChange={(event) => setBulkInput(event.target.value)}
                placeholder={'Dune | Frank Herbert\nGood Omens | Terry Pratchett, Neil Gaiman'}
                aria-invalid={!!inputError}
                aria-describedby={inputError ? 'input-error entry-mode-help' : 'entry-mode-help'}
              />
            </label>
            <button className="primary-button" type="submit">
              + Add books
            </button>
          </div>
        ) : (
          <div className="structured-fields">
            <label className="entry-field" htmlFor="book-title">
              <span>Book name</span>
              <input
                id="book-title"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setEntryMode('structured');
                }}
                placeholder="The Lord of the Rings"
                aria-invalid={!!inputError}
                aria-describedby={inputError ? 'input-error' : 'input-help'}
              />
            </label>
            <label className="entry-field" htmlFor="book-author">
              <span>
                Author <span className="field-optional">(optional)</span>
              </span>
              <input
                id="book-author"
                value={author}
                onChange={(event) => {
                  setAuthor(event.target.value);
                  setEntryMode('structured');
                }}
                placeholder="J. R. R. Tolkien"
                aria-describedby="input-help"
              />
            </label>
            <button className="primary-button" type="submit">
              + Add book
            </button>
          </div>
        )}
        {aiEnabled && downloadProgress !== null && (
          <div className="model-download">
            <label htmlFor="model-download-progress">
              Downloading Chrome AI model <span>{Math.round(downloadProgress * 100)}%</span>
            </label>
            <progress id="model-download-progress" max={1} value={downloadProgress} />
          </div>
        )}
        {inputError && (
          <p className="field-error" id="input-error" role="alert">
            {inputError}
          </p>
        )}
      </form>
      {preference.warning && (
        <p className="field-error" role="alert">
          {preference.warning}
        </p>
      )}
    </section>
  );
}
