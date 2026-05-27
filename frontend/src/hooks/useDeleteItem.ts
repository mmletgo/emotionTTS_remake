/**
 * Business Logic（为什么需要这个函数）:
 *   用户在角色详情页需要删除单个音频片段，该 hook 封装删除操作。
 *
 * Code Logic（这个函数做什么）:
 *   调用 DELETE /api/characters/{char_id}/items/{item_id}，
 *   维护 loading/error 状态，返回 remove 函数。
 */

import { useCallback, useState } from 'react';
import { deleteItem } from '@/api/client';

interface UseDeleteItemResult {
  remove: (charId: string, itemId: number) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useDeleteItem(): UseDeleteItemResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useCallback(async (charId: string, itemId: number): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await deleteItem(charId, itemId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { remove, loading, error };
}
