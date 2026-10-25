import { playSfx, type Sfx } from '../audio'

/** Wraps a click handler so it also plays a UI sound. */
export function withSfx<T extends unknown[]>(fn?: (...args: T) => void, name: Sfx = 'ui-click') {
  return (...args: T) => {
    playSfx(name)
    fn?.(...args)
  }
}
