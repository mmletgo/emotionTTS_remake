/**
 * 配置 Hook
 * 读取 / 保存 config，以及 LLM / TTS 连通性测试
 */

import { useCallback, useEffect, useState } from 'react';
import { getConfig, saveConfig, verifyActiveConfig } from '@/api/client';
import type { Config, ConfigSaveRequest } from '@/api/types';

interface UseConfigResult {
  config: Config | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  save: (c: ConfigSaveRequest) => Promise<void>;
  testLlm: () => Promise<boolean>;
  testTts: () => Promise<boolean>;
  testAsr: () => Promise<boolean>;
  refresh: () => void;
}

export function useConfig(): UseConfigResult {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState<number>(0);

  const refresh = useCallback((): void => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getConfig()
      .then((cfg) => {
        if (!cancelled) {
          setConfig(cfg);
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
  }, [tick]);

  const save = useCallback(async (c: ConfigSaveRequest): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await saveConfig(c);
      // 保存成功后刷新本地状态
      const updated = await getConfig();
      setConfig(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  const testLlm = useCallback(async (): Promise<boolean> => {
    try {
      const res = await verifyActiveConfig();
      return res.llm_status === 'success';
    } catch {
      return false;
    }
  }, []);

  const testTts = useCallback(async (): Promise<boolean> => {
    try {
      const res = await verifyActiveConfig();
      return res.tts_status === 'success' || res.tts_status === 'local_ready';
    } catch {
      return false;
    }
  }, []);

  const testAsr = useCallback(async (): Promise<boolean> => {
    try {
      const res = await verifyActiveConfig();
      return res.asr_status === 'success' || res.asr_status === 'local_ready';
    } catch {
      return false;
    }
  }, []);

  return { config, loading, saving, error, save, testLlm, testTts, testAsr, refresh };
}
