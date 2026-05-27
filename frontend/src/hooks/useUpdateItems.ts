/**
 * Business Logic（为什么需要这个函数）:
 *   用户在角色详情页 inline 编辑原文/情绪/喜爱状态后，需要批量提交到后端持久化。
 *
 * Code Logic（这个函数做什么）:
 *   调用 PUT /api/characters/{char_id}/items，传入 updates 映射，
 *   维护 loading/error 状态，返回 updateItems 函数。
 */

import { useCallback, useState } from 'react';
import { updateItems } from '@/api/client';

interface UseUpdateItemsResult {
  save: (charId: string, updates: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useUpdateItems(): UseUpdateItemsResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async (charId: string, updates: Record<string, unknown>): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await updateItems(charId, updates);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { save, loading, error };
}
