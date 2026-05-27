/**
 * Business Logic（为什么需要这个函数）:
 *   用户在角色详情页可以一键让 AI 对所有未打标的片段进行情绪分析，
 *   并将结果保存到后端。该 hook 封装逐条分析+保存流程。
 *
 * Code Logic（这个函数做什么）:
 *   遍历 items，对 emotion_complex 为空的片段逐条调用 /api/analyze_emotion，
 *   分析完后立即调用 PUT /api/characters/{char_id}/items 保存，
 *   通过回调通知调用方每条分析结果，维护进度计数状态。
 */

import { useCallback, useState } from 'react';
import { analyzeEmotion, updateItems } from '@/api/client';
import type { EmotionIntensity, EmotionPrimary, LibraryItem } from '@/api/types';

interface EmotionAnalysisResult {
  primary?: EmotionPrimary;
  intensity?: EmotionIntensity;
  complex?: string;
}

interface BatchAnalyzeState {
  running: boolean;
  processed: number;
  total: number;
  msg: string;
  done: boolean;
  error: string | null;
}

interface UseBatchAnalyzeEmotionResult {
  analyze: (charId: string, items: LibraryItem[], onItemDone: (itemId: number, emotion: EmotionAnalysisResult) => void) => Promise<void>;
  state: BatchAnalyzeState;
  reset: () => void;
}

const INITIAL: BatchAnalyzeState = {
  running: false,
  processed: 0,
  total: 0,
  msg: '',
  done: false,
  error: null,
};

export function useBatchAnalyzeEmotion(): UseBatchAnalyzeEmotionResult {
  const [state, setState] = useState<BatchAnalyzeState>(INITIAL);

  const reset = useCallback((): void => {
    setState(INITIAL);
  }, []);

  const analyze = useCallback(async (
    charId: string,
    items: LibraryItem[],
    onItemDone: (itemId: number, emotion: EmotionAnalysisResult) => void,
  ): Promise<void> => {
    // 只处理 emotion_complex 为空（尚未 AI 打标）的 items
    const targets = items.filter((item) => !item.emotion_complex && item.text.trim());
    if (targets.length === 0) {
      setState({ ...INITIAL, done: true, msg: '已全部打标，无需分析' });
      return;
    }

    setState({ ...INITIAL, running: true, total: targets.length, msg: '开始分析...' });

    let processedCount = 0;

    for (const item of targets) {
      setState((prev) => ({
        ...prev,
        msg: `正在分析 ${processedCount + 1} / ${targets.length}`,
      }));

      try {
        const res = await analyzeEmotion(item.text);
        const emotion = res.emotion as EmotionAnalysisResult;
        processedCount++;
        onItemDone(item.id, emotion);

        // 立即保存这一条到后端
        const itemUpdate: Record<string, unknown> = {};
        itemUpdate[String(item.id)] = {
          text: item.text,
          emotion: {
            primary: emotion.primary ?? '平',
            intensity: emotion.intensity ?? 'Medium',
            complex: emotion.complex ?? '',
          },
        };
        await updateItems(charId, itemUpdate);

        setState((prev) => ({ ...prev, processed: processedCount }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          running: false,
          done: true,
          error: `分析第 ${processedCount + 1} 条时出错: ${msg}`,
        }));
        throw err;
      }
    }

    setState({
      running: false,
      processed: processedCount,
      total: targets.length,
      msg: `分析完毕，共处理 ${processedCount} 条`,
      done: true,
      error: null,
    });
  }, []);

  return { analyze, state, reset };
}
