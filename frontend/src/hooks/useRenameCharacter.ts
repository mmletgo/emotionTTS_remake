/**
 * Business Logic（为什么需要这个函数）:
 *   用户在角色库中需要修改角色名称，该 hook 封装重命名操作。
 *
 * Code Logic（这个函数做什么）:
 *   调用 renameCharacter API，维护 loading/error 状态，返回 rename 函数供调用方使用。
 */

import { useCallback, useState } from 'react';
import { renameCharacter } from '@/api/client';

interface UseRenameCharacterResult {
  rename: (charId: string, newName: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useRenameCharacter(): UseRenameCharacterResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const rename = useCallback(async (charId: string, newName: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await renameCharacter(charId, newName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { rename, loading, error };
}
