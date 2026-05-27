/**
 * Business Logic（为什么需要这个函数）:
 *   用户在角色详情页选中多个片段后，需要将它们合并为一个连续音频片段。
 *
 * Code Logic（这个函数做什么）:
 *   调用 POST /api/characters/{char_id}/items/merge，传入 item_ids 数组，
 *   维护 loading/error 状态，返回 merge 函数。
 */

import { useCallback, useState } from 'react';
import { mergeItems } from '@/api/client';

interface UseMergeItemsResult {
  merge: (charId: string, itemIds: number[]) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useMergeItems(): UseMergeItemsResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const merge = useCallback(async (charId: string, itemIds: number[]): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await mergeItems(charId, itemIds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { merge, loading, error };
}
