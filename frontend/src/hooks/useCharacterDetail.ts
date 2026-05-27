/**
 * 角色详情 Hook（素材库 items）
 * charId 变化时重新 fetch
 */

import { useCallback, useEffect, useState } from 'react';
import { getCharacterDetails } from '@/api/client';
import type { LibraryItem } from '@/api/types';

interface UseCharacterDetailResult {
  items: LibraryItem[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useCharacterDetail(charId: string): UseCharacterDetailResult {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState<number>(0);

  const refresh = useCallback((): void => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!charId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCharacterDetails(charId)
      .then((detail) => {
        if (!cancelled) {
          setItems(detail.items ?? []);
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
  }, [charId, tick]);

  return { items, loading, error, refresh };
}
