/**
 * Underwater muffle: a low-pass + gain dip spliced between Howler's master gain and the destination while the pirate is
 * in the water (abandon-ship swim, `thrown-overboard`). Everything (SFX, music, ambience) goes through it; restored on exit.
 */
import { Howler } from 'howler'

export const UNDERWATER_CUTOFF_HZ = 420
export const UNDERWATER_DIP = 0.45
const RAMP_S = 0.25

let nodes: { filter: BiquadFilterNode; dip: GainNode } | null = null
let on = false

export function isUnderwater(): boolean {
  return on
}

export function setUnderwater(next: boolean): void {
  if (next === on) return
  on = next
  const ctx = Howler.ctx as AudioContext | null | undefined
  const master = Howler.masterGain as GainNode | null | undefined
  if (!ctx || !master) return
  try {
    if (next) {
      if (!nodes) {
        const filter = ctx.createBiquadFilter()
        filter.type = 'lowpass'
        filter.Q.value = 0.7
        const dip = ctx.createGain()
        filter.connect(dip)
        nodes = { filter, dip }
      }
      nodes.filter.frequency.setValueAtTime(18000, ctx.currentTime)
      nodes.filter.frequency.exponentialRampToValueAtTime(UNDERWATER_CUTOFF_HZ, ctx.currentTime + RAMP_S)
      nodes.dip.gain.setValueAtTime(1, ctx.currentTime)
      nodes.dip.gain.linearRampToValueAtTime(UNDERWATER_DIP, ctx.currentTime + RAMP_S)
      master.disconnect()
      master.connect(nodes.filter)
      nodes.dip.disconnect()
      nodes.dip.connect(ctx.destination)
    } else {
      master.disconnect()
      master.connect(ctx.destination)
      nodes?.dip.disconnect()
    }
  } catch {
    // an unusual Howler build (no WebAudio): nothing to muffle
  }
}
