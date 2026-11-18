// Pick 1–5 photos with previews. Files are uploaded with the form; the server
// strips EXIF/GPS, blurs faces and creates thumbnails.
import { useEffect, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from './Icons';

export function PhotoPicker({ files, onChange, max = 5, label, capture }: { files: File[]; onChange: (f: File[]) => void; max?: number; label: string; capture?: 'user' | 'environment' }) {
  const { t } = useTranslation();
  const id = useId();
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return (
    <div className="stack" style={{ ['--gap' as string]: '10px' }}>
      <div className="photo-grid">
        {urls.map((u, i) => (
          <div key={u} className="photo-thumb">
            <img src={u} alt={t('photos.preview', { n: i + 1 })} />
            <button type="button" className="icon-button photo-thumb__remove" aria-label={t('photos.remove', { n: i + 1 })} onClick={() => onChange(files.filter((_, j) => j !== i))}>
              <CloseIcon size={16} />
            </button>
          </div>
        ))}
        {files.length < max && (
          <label htmlFor={id} className="photo-add">
            <span aria-hidden="true">+</span>
            <span className="small">{label}</span>
          </label>
        )}
      </div>
      <input
        id={id}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture={capture}
        multiple={max > 1}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/') && f.size <= 10 * 1024 * 1024);
          onChange([...files, ...picked].slice(0, max));
          e.target.value = '';
        }}
      />
      <span className="field__hint">{t('photos.hint', { max })}</span>
    </div>
  );
}
