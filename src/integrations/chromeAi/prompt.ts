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
  const session = await model.create({
    signal,
    initialPrompts: [{ role: 'system', content: instructions }],
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', ({ loaded }) => {
        if (!signal.aborted) onStatus(`Downloading Chrome AI model: ${Math.round(loaded * 100)}%`);
      });
    },
  });
  try {
    signal.throwIfAborted();
    onStatus(status);
    const response = await session.prompt(input, { responseConstraint: schema, signal });
    signal.throwIfAborted();
    return response;
  } finally {
    session.destroy();
  }
}
