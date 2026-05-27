/**
 * 新建角色 Hook（含进度轮询）
 * 提交 multipart → 拿到 char_id → 自动轮询 /api/progress/{char_id} 直到完成
 */

import { useCallback, useState } from 'react';
import { createCharacter, getProgress } from '@/api/client';
import type { TaskStatus } from '@/api/types';

interface BuildInput {
  charName: string;
  audioFiles: File[];
  avatar?: File;
  minSilenceLen?: number;
}

interface BuildState {
  charId: string | null;
  progress: number;
  msg: string;
  status: TaskStatus;
  done: boolean;
  error: string | null;
}

interface UseBuildCharacterResult {
  build: (input: BuildInput) => Promise<string>;
  state: BuildState;
  reset: () => void;
}

const INITIAL: BuildState = {
  charId: null,
  progress: 0,
  msg: '',
  status: 'running',
  done: false,
  error: null,
};

export function useBuildCharacter(): UseBuildCharacterResult {
  const [state, setState] = useState<BuildState>(INITIAL);

  const reset = useCallback((): void => {
    setState(INITIAL);
  }, []);

  const build = useCallback(async (input: BuildInput): Promise<string> => {
    setState({ ...INITIAL, msg: '正在上传...' });
    let charId: string;
    try {
      const res = await createCharacter(input.charName, input.audioFiles, {
        avatar: input.avatar,
        minSilenceLen: input.minSilenceLen,
      });
      charId = res.char_id;
      setState((prev) => ({ ...prev, charId, msg: '正在处理...' }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: msg, status: 'error', done: true }));
      throw err;
    }

    // 轮询进度（不用 usePolling hook，因为这里是命令式触发）
    await new Promise<void>((resolve, reject) => {
      const INTERVAL = 1000;
      let active = true;

      const poll = (): void => {
        if (!active) return;
        getProgress(charId)
          .then((res) => {
            if (!active) return;
            setState((prev) => ({
              ...prev,
              progress: res.progress,
              msg: res.msg,
              status: res.status,
              done: res.status !== 'running',
            }));
            if (res.status === 'running') {
              setTimeout(poll, INTERVAL);
            } else if (res.status === 'done' || res.status === 'success') {
              resolve();
            } else {
              active = false;
              reject(new Error(res.msg));
            }
          })
          .catch(() => {
            if (active) setTimeout(poll, INTERVAL);
          });
      };

      poll();

      // 超时保护：5 分钟
      setTimeout(() => {
        if (active) {
          active = false;
          reject(new Error('建角色超时'));
        }
      }, 5 * 60 * 1000);
    });

    return charId;
  }, []);

  return { build, state, reset };
}
