/**
 * 长文本切句 Hook
 * 调 /api/split_text，返回切分后的 segments
 */

import { useCallback, useState } from 'react';
import { splitText } from '@/api/client';

interface SplitInput {
  text: string;
  minLen?: number;
  maxLen?: number;
}

interface UseLongTextSplitResult {
  split: (input: SplitInput) => Promise<string[]>;
  segments: string[];
  loading: boolean;
  error: string | null;
}

export function useLongTextSplit(): UseLongTextSplitResult {
  const [segments, setSegments] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const split = useCallback(async (input: SplitInput): Promise<string[]> => {
    setLoading(true);
    setError(null);
    try {
      const res = await splitText({
        text: input.text,
        min_len: input.minLen,
        max_len: input.maxLen,
      });
      setSegments(res.segments);
      return res.segments;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { split, segments, loading, error };
}
