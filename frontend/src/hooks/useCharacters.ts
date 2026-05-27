/**
 * 角色列表 Hook
 * mount 时自动拉取，提供 refresh 手动刷新
 */

import { useCallback, useEffect, useState } from 'react';
import { getCharacters } from '@/api/client';
import type { Character } from '@/api/types';

interface UseCharactersResult {
  data: Character[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useCharacters(): UseCharactersResult {
  const [data, setData] = useState<Character[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState<number>(0);

  const refresh = useCallback((): void => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCharacters()
      .then((chars) => {
        if (!cancelled) {
          setData(chars);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { data, loading, error, refresh };
}
