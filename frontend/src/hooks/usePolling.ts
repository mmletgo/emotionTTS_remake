/**
 * 通用进度轮询 Hook
 * 根据 taskId 周期性调 /api/progress/{taskId}，直到 status !== 'running'
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getProgress } from '@/api/client';
import type { ProgressResponse, TaskStatus } from '@/api/types';

interface UsePollingOptions {
  /** 轮询间隔 ms，默认 1000 */
  interval?: number;
  /** taskId 为空/undefined 时不启动轮询 */
  enabled?: boolean;
}

interface UsePollingResult {
  progress: number;
  msg: string;
  status: TaskStatus;
  done: boolean;
}

export function usePolling(
  taskId: string | null | undefined,
  options: UsePollingOptions = {},
): UsePollingResult {
  const { interval = 1000, enabled = true } = options;

  const [state, setState] = useState<ProgressResponse>({
    progress: 0,
    msg: '等待中...',
    status: 'running',
    stage: null,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef<boolean>(false);

  const stop = useCallback((): void => {
    activeRef.current = false;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!taskId || !enabled) return;

    activeRef.current = true;

    const poll = (): void => {
      if (!activeRef.current) return;

      getProgress(taskId)
        .then((res) => {
          if (!activeRef.current) return;
          setState(res);
          if (res.status === 'running') {
            timerRef.current = setTimeout(poll, interval);
          }
        })
        .catch(() => {
          // 网络错误时继续重试
          if (activeRef.current) {
            timerRef.current = setTimeout(poll, interval);
          }
        });
    };

    poll();

    return () => stop();
  }, [taskId, enabled, interval, stop]);

  return {
    progress: state.progress,
    msg: state.msg,
    status: state.status,
    done: state.status !== 'running',
  };
}
