// Typed fetch wrapper.
// * The access token lives in memory only; the refresh token is an httpOnly
//   cookie the browser sends to /api/auth/refresh.
// * A 401 triggers one silent refresh (shared by concurrent requests), then the
//   request is retried once.
// * Errors are thrown as ApiError with the server's stable `code`.

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

let onSessionLost: (() => void) | null = null;
export const setSessionLostHandler = (fn: () => void) => {
  onSessionLost = fn;
};

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) return false;
      const body = await res.json();
      accessToken = body.accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type Options = { method?: string; body?: unknown; signal?: AbortSignal; retry?: boolean };

export async function api<T = unknown>(path: string, { method = 'GET', body, signal, retry = true }: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      signal,
      credentials: 'include',
      headers: {
        ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Network error');
  }

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refresh()) return api<T>(path, { method, body, signal, retry: false });
    accessToken = null;
    onSessionLost?.();
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'INTERNAL', e.message ?? 'Request failed', e.details);
  }
  return data as T;
}

/** Build a multipart body: JSON `data` + files grouped by field name. */
export function formData(data: unknown, files: Record<string, File[]> = {}): FormData {
  const fd = new FormData();
  fd.append('data', JSON.stringify(data));
  for (const [field, list] of Object.entries(files)) for (const f of list) fd.append(field, f, f.name);
  return fd;
}

/** Download a JSON endpoint as a file (used for "Download my data"). */
export async function downloadJson(path: string, filename: string) {
  const data = await api(path);
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
