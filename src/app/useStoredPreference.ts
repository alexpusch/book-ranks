import { useState } from 'react';

export function useStoredPreference<T extends string>(key: string, choices: readonly T[], fallback: T | null) {
  const [initial] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return { value: fallback, warning: '' };
      const value = choices.find((choice) => choice === raw);
      if (value === undefined) throw new Error('Unsupported saved preference.');
      return { value, warning: '' };
    } catch (error) {
      return {
        value: fallback,
        warning: `Could not load your preference. ${error instanceof Error ? error.message : 'Browser storage is unavailable.'}`,
      };
    }
  });
  const [value, setValue] = useState(initial.value);
  const [warning, setWarning] = useState(initial.warning);

  function select(next: T) {
    setValue(next);
    try {
      window.localStorage.setItem(key, next);
      setWarning('');
    } catch (error) {
      setWarning(
        `Could not save your preference. ${error instanceof Error ? error.message : 'Browser storage is unavailable.'}`,
      );
    }
  }

  return { value, select, warning };
}
