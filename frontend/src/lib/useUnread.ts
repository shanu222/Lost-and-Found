// Unread notifications + messages counters, polled every 45 s (and on focus).
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export function useUnread(enabled: boolean) {
  const [counts, setCounts] = useState({ notifications: 0, messages: 0 });
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const [n, c] = await Promise.all([
        api<{ unread: number }>('/notifications?unread=true'),
        api<{ conversations: { unread: number }[] }>('/conversations'),
      ]);
      setCounts({ notifications: n.unread, messages: c.conversations.reduce((a, x) => a + x.unread, 0) });
    } catch {
      /* offline — keep last counts */
    }
  }, [enabled]);
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 45_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('fb:refresh-unread', refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('fb:refresh-unread', refresh);
    };
  }, [refresh]);
  return counts;
}

export const refreshUnread = () => window.dispatchEvent(new Event('fb:refresh-unread'));
