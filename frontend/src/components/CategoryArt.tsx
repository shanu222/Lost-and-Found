// Friendly category illustrations. Used for every item in lists and, for
// IDs/cards/documents/cash, INSTEAD of the real photo on public pages.
import type { Category } from '../lib/types';

const PATHS: Record<Category, string> = {
  phone: 'M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM10.5 18.5h3',
  wallet: 'M4 7.5h14.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18V6.5A1.5 1.5 0 0 1 5.5 5H16v2.5M15.5 13.5h4.5',
  national_id: 'M3.5 6h17a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM8 13.2a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M13.5 10h5M13.5 13h4',
  bank_cards: 'M3.5 6.5h17a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM2.5 10h19M6 14.5h4',
  documents: 'M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v4h4M9 12h6M9 15h6M9 18h4',
  keys: 'M8.5 14.5a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM11.5 12.5l8 8M16 17l2-2M18 19l2-2',
  bag: 'M5 8h14l-1 12H6zM9 8V6.5a3 3 0 0 1 6 0V8',
  jewellery: 'M12 21a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM9 6l3-3 3 3-3 4z',
  watch: 'M12 17.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM9 6.8 9.6 2.5h4.8l.6 4.3M9 17.2l.6 4.3h4.8l.6-4.3M12 9.5V12l1.6 1.2',
  laptop: 'M5 5.5h14a1 1 0 0 1 1 1V16H4V6.5a1 1 0 0 1 1-1zM2.5 16h19l-1 2.5h-17z',
  vehicle_documents: 'M4 14l1.6-4.6A2 2 0 0 1 7.5 8h9a2 2 0 0 1 1.9 1.4L20 14v4h-2.5M4 14v4h2.5M4 14h16M7 18a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM14 18a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0z',
  pets: 'M12 20c-3 0-5-1.5-5-3.5S9.2 12 12 12s5 2.5 5 4.5-2 3.5-5 3.5zM6 10.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM18 10.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM9.5 7a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM14.5 7a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
  childrens_items: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM9 11h.01M15 11h.01M9.5 15c1.4 1.2 3.6 1.2 5 0M12 5c0-1.2.8-2 2-2',
  cash: 'M3 7h18v10H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 10v4M18 10v4',
  other: 'M11 4h8a1 1 0 0 1 1 1v8l-8 8-9-9 8-8zM15.5 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
};

const TINTS: Record<Category, [string, string]> = {
  phone: ['#dcecea', '#0f4c4f'], wallet: ['#fdf0db', '#8a5a12'], national_id: ['#e3ecf7', '#284f7a'], bank_cards: ['#e3ecf7', '#284f7a'],
  documents: ['#eef0f2', '#3c4a57'], keys: ['#fdf0db', '#8a5a12'], bag: ['#f3e8f1', '#6c3a63'], jewellery: ['#fbeee2', '#8a4b12'],
  watch: ['#dcecea', '#0f4c4f'], laptop: ['#eef0f2', '#3c4a57'], vehicle_documents: ['#e3ecf7', '#284f7a'], pets: ['#e5f4ec', '#1f6a43'],
  childrens_items: ['#fdecf0', '#8c2a47'], cash: ['#e5f4ec', '#1f6a43'], other: ['#eef6f5', '#1b6f72'],
};

export function CategoryIcon({ category, size = 22 }: { category: Category; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[category] ?? PATHS.other} />
    </svg>
  );
}

/** Square illustration with the category's tint. */
export function CategoryArt({ category, label, className = '' }: { category: Category; label?: string; className?: string }) {
  const [bg, fg] = TINTS[category] ?? TINTS.other;
  return (
    <div className={`category-art ${className}`} style={{ background: bg, color: fg }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
        <path d={PATHS[category] ?? PATHS.other} />
      </svg>
    </div>
  );
}
