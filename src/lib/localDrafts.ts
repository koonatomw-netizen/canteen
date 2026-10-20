import { useCallback, useEffect, useRef, useState } from 'react';

export type DraftSaveStatus = 'idle' | 'saving' | 'saved';

export function useLocalDraft<T>(key: string, value: T, restore: (draft: unknown) => void, shouldSave: (value: T) => boolean) {
  const restoreRef = useRef(restore);
  const shouldSaveRef = useRef(shouldSave);
  restoreRef.current = restore;
  shouldSaveRef.current = shouldSave;
  const [readyKey, setReadyKey] = useState('');
  const [status, setStatus] = useState<DraftSaveStatus>('idle');
  let serializedValue: string | null = null;
  try {
    serializedValue = JSON.stringify(value) ?? null;
  } catch { /* Draft form values should be serializable; keep the page usable if they are not. */ }

  useEffect(() => {
    setStatus('idle');
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) restoreRef.current(JSON.parse(raw) as unknown);
    } catch {
      try { window.localStorage.removeItem(key); } catch { /* Storage can be unavailable in private browsing. */ }
    }
    setReadyKey(key);
  }, [key]);

  useEffect(() => {
    if (readyKey !== key) return;
    const hasContent = shouldSaveRef.current(value);
    setStatus(hasContent && serializedValue !== null ? 'saving' : 'idle');
    const timer = window.setTimeout(() => {
      try {
        if (shouldSaveRef.current(value) && serializedValue !== null) {
          window.localStorage.setItem(key, serializedValue);
          setStatus('saved');
        } else {
          window.localStorage.removeItem(key);
          setStatus('idle');
        }
      } catch {
        setStatus('idle');
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [key, serializedValue, readyKey]);

  const clearDraft = useCallback(() => {
    try { window.localStorage.removeItem(key); } catch { /* Saving the submitted record does not depend on local storage. */ }
    setStatus('idle');
  }, [key]);

  return { status, clearDraft };
}

export function readLocalDraft<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

export function writeLocalDraft(key: string, value: unknown): boolean {
  try { window.localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function removeLocalDraft(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* Storage is optional. */ }
}
