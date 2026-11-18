// Small form helpers shared by the wizards.

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Client-side hint that public text contains contact details or long numbers.
 * The server performs the authoritative check (incl. country ID patterns).
 */
export function looksSensitive(text: string): boolean {
  if (!text) return false;
  return (
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) ||
    /(https?:\/\/|www\.)/i.test(text) ||
    /(?:\d[\s-]?){7,}/.test(text) ||
    /(whats\s?app|wa\.me|telegram|t\.me)/i.test(text)
  );
}
