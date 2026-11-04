// Direction hint for the next page transition, read by CSS in app.css:
// push = drill into detail (slides in from the right), pop = go back,
// tab = switch section (quick crossfade).
export type Transition = 'push' | 'pop' | 'tab';

export function setTransition(kind: Transition) {
  document.documentElement.dataset.vt = kind;
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
