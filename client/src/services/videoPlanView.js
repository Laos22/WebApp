// Shared by the overview, frame picker and editor, including unsaved selections.
export function videoPlanView(data, drafts = {}) {
  if (!data) return { frames: [], total: 0, selected: 0, ready: 0 };
  const saved = new Map(data.videoPlan.frames.map(frame => [frame.frameId, frame]));
  const frames = data.frames.map(frame => {
    const plan = drafts[frame.frameId] || saved.get(frame.frameId);
    const ready = Boolean(plan?.selected && plan.promptStatus === 'ready' && plan.videoPrompt.trim()
      && frame.hasImage && Number.isFinite(frame.targetDurationSec) && data.videoPlan.status !== 'stale'
      && !drafts[frame.frameId]);
    return { ...frame, plan, ready, unsaved: Boolean(drafts[frame.frameId]) };
  });
  return { frames, total: frames.length, selected: frames.filter(f => f.plan?.selected).length,
    ready: frames.filter(f => f.ready).length };
}

export function filterVideoFrames(view, filter = 'all') {
  return view.frames.map((frame, index) => ({ ...frame, index }))
    // Keep unsaved edits reachable until the user saves or cancels them.
    .filter(frame => filter === 'all' || frame.plan.selected || frame.unsaved);
}
