import { describe, expect, it } from 'vitest'
import { DEFAULT_MODES } from '../store/gameStore'
import { pickedRules, RULES, rulesSummary, sailOnLabel } from './rules'

describe('rules of engagement summary', () => {
  it('reads Classic Battleship with nothing ticked', () => {
    expect(pickedRules(DEFAULT_MODES)).toEqual([])
    expect(rulesSummary(DEFAULT_MODES)).toBe('Classic Battleship')
    expect(sailOnLabel(DEFAULT_MODES)).toBe('Sail on — classic rules')
  })
  it('names one ticked rule', () => {
    const modes = { ...DEFAULT_MODES, storm: true }
    expect(rulesSummary(modes)).toBe('Stormy seas')
    expect(sailOnLabel(modes)).toBe('Sail on with 1 rule')
  })
  it('joins ticked rules in menu order, however they were ticked', () => {
    const modes = { ...DEFAULT_MODES, blackFlag: true, salvo: true }
    expect(rulesSummary(modes)).toBe('Salvo + Black Flag')
    expect(sailOnLabel(modes)).toBe('Sail on with 2 rules')
  })
  it('calls out all three', () => {
    const modes = { salvo: true, storm: true, blackFlag: true }
    expect(rulesSummary(modes)).toBe('All three — Salvo + Stormy seas + Black Flag')
    expect(sailOnLabel(modes)).toBe('Sail on with 3 rules')
    expect(RULES.map((r) => r.id)).toEqual(Object.keys(DEFAULT_MODES))
  })
})
