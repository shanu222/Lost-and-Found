import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ErrorState, LoadingState } from '../components/ui';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import type { AppNotification } from '../lib/types';
import { useApi } from '../lib/useApi';
import { useErrorMessage } from '../lib/useErrorMessage';
import { refreshUnread } from '../lib/useUnread';

/** Renders a notification in the CURRENT UI language from its type + data. */
export function useNotificationText() {
  const { t } = useTranslation();
  return (n: AppNotification) => {
    const vars = { ...n.data, category: n.data.category ? t(`categories.${n.data.category}`) : t('categories.other') };
    return { title: t(`notifications.${n.type}.title`, vars), body: t(`notifications.${n.type}.body`, vars) };
  };
}

export default function Notifications() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const errorMessage = useErrorMessage();
  const text = useNotificationText();
  const { data, error, reload } = useApi<{ notifications: AppNotification[] }>('/notifications');

  useEffect(() => {
    if (data?.notifications.some((n) => !n.read)) api('/notifications/read', { method: 'POST', body: {} }).then(refreshUnread).catch(() => {});
  }, [data]);

  return (
    <main className="page page--narrow" id="main">
      <h1>{t('notifications.title')}</h1>
      {error ? (
        <ErrorState message={errorMessage(error)} onRetry={reload} />
      ) : !data ? (
        <LoadingState />
      ) : !data.notifications.length ? (
        <div className="empty"><p>{t('notifications.empty')}</p></div>
      ) : (
        <ul className="notif-list">
          {data.notifications.map((n) => {
            const { title, body } = text(n);
            return (
              <li key={n.id} data-unread={!n.read}>
                <Link to={String(n.data.url ?? '/')}>
                  <strong>{title}</strong>
                  <span>{body}</span>
                  <span className="small muted">{formatDate(n.createdAt, user?.countryCode, user?.timezone)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
