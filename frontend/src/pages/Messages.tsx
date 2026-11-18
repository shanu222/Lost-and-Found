// Masked in-app chat. Contact details are masked by the server; messages are
// fetched by polling every few seconds while the chat is open.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { CategoryIcon } from '../components/CategoryArt';
import { ReportButton } from '../components/ReportButton';
import { TranslateButton } from '../components/TranslateButton';
import { Alert, Button, ErrorState, LoadingState } from '../components/ui';
import { api } from '../lib/api';
import type { ClaimStatus, ConversationSummary, Message } from '../lib/types';
import { useApi } from '../lib/useApi';
import { useErrorMessage } from '../lib/useErrorMessage';
import { refreshUnread } from '../lib/useUnread';

export function MessagesList() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const { data, error, reload } = useApi<{ conversations: ConversationSummary[] }>('/conversations');
  return (
    <main className="page page--narrow" id="main">
      <h1>{t('messages.title')}</h1>
      <p className="small muted">{t('messages.masked')}</p>
      {error ? (
        <ErrorState message={errorMessage(error)} onRetry={reload} />
      ) : !data ? (
        <LoadingState />
      ) : !data.conversations.length ? (
        <div className="empty"><p>{t('messages.empty')}</p></div>
      ) : (
        <ul className="conv-list">
          {data.conversations.map((c) => (
            <li key={c.id}>
              <Link to={`/messages/${c.id}`} className="conv">
                <span className="conv__icon"><CategoryIcon category={c.category} /></span>
                <span className="conv__main">
                  <strong dir="auto">{c.description}</strong>
                  <span className="small muted">
                    {c.role === 'finder' ? t('messages.withClaimant', { name: c.otherName ?? '' }) : t('messages.withFinder', { name: c.otherName ?? '' })}
                  </span>
                  {c.lastMessage && <span className="conv__last" dir="auto">{c.lastMessage}</span>}
                </span>
                {c.unread > 0 && <span className="dot-count">{c.unread}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

interface ConvInfo {
  id: string;
  claimId: string;
  itemId: string;
  role: 'finder' | 'claimant';
  category: string;
  description: string;
  claimStatus: ClaimStatus;
  canWrite: boolean;
}

export function Chat() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const errorMessage = useErrorMessage();
  const [conv, setConv] = useState<ConvInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const lastAt = useRef<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const q = lastAt.current ? `?after=${encodeURIComponent(lastAt.current)}` : '';
      const r = await api<{ conversation: ConvInfo; messages: Message[] }>(`/conversations/${id}/messages${q}`);
      setConv(r.conversation);
      if (r.messages.length) {
        lastAt.current = r.messages[r.messages.length - 1].createdAt;
        setMessages((m) => {
          const seen = new Set(m.map((x) => x.id));
          return [...m, ...r.messages.filter((x) => !seen.has(x.id))];
        });
        refreshUnread();
      }
    } catch (err) {
      if (!conv) setError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    lastAt.current = null;
    setMessages([]);
    void poll();
    const timer = setInterval(() => document.visibilityState === 'visible' && poll(), 4000);
    return () => clearInterval(timer);
  }, [poll]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const r = await api<{ message: Message }>(`/conversations/${id}/messages`, { method: 'POST', body: { body: text.trim(), language: i18n.language } });
      setMessages((m) => [...m, r.message]);
      lastAt.current = r.message.createdAt;
      setText('');
    } catch (err) {
      setSendError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  if (error) return <main className="page page--narrow" id="main"><ErrorState message={errorMessage(error)} onRetry={poll} /></main>;
  if (!conv) return <main className="page page--narrow" id="main"><LoadingState /></main>;

  return (
    <main className="page page--narrow chat-page" id="main">
      <header className="chat-head">
        <div style={{ minWidth: 0 }}>
          <h1 dir="auto" style={{ fontSize: 'var(--t-lg)', margin: 0 }}>{conv.description}</h1>
          <span className="small muted">{t(`claimStatus.${conv.claimStatus}`)}</span>
        </div>
        <Link className="btn btn--ghost" to={`/claims/${conv.claimId}`}>{t('messages.claim')}</Link>
      </header>
      <Alert kind="info">{t('messages.safety')}</Alert>
      <div className="chat" aria-live="polite">
        {messages.length === 0 && <p className="muted small" style={{ textAlign: 'center' }}>{t('messages.start')}</p>}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.mine ? 'bubble--mine' : ''}`}>
            <p dir="auto" lang={m.language}>{m.body}</p>
            {!m.mine && <TranslateButton type="message" id={m.id} sourceLang={m.language} />}
            <span className="bubble__meta">
              {new Intl.DateTimeFormat(user?.locale ?? i18n.language, { timeStyle: 'short', dateStyle: 'short', ...(user?.timezone ? { timeZone: user.timezone } : {}) }).format(new Date(m.createdAt))}
              {m.masked && ` · ${t('messages.wasMasked')}`}
            </span>
            {!m.mine && <ReportButton targetType="message" targetId={m.id} compact />}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {conv.canWrite ? (
        <form className="chat-input" onSubmit={send}>
          <label htmlFor="msg" className="visually-hidden">{t('messages.placeholder')}</label>
          <textarea
            id="msg"
            className="input"
            rows={1}
            maxLength={1000}
            value={text}
            placeholder={t('messages.placeholder')}
            dir="auto"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(e as unknown as FormEvent);
              }
            }}
          />
          <Button type="submit" loading={sending} disabled={!text.trim()}>{t('messages.send')}</Button>
        </form>
      ) : (
        <p className="muted small" style={{ textAlign: 'center' }}>{t('messages.closed')}</p>
      )}
      {sendError && <Alert>{sendError}</Alert>}
    </main>
  );
}
