export function frameLabel(frame, frames = [], blocks = []) {
  if (!frame) return 'Кадр';
  const block = blocks.find(item => item.id === frame.sourceVoiceoverBlockId);
  const blockNumber = block?.order ?? frame.blockNumber;
  const sameBlock = frames.filter(item => item.sourceVoiceoverBlockId === frame.sourceVoiceoverBlockId);
  const index = sameBlock.findIndex(item => item.id === frame.id);
  const frameNumber = frame.frameInBlock ?? (index >= 0 ? index + 1 : frame.order);
  return blockNumber ? `Кадр ${blockNumber}–${frameNumber}` : `Кадр ${frameNumber}`;
}
