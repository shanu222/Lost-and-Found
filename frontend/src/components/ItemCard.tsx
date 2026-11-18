import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { formatDate, formatDistance } from '../lib/format';
import type { FoundItem } from '../lib/types';
import { CategoryArt } from './CategoryArt';

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <span className={`status status--${status}`}>{t(`status.${status}`, { defaultValue: status })}</span>;
}

export function ItemCard({ item, to }: { item: FoundItem; to?: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const photo = !item.illustration ? item.photos[0] : undefined;
  return (
    <Link to={to ?? `/items/${item.id}`} className="item-card">
      <div className="item-card__media">
        {photo ? <img src={photo.thumbUrl} alt="" loading="lazy" /> : <CategoryArt category={item.category} />}
      </div>
      <div className="item-card__body">
        <span className="item-card__cat">{t(`categories.${item.category}`)}</span>
        <strong className="item-card__title" dir="auto">{item.description}</strong>
        <span className="item-card__meta">
          {[item.area.label || item.area.city, formatDate(item.foundAt, user?.countryCode, user?.timezone)].filter(Boolean).join(' · ')}
        </span>
        <span className="row" style={{ gap: 8 }}>
          <StatusBadge status={item.status} />
          {item.distanceM != null && <span className="small muted">{formatDistance(item.distanceM / 1000, user?.units ?? 'km', user?.countryCode)}</span>}
        </span>
      </div>
    </Link>
  );
}
