// Load data with loading / error / reload state.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const seq = useRef(0);

  const reload = useCallback(() => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((d) => id === seq.current && setData(d))
      .catch((e) => id === seq.current && setError(e))
      .finally(() => id === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(reload, [reload]);
  return { data, error, loading, reload, setData };
}
