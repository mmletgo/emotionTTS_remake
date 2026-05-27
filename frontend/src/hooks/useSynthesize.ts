/**
 * 单句合成 Hook
 * run() 调用 /api/synthesize，返回 { audio_url }
 */

import { useCallback, useState } from 'react';
import { synthesize } from '@/api/client';
import type { EmotionVector } from '@/api/types';

interface SynthInput {
  char_id: string;
  ref_item_id?: number;
  ref_audio_filename: string;
  text: string;
  emo_vector?: EmotionVector | null;
  emo_alpha?: number;
}

interface SynthOutput {
  audio_url: string;
}

interface UseSynthesizeResult {
  run: (input: SynthInput) => Promise<SynthOutput>;
  loading: boolean;
  error: string | null;
  audioUrl: string | null;
}

export function useSynthesize(): UseSynthesizeResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const run = useCallback(async (input: SynthInput): Promise<SynthOutput> => {
    setLoading(true);
    setError(null);
    try {
      const res = await synthesize({
        text: input.text,
        char_id: input.char_id,
        ref_audio_filename: input.ref_audio_filename,
        emo_vector: input.emo_vector ?? undefined,
        emo_alpha: input.emo_alpha,
      });
      setAudioUrl(res.audio_url);
      return { audio_url: res.audio_url };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { run, loading, error, audioUrl };
}
