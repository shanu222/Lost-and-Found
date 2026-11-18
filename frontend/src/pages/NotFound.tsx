import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <main className="page page--narrow" id="main">
      <div className="state">
        <h1>{t('notFound.title')}</h1>
        <p>{t('notFound.body')}</p>
        <Link className="btn" to="/">
          {t('notFound.home')}
        </Link>
      </div>
    </main>
  );
}
