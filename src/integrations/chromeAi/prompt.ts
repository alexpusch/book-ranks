interface ModelSession {
  prompt(input: string, options: { responseConstraint: object; signal: AbortSignal }): Promise<string>;
  destroy(): void;
}

interface ModelOptions {
  initialPrompts: { role: 'system'; content: string }[];
  signal: AbortSignal;
  monitor: (monitor: { addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void }) => void;
}

export interface BookLanguageModel {
  availability(): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(options: ModelOptions): Promise<ModelSession>;
}

declare global {
  interface Window {
    LanguageModel?: BookLanguageModel;
  }
}

let promptTail = Promise.resolve();
let modelDownloadProgress: number | null = null;
const downloadListeners = new Set<() => void>();

export function getModelDownloadProgress(): number | null {
  return modelDownloadProgress;
}

export function subscribeModelDownload(listener: () => void): () => void {
  downloadListeners.add(listener);
  return () => { downloadListeners.delete(listener); };
}

function setModelDownloadProgress(progress: number | null) {
  if (modelDownloadProgress === progress) return;
  modelDownloadProgress = progress;
  for (const listener of downloadListeners) listener();
}

export async function requestBookPrompt(
  input: string, instructions: string, schema: object,
  onStatus: (status: string) => void, signal: AbortSignal, status: string,
): Promise<string> {
  const previous = promptTail;
  let release!: () => void;
  promptTail = new Promise<void>((resolve) => { release = resolve; });
  try {
    await previous;
    signal.throwIfAborted();
    return await runPrompt(input, instructions, schema, onStatus, signal, status);
  } finally {
    release();
  }
}

async function runPrompt(
  input: string, instructions: string, schema: object,
  onStatus: (status: string) => void, signal: AbortSignal, status: string,
): Promise<string> {
  const model = window.LanguageModel;
  if (!model) {
    throw new Error('Chrome built-in AI is not available. Use an up-to-date desktop Chrome with the Prompt API enabled on a supported device, over HTTPS or localhost.');
  }
  onStatus('Checking Chrome AI availability...');
  const availability = await model.availability();
  signal.throwIfAborted();
  if (availability === 'unavailable') {
    throw new Error('Chrome AI is unavailable on this device. Check Chrome model support, free disk space, and built-in AI settings.');
  }
  onStatus(availability === 'available' ? 'Preparing Chrome AI...' : 'Downloading Chrome AI model. The first use may take a while...');
  const downloading = availability === 'downloadable' || availability === 'downloading';
  let downloadActive = downloading;
  const clearDownload = () => {
    downloadActive = false;
    setModelDownloadProgress(null);
  };
  let session: ModelSession | undefined;
  try {
    if (downloading) setModelDownloadProgress(0);
    signal.addEventListener('abort', clearDownload, { once: true });
    session = await model.create({
      signal,
      initialPrompts: [{ role: 'system', content: instructions }],
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', ({ loaded }) => {
          // Cached models can also emit progress events during session creation.
          if (downloadActive && !signal.aborted && Number.isFinite(loaded)) {
            const progress = Math.max(0, Math.min(1, loaded));
            setModelDownloadProgress(progress);
            onStatus(`Downloading Chrome AI model: ${Math.round(progress * 100)}%`);
          }
        });
      },
    });
    clearDownload();
    signal.throwIfAborted();
    onStatus(status);
    const response = await session.prompt(input, { responseConstraint: schema, signal });
    signal.throwIfAborted();
    return response;
  } finally {
    signal.removeEventListener('abort', clearDownload);
    clearDownload();
    session?.destroy();
  }
}
