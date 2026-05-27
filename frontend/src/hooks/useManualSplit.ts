/**
 * Business Logic（为什么需要这个函数）:
 *   用户在音频试听时发现片段切分不准确，需要手动在指定时间点重新切分。
 *
 * Code Logic（这个函数做什么）:
 *   调用 POST /api/characters/{char_id}/items/{item_id}/manual_split，
 *   传入 split_time，维护 loading/error 状态，返回 split 函数。
 */

import { useCallback, useState } from 'react';
import { manualSplit } from '@/api/client';

interface UseManualSplitResult {
  split: (charId: string, itemId: number, splitTime: number) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useManualSplit(): UseManualSplitResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const split = useCallback(async (charId: string, itemId: number, splitTime: number): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await manualSplit(charId, itemId, splitTime);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { split, loading, error };
}
