export const DAVINCI_ANIMATION_TYPES = ['Zoom In', 'Zoom Out', 'Pan Left', 'Pan Right', 'Pan Up', 'Pan Down'];
export const DEFAULT_DAVINCI_ANIMATION_TYPES = ['Zoom In', 'Zoom Out'];

export function validDavinciAnimationTypes(types, enabled) {
  return Array.isArray(types) && types.length <= DAVINCI_ANIMATION_TYPES.length &&
    (!enabled || types.length > 0) && new Set(types).size === types.length &&
    types.every(type => DAVINCI_ANIMATION_TYPES.includes(type));
}
