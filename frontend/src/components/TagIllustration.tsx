// Decorative luggage tag on a string, for the sign-in brand panel.
export function TagIllustration({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 160 220" aria-hidden="true">
      <path d="M80 0 C 70 30, 92 48, 80 70" stroke="#dcecea" strokeWidth="2" fill="none" opacity=".6" />
      <g transform="rotate(-8 80 120)">
        <path d="M40 78 L80 62 L120 78 L120 206 Q120 214 112 214 L48 214 Q40 214 40 206 Z" fill="#f0a23b" />
        <circle cx="80" cy="84" r="8" fill="#0a3436" />
        <circle cx="80" cy="84" r="11" fill="none" stroke="#fdf0db" strokeWidth="3" />
        <rect x="54" y="118" width="52" height="7" rx="3.5" fill="#2b1a00" opacity=".55" />
        <rect x="54" y="136" width="40" height="7" rx="3.5" fill="#2b1a00" opacity=".35" />
        <rect x="54" y="154" width="46" height="7" rx="3.5" fill="#2b1a00" opacity=".35" />
        <path d="m60 186 9 9 18-20" stroke="#0a3436" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
