import type { GameModes } from '../store/gameStore'

/** The optional rules of engagement, in menu order. Mechanics detail lives in How to play. */
export const RULES: ReadonlyArray<{ id: keyof GameModes; label: string; blurb: string }> = [
  { id: 'salvo', label: 'Salvo', blurb: 'One shot per surviving ship, every turn — for both sides.' },
  { id: 'storm', label: 'Stormy seas', blurb: '30% of shots are lost in the storm — no hit or miss shown; fire at the square again. Both sides.' },
  { id: 'blackFlag', label: 'Black Flag', blurb: 'Pick your fleet, two power shots each, hidden treasure.' },
]

export const RULES_OPTIONAL_COPY = 'Optional — tick any, all or none. Nothing ticked is classic Battleship; ticked rules stack.'
export const RULES_STACK_HINT = 'Combine freely — every rule stacks with the others.'

/** Labels of the ticked rules, in menu order. */
export function pickedRules(modes: GameModes): string[] {
  return RULES.filter((r) => modes[r.id]).map((r) => r.label)
}

/** "Classic Battleship" / "Salvo + Black Flag" / "All three — Salvo + Stormy seas + Black Flag". */
export function rulesSummary(modes: GameModes): string {
  const picked = pickedRules(modes)
  if (picked.length === 0) return 'Classic Battleship'
  if (picked.length === RULES.length) return `All three — ${picked.join(' + ')}`
  return picked.join(' + ')
}

/** The Rules step's continue button: the no-pick path must read as a perfectly good choice. */
export function sailOnLabel(modes: GameModes): string {
  const n = pickedRules(modes).length
  if (n === 0) return 'Sail on — classic rules'
  return `Sail on with ${n} ${n === 1 ? 'rule' : 'rules'}`
}
