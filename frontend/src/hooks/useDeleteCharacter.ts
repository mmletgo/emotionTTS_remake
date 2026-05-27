/**
 * 删除角色 Hook
 */

import { useCallback, useState } from 'react';
import { deleteCharacter } from '@/api/client';

interface UseDeleteCharacterResult {
  remove: (charId: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useDeleteCharacter(): UseDeleteCharacterResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useCallback(async (charId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await deleteCharacter(charId);
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
