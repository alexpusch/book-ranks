import { useEffect, useRef, useState } from 'react';
import type { Book } from '../board/board';
import type { CoverSelection } from '../board/coverSelection';
import type { LookupState } from '../bookResolution/lookupState';
import { useEditions } from '../bookResolution/editions';
import { readLocalCover } from './localCover';
import { CoverGallery, CoverOption } from './CoverGallery';

export function BookEditor({ book, state, onSave, onSelect, onClose }: {
  book: Book; state?: LookupState; onSave: (title: string, author: string, retry: boolean) => string | null;
  onSelect: (selection: CoverSelection) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pasteTarget = useRef<HTMLDivElement>(null);
  const imageController = useRef<AbortController | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [pasteReady, setPasteReady] = useState(false);
  const [imageError, setImageError] = useState('');
  useEffect(() => () => imageController.current?.abort(), []);
  useEffect(() => { if (pasteReady) pasteTarget.current?.focus(); }, [pasteReady]);
  async function selectImage(file: File) {
    if (imageController.current) return;
    const controller = new AbortController();
    imageController.current = controller;
    setImageBusy(true);
    setImageError('');
    try {
      const selection = await readLocalCover(file, controller.signal);
      controller.signal.throwIfAborted();
      onSelect(selection);
    } catch (error) {
      if (!controller.signal.aborted) setImageError(error instanceof Error ? error.message : 'Could not load the cover image.');
    } finally {
      if (!controller.signal.aborted) setImageBusy(false);
      if (imageController.current === controller) imageController.current = null;
    }
  }
  const workId = book.matchedWorkId ?? (book.coverSelection?.kind === 'open-library' ? book.coverSelection.workId : undefined);
  const { editionWork, editionBusy, editionError, loadEditions } = useEditions(workId, book);
  const previousBook = useRef(book);
  useEffect(() => {
    const previous = previousBook.current;
    setTitle((title) => title === previous.title ? book.title : title);
    setAuthor((author) => author === previous.author ? book.author : author);
    previousBook.current = book;
  }, [book.title, book.author]);
  const backdropPress = useRef(false);
  const busy = state?.outcome === 'queued' || state?.outcome === 'loading' || state?.outcome === 'extracting';
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  function outsidePanel(x: number, y: number) {
    const bounds = dialog.current!.getBoundingClientRect();
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
  }
  return <dialog className="settings-drawer cover-chooser book-editor" ref={dialog} onCancel={onClose} aria-label="Book details"
    onPaste={(event) => {
      if (!pasteReady || imageBusy) return;
      event.preventDefault();
      const file = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'));
      if (file) void selectImage(file);
      else setImageError('No image found on the clipboard. Copy an image and paste again, or upload a photo.');
    }}
    onPointerDown={(event) => { backdropPress.current = event.target === event.currentTarget && outsidePanel(event.clientX, event.clientY); }}
    onClick={(event) => {
      if (backdropPress.current && event.target === event.currentTarget && outsidePanel(event.clientX, event.clientY)) onClose();
      backdropPress.current = false;
    }}>
    <button className="icon-button book-editor-close" aria-label="Close book editor" onClick={onClose}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    </button>
    <form className="book-editor-form" onSubmit={(event) => {
      event.preventDefault(); setError(onSave(title, author, false));
    }}>
      <input className="book-name-input" aria-label="Book name" placeholder="Book name" value={title}
        onChange={(event) => setTitle(event.target.value)} required />
      <input className="book-author-input" aria-label="Author" placeholder="Author name" value={author}
        onChange={(event) => setAuthor(event.target.value)} />
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="primary-button" type="submit">Save changes</button>
    </form>
    <h3 className="cover-section-title">Choose cover</h3>
    <button className="secondary-button" disabled={busy} onClick={() => setError(onSave(title, author, true))}>
      Retry cover search</button>
    <button className="secondary-button" disabled={!workId || editionBusy || editionWork?.nextCursor === null}
      onClick={() => void loadEditions()}>
      {editionBusy ? 'Loading editions...' : editionError ? 'Retry edition search' : editionWork ? 'More editions and covers' : 'Find additional editions and covers'}
    </button>
    {!workId && <p>Match a book before searching its editions.</p>}
    {editionBusy && <p role="status">Looking up editions...</p>}
    {editionError && <p role="alert">{editionError}</p>}
    {editionWork?.nextCursor === null && <p>All available editions loaded.</p>}
    {state && state.outcome !== 'extracting' && (book.pendingInput === undefined || state.outcome === 'error') && (state.outcome === 'queued' || state.outcome === 'loading'
      ? <p role="status">{state.outcome === 'queued' ? 'Waiting for cover search...' : 'Looking up covers...'}</p> : <>
      {state.warning && <p role="alert">{state.warning}</p>}
      {state.outcome === 'error' && <p role="alert">{state.error}</p>}
      {state.outcome === 'not-found' && <p>No matching works found.</p>}
      {state.outcome === 'needs-review' && <p>Review the works and editions before choosing artwork.</p>}
    </>)}
    <div className="cover-options" role="group" aria-label="Cover gallery">
      {book.coverSelection?.kind === 'local' && <CoverOption selection={book.coverSelection}
        current={book.coverSelection} label="your uploaded cover" onSelect={onSelect} />}
      <CoverOption selection={{ kind: 'placeholder' }} current={book.coverSelection} label="placeholder cover" onSelect={onSelect} />
      <CoverGallery works={[
        ...(state && 'works' in state ? state.works : []),
        ...(book.coverSelection?.kind === 'open-library' ? [{
          id: book.coverSelection.workId, title: book.title, authors: [book.author],
          covers: [{ coverId: book.coverSelection.coverId, editionId: book.coverSelection.editionId }],
          editions: [], nextCursor: null,
        }] : []),
        ...(editionWork ? [editionWork] : []),
      ]} current={book.coverSelection} onSelect={onSelect} />
      <div className="cover-upload">
        <strong>Your own cover</strong>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          aria-label="Cover photo" hidden onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) { setPasteReady(false); void selectImage(file); }
          }} />
        <button type="button" className="secondary-button" disabled={imageBusy}
          onClick={() => fileInput.current?.click()}>Upload photo</button>
        <button type="button" className="secondary-button" disabled={imageBusy} aria-pressed={pasteReady}
          onClick={() => { setImageError(''); setPasteReady(true); }}>Paste image</button>
        <span>Images stay in this browser.</span>
      </div>
    </div>
    {pasteReady && <div className="cover-paste-target" ref={pasteTarget} tabIndex={0}
      role="group" aria-label="Paste cover image">
      <p role="status">Press Ctrl+V (Command+V on Mac) to paste a copied image.</p>
      <button type="button" className="secondary-button" disabled={imageBusy}
        onClick={() => setPasteReady(false)}>Cancel paste</button>
    </div>}
    {imageBusy && <p role="status">Preparing cover image...</p>}
    {imageError && <p className="field-error" role="alert">{imageError}</p>}
    <p className="cover-attribution"><a href="https://openlibrary.org" target="_blank" rel="noreferrer">Metadata and covers from Open Library</a></p>
  </dialog>;
}
