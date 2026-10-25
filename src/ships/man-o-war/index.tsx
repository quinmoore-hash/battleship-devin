/**
 * Man-o’-War (length 5) — the flagship. Three full-rigged masts with a lateen spanker, two gun decks firing
 * through lidded ports, gilded stern gallery with lanterns, carved figurehead, forecastle / quarterdeck / poop.
 *
 * Frame per ARCHITECTURE.md: bow = +x, centred, y = 0 waterline, one unit per cell. The root never moves.
 * Anchors live in `spec.ts` and are derived from the same numbers the geometry is built from.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { useGameStore } from '../../store/gameStore'
import { Flag } from '../kit'
import type { ShipDefinition, ShipModelProps } from '../types'
import { Bowsprit, DeckFurniture, Damage, Figurehead, Flags, GunDecks, Hull, Jibs, Mast, Rigging, SternGallery, type SailState } from './parts'
import { MAN_O_WAR_ANCHORS, MASTS, mastOnCell, mastSnap, sinkTorn, smoothstep } from './spec'
import { manOWarMaterials } from './textures'

function ManOWarModel({ livery, damage, sinkProgress = 0, lod = 0, quality = 'high', sails = 1, phase = 0, firing }: ShipModelProps) {
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const m = manOWarMaterials(livery)
  const effectiveLod = (quality === 'low' ? Math.max(lod, 1) : lod) as 0 | 1 | 2
  const snaps = useMemo(() => MASTS.map((_, i) => mastSnap(i, sinkProgress)), [sinkProgress])
  const baseTorn = sinkTorn(sinkProgress)
  const sailStates = useMemo<SailState[]>(
    () =>
      MASTS.map((_, i) => {
        const burning = damage.some((d, c) => d === 'burning' && mastOnCell(c) === i)
        const hit = damage.some((d, c) => d !== 'intact' && mastOnCell(c) === i)
        return { set: sails, torn: Math.max(baseTorn, burning ? 0.45 : hit ? 0.2 : 0), scorched: burning || sinkProgress > 0.7 }
      }),
    [damage, baseTorn, sails, sinkProgress],
  )
  const seed = useMemo(() => Math.round(phase * 100) % 97, [phase])
  const bowspritSnap = smoothstep(0.62, 0.9, sinkProgress)

  useFrame(({ clock }) => {
    if (!reducedMotion) m.time.value = clock.elapsedTime + phase
  })

  const common = { m, livery, lod: effectiveLod }
  return (
    <group name="man-o-war">
      <Hull {...common} />
      <SternGallery {...common} />
      <GunDecks {...common} firing={firing} />
      {effectiveLod < 2 && <Figurehead {...common} />}
      <Bowsprit {...common} snap={bowspritSnap} />
      {MASTS.map((spec, i) => (
        <Mast
          key={i}
          {...common}
          index={i}
          spec={spec}
          sail={sailStates[i]}
          snap={snaps[i]}
          phase={phase + i}
          flag={
            snaps[i] > 0.4 ? null : i === 1 ? (
              <Flag position={[0.1, spec.height - 0.02, 0]} livery={livery} width={0.5} height={0.3} phase={phase} />
            ) : null // no truck pennants: a second kit Flag next to the main flag whites out the bloom pass (bugs.md BUG-107 / BUG-113)
          }
        />
      ))}
      {effectiveLod < 2 && (
        <>
          <Rigging {...common} snaps={snaps} />
          <Jibs m={m} sail={sailStates[0]} snap={snaps[0]} />
          <DeckFurniture {...common} />
        </>
      )}
      <Flags livery={livery} sinkProgress={sinkProgress} phase={phase} />
      <Damage {...common} damage={damage} seed={seed} />
    </group>
  )
}
ManOWarModel.displayName = 'ManOWar'

export const MAN_O_WAR: ShipDefinition = {
  id: 'man-o-war',
  name: 'Man-o’-War',
  length: 5,
  Model: ManOWarModel,
  anchors: MAN_O_WAR_ANCHORS,
}

export { MAN_O_WAR_ANCHORS } from './spec'
