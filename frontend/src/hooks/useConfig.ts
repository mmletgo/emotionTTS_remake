/**
 * 配置 Hook
 * 读取 / 保存 config，以及 LLM / TTS / ASR 连通性测试
 *
 * 注意：testLlm/testTts/testAsr 接收"当前正在编辑的字段"，调用 /api/config/test_{llm,tts,asr}
 * 接口测试用户刚填入但尚未保存的值；不再读已落盘的 config.json。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getConfig,
  saveConfig,
  testAsrConfig,
  testLlmConfig,
  testTtsConfig,
} from '@/api/client';
import type {
  Config,
  ConfigSaveRequest,
  TestAsrRequest,
  TestLlmRequest,
  TestTtsRequest,
} from '@/api/types';

export interface TestResult {
  ok: boolean;
  msg: string;
}

interface UseConfigResult {
  config: Config | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  save: (c: ConfigSaveRequest) => Promise<void>;
  testLlm: (req: TestLlmRequest) => Promise<TestResult>;
  testTts: (req: TestTtsRequest) => Promise<TestResult>;
  testAsr: (req: TestAsrRequest) => Promise<TestResult>;
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

  const testLlm = useCallback(async (req: TestLlmRequest): Promise<TestResult> => {
    try {
      const res = await testLlmConfig(req);
      return { ok: res.status === 'success', msg: res.msg };
    } catch (err) {
      return { ok: false, msg: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  const testTts = useCallback(async (req: TestTtsRequest): Promise<TestResult> => {
    try {
      const res = await testTtsConfig(req);
      return { ok: res.status === 'success', msg: res.msg };
    } catch (err) {
      return { ok: false, msg: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  const testAsr = useCallback(async (req: TestAsrRequest): Promise<TestResult> => {
    try {
      const res = await testAsrConfig(req);
      return { ok: res.status === 'success', msg: res.msg };
    } catch (err) {
      return { ok: false, msg: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  return { config, loading, saving, error, save, testLlm, testTts, testAsr, refresh };
}
