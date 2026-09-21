export const pendingVideoFrames = (plan, resume = true) => plan.frames
  .filter(f => f.selected && (!resume || f.promptStatus !== 'ready' || !f.videoPrompt.trim()))
  .map(f => f.frameId);

// Stop is checked between requests and during backoff, never aborts an active request.
export async function runVideoQueue({ items, request, onResult, stopped, onProgress,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let completed = 0;
  for (const item of items) {
    if (stopped()) break;
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await request(item);
        await onResult(result);
        completed++;
        onProgress(`${completed} / ${items.length}`);
        break;
      } catch (error) {
        if (error.status !== 429 || attempt >= 4) throw error;
        let remaining = error.retryAfterMs ?? Math.min(60000, 2000 * 2 ** attempt);
        onProgress('Временное ограничение ИИ. Ожидание повторного запроса…');
        while (remaining > 0 && !stopped()) {
          const step = Math.min(remaining, 500); await sleep(step); remaining -= step;
        }
        if (stopped()) return completed;
      }
    }
  }
  return completed;
}
