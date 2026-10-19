import { useEffect, useState } from 'react';
import { businessDateNow } from './dates';

/** Keeps the displayed operational date in sync when a tab stays open overnight. */
export function useBusinessDate(): string {
  const [businessDate, setBusinessDate] = useState(businessDateNow);

  useEffect(() => {
    const refresh = () => {
      const nextDate = businessDateNow();
      setBusinessDate((current) => current === nextDate ? current : nextDate);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibilityChange);
    refresh();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return businessDate;
}
