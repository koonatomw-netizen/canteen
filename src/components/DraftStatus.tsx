import { useEffect, useState } from 'react';
import { Check, CloudOff, LoaderCircle } from 'lucide-react';
import type { DraftSaveStatus } from '../lib/localDrafts';
import { useI18n } from '../lib/i18n';

export function DraftStatus({ status, photosNotSaved = false }: { status: DraftSaveStatus; photosNotSaved?: boolean }) {
  const { t } = useI18n();
  const online = useStateNetwork();
  if (!online) return <p className="draft-status draft-offline"><CloudOff size={14} />{t('Offline · changes cannot be sent to the server.')}</p>;
  if (status === 'idle') return null;
  return <p className="draft-status" role="status">{status === 'saving' ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}{t(status === 'saving' ? 'Saving draft…' : 'Draft saved on this device · not submitted')}{photosNotSaved && status === 'saved' && <small>{t('Photos must be selected again after a reload.')}</small>}</p>;
}

function useStateNetwork(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);
  return online;
}
