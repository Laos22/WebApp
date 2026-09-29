// Keep the storyboard-related collection limits aligned across planning,
// validation and persistence. Five hundred frames is the fast-path ceiling;
// long-running generation with resumable chapters can be added later.
export const MAX_STORYBOARD_FRAMES = 500;
export const MAX_SOUND_SUGGESTIONS = 500;
