/**
 * 智能情绪匹配 Hook
 * run() 调用 /api/match，返回参考音 + 情绪向量
 */

import { useCallback, useState } from 'react';
import { match } from '@/api/client';
import type { EmotionVector, MatchResult } from '@/api/types';

interface MatchInput {
  char_id: string;
  text: string;
  lock?: { primary: string; intensity: string; complex?: string };
  /** 透传后端"允许 API 模式优先"开关，省略时后端默认 true（保留原有候选池策略） */
  api_priority?: boolean;
}

interface UseMatchResult {
  run: (input: MatchInput) => Promise<MatchResult>;
  loading: boolean;
  error: string | null;
  result: MatchResult | null;
}

export function useMatch(): UseMatchResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);

  const run = useCallback(async (input: MatchInput): Promise<MatchResult> => {
    setLoading(true);
    setError(null);
    try {
      const res = await match({
        char_id: input.char_id,
        text: input.text,
        manual_emotion: input.lock,
      });
      // 后端 emo_vector 可能是普通数组，强转为 readonly tuple
      const normalized: MatchResult = {
        ...res,
        emo_vector: res.emo_vector
          ? (res.emo_vector as unknown as EmotionVector)
          : null,
      };
      setResult(normalized);
      return normalized;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { run, loading, error, result };
}
