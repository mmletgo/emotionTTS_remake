/**
 * Business Logic（为什么需要这个函数）:
 *   用户在角色详情页需要补充更多音频素材，该 hook 封装追加流程，
 *   包含进度轮询，让用户看到处理进度。
 *
 * Code Logic（这个函数做什么）:
 *   调用 POST /api/characters/{char_id}/append（multipart），
 *   后端返回后使用固定的 task_id ({char_id}_append) 进行进度轮询，
 *   直到任务完成或失败。维护进度状态，返回 append 函数。
 */

import { useCallback, useState } from 'react';
import { appendToCharacter, getProgress } from '@/api/client';
import type { TaskStatus } from '@/api/types';

interface AppendInput {
  charId: string;
  audioFiles: File[];
  minSilenceLen?: number;
  /** 是否启用 LLM 情绪打标，默认 true（向后兼容） */
  enableLlmTagging?: boolean;
}

interface AppendState {
  progress: number;
  msg: string;
  status: TaskStatus;
  /** 当前处理阶段，来自后端 stage 字段 */
  stage: 'slicing' | 'asr' | 'tagging' | 'writing' | null;
  done: boolean;
  error: string | null;
}

interface UseAppendCharacterResult {
  append: (input: AppendInput) => Promise<void>;
  state: AppendState;
  reset: () => void;
}

const INITIAL: AppendState = {
  progress: 0,
  msg: '',
  status: 'running',
  stage: null,
  done: false,
  error: null,
};

export function useAppendCharacter(): UseAppendCharacterResult {
  const [state, setState] = useState<AppendState>(INITIAL);

  const reset = useCallback((): void => {
    setState(INITIAL);
  }, []);

  const append = useCallback(async (input: AppendInput): Promise<void> => {
    setState({ ...INITIAL, msg: '正在上传...' });
    try {
      await appendToCharacter(input.charId, input.audioFiles, {
        minSilenceLen: input.minSilenceLen,
        enableLlmTagging: input.enableLlmTagging,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: msg, status: 'error', done: true }));
      throw err;
    }

    const taskId = `${input.charId}_append`;
    setState((prev) => ({ ...prev, msg: '正在处理...' }));

    // 轮询进度直到完成
    await new Promise<void>((resolve, reject) => {
      const INTERVAL = 1000;
      let active = true;

      const poll = (): void => {
        if (!active) return;
        getProgress(taskId)
          .then((res) => {
            if (!active) return;
            setState((prev) => ({
              ...prev,
              progress: res.progress,
              msg: res.msg,
              status: res.status,
              stage: res.stage,
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
          reject(new Error('追加音频超时'));
        }
      }, 5 * 60 * 1000);
    });
  }, []);

  return { append, state, reset };
}
