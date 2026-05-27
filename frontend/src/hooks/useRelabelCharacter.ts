/**
 * Business Logic（为什么需要这个函数）:
 *   用户在角色详情页需要对已有素材批量重新进行 LLM 情绪打标，
 *   纠正之前 ASR+LLM 流程中打错的情绪标签，支持全量或选定片段重标。
 *   与"AI 情绪分析"（前端逐条 analyze_emotion）不同，本 hook 调用后端批量端点，
 *   通过进度轮询让用户看到处理状态。
 *
 * Code Logic（这个函数做什么）:
 *   调用 POST /api/characters/{charId}/relabel，后端返回 task_id，
 *   然后按 1s 间隔轮询 /api/progress/{task_id} 直到完成或失败（5 分钟超时保护）。
 *   维护 RelabelState 进度状态，暴露 relabel 命令函数和 reset 重置函数。
 */

import { useCallback, useState } from 'react';
import { relabelCharacter, getProgress } from '@/api/client';
import type { TaskStatus } from '@/api/types';

interface RelabelInput {
  charId: string;
  /** 指定重标的 item id 列表；缺省表示全量重标 */
  itemIds?: number[];
}

interface RelabelState {
  taskId: string | null;
  progress: number;
  msg: string;
  status: TaskStatus;
  stage: 'slicing' | 'asr' | 'tagging' | 'writing' | null;
  done: boolean;
  error: string | null;
}

interface UseRelabelCharacterResult {
  relabel: (input: RelabelInput) => Promise<void>;
  state: RelabelState;
  reset: () => void;
}

const INITIAL: RelabelState = {
  taskId: null,
  progress: 0,
  msg: '',
  status: 'running',
  stage: null,
  done: false,
  error: null,
};

export function useRelabelCharacter(): UseRelabelCharacterResult {
  const [state, setState] = useState<RelabelState>(INITIAL);

  /**
   * Business Logic:
   *   重置到初始状态，供用户关闭进度条或重试前调用。
   *
   * Code Logic:
   *   将 state 恢复到 INITIAL 常量，清除所有进度信息。
   */
  const reset = useCallback((): void => {
    setState(INITIAL);
  }, []);

  /**
   * Business Logic:
   *   触发后端批量情绪重标任务，并轮询进度直到完成。
   *
   * Code Logic:
   *   1. 调用 relabelCharacter API 拿到 task_id；
   *   2. 按 1s 间隔轮询 getProgress(task_id)；
   *   3. 轮询结果写入 state.stage / progress / msg / status；
   *   4. done/error/success 时停止轮询；
   *   5. 5 分钟超时保护。
   */
  const relabel = useCallback(async (input: RelabelInput): Promise<void> => {
    setState({ ...INITIAL, msg: '正在启动重标任务...' });

    let taskId: string;
    try {
      const res = await relabelCharacter(input.charId, input.itemIds);
      taskId = res.task_id;
      setState((prev) => ({ ...prev, taskId, msg: '重标任务已启动，正在处理...' }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: msg, status: 'error', done: true }));
      throw err;
    }

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
              setState((prev) => ({ ...prev, error: res.msg, done: true }));
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
          const timeoutMsg = '重标任务超时';
          setState((prev) => ({ ...prev, error: timeoutMsg, status: 'error', done: true }));
          reject(new Error(timeoutMsg));
        }
      }, 5 * 60 * 1000);
    });
  }, []);

  return { relabel, state, reset };
}
