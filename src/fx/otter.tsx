import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState, type CSSProperties } from 'react'
import * as THREE from 'three'
import type { Vec3 } from './layout'
import { MAT } from './materials'
import { ParticleBurst } from './ParticleFx'
import { damp, lerp, otterPose, smoothPose, type OtterMood } from './timeline'

export type { OtterMood }

// ---------------------------------------------------------------------------
// 3D mascot
// ---------------------------------------------------------------------------

export interface OtterMascotProps {
  mood: OtterMood
  position?: Vec3
  /** Euler rotation in radians. */
  rotation?: Vec3
  scale?: number
  /** Snap between poses instead of easing, no confetti. */
  reducedMotion?: boolean
}

const ARM_REST = -1.15
const ARM_UP = -2.9
const EAR_PERK = 0.15
const EAR_FLAT = 1.25
const LID_OPEN = 1.95
const CONFETTI_PERIOD = 1.4
const CONFETTI_COLORS = ['#f0912d', '#35d07f', '#4fb3ff', '#ffd166', '#ef476f', '#f7e6c8']

const LOGO_DOTS: [number, number][] = [
  [0, 0],
  ...Array.from({ length: 6 }, (_, i): [number, number] => [Math.cos((i / 6) * Math.PI * 2) * 0.075, Math.sin((i / 6) * Math.PI * 2) * 0.075]),
]

/**
 * Devin the Otter, built from primitives to match `public/assets/devin-otter.png`:
 * orange body, cream muzzle and chest, black nose, round ears, whiskers, grey laptop.
 * About 2.3 units tall, feet at y=0, facing +z.
 */
export function OtterMascot({ mood, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, reducedMotion = false }: OtterMascotProps) {
  const root = useRef<THREE.Group>(null)
  const torso = useRef<THREE.Group>(null)
  const chest = useRef<THREE.Mesh>(null)
  const head = useRef<THREE.Group>(null)
  const earL = useRef<THREE.Group>(null)
  const earR = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)
  const pawR = useRef<THREE.Group>(null)
  const lid = useRef<THREE.Group>(null)
  const eyeL = useRef<THREE.Group>(null)
  const eyeR = useRef<THREE.Group>(null)
  const mouth = useRef<THREE.Mesh>(null)

  const pose = useRef(otterPose(mood, 0))
  const moodRef = useRef(mood)
  const moodStart = useRef<number | null>(null)
  const spin = useRef(0)
  const lastConfetti = useRef(-Infinity)
  const [confettiKey, setConfettiKey] = useState(0)

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    if (moodRef.current !== mood || moodStart.current === null) {
      moodRef.current = mood
      moodStart.current = t
    }
    const target = otterPose(mood, t - moodStart.current)
    const p = reducedMotion ? Object.assign(pose.current, target) : smoothPose(pose.current, target, Math.min(dt, 0.1))

    if (p.spinSpeed > 0 && !reducedMotion) {
      spin.current += p.spinSpeed * dt
    } else {
      spin.current = ((spin.current + Math.PI) % (Math.PI * 2)) - Math.PI
      spin.current = damp(spin.current, 0, 6, dt)
    }
    if (root.current) {
      root.current.rotation.y = spin.current
      root.current.position.y = p.bodyY
    }
    if (torso.current) torso.current.rotation.x = p.lean
    if (chest.current) chest.current.scale.set(0.8 + p.breath * 0.02, 1.15 + p.breath * 0.03, 0.55 + p.breath * 0.05)
    if (head.current) head.current.rotation.set(p.headPitch, p.headYaw, p.headRoll)
    if (earL.current && earR.current) {
      const a = lerp(EAR_PERK, EAR_FLAT, p.earFlat)
      earL.current.rotation.z = a
      earR.current.rotation.z = -a
      earL.current.scale.y = earR.current.scale.y = 1 - p.earFlat * 0.35
    }
    const type = p.typing * 0.14
    if (armL.current) armL.current.rotation.x = lerp(ARM_REST, ARM_UP, p.armL) + Math.sin(t * 13) * type
    if (armR.current) armR.current.rotation.x = lerp(ARM_REST, ARM_UP, p.armR) + Math.sin(t * 13 + Math.PI) * type
    if (pawR.current) pawR.current.rotation.z = p.wave
    if (lid.current) lid.current.rotation.x = LID_OPEN * p.lidOpen
    if (eyeL.current && eyeR.current) eyeL.current.scale.y = eyeR.current.scale.y = Math.max(0.08, 1 - p.blink)
    if (mouth.current) {
      mouth.current.rotation.z = p.smile >= 0 ? Math.PI : 0
      mouth.current.scale.y = 0.35 + Math.abs(p.smile) * 0.8
      mouth.current.position.y = p.smile >= 0 ? -0.2 : -0.24
    }
    if (p.confetti && !reducedMotion && t - lastConfetti.current > CONFETTI_PERIOD) {
      lastConfetti.current = t
      setConfettiKey((k) => k + 1)
    }
  })

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group ref={root}>
        {/* tail */}
        <mesh material={MAT.otterOrange} position={[0.45, 0.2, -0.5]} rotation={[1.25, 0, -0.9]}>
          <capsuleGeometry args={[0.2, 1.0, 6, 12]} />
        </mesh>
        <group ref={torso}>
          {/* body */}
          <mesh material={MAT.otterOrange} position={[0, 0.82, 0]} scale={[1, 1.3, 0.95]}>
            <sphereGeometry args={[0.62, 28, 22]} />
          </mesh>
          <mesh ref={chest} material={MAT.otterCream} position={[0, 0.8, 0.38]} scale={[0.8, 1.15, 0.55]}>
            <sphereGeometry args={[0.45, 22, 18]} />
          </mesh>
          {/* legs */}
          {[-0.34, 0.34].map((x) => (
            <mesh key={x} material={MAT.otterOrange} position={[x, 0.12, 0.55]} scale={[1, 0.55, 1.5]}>
              <sphereGeometry args={[0.23, 14, 12]} />
            </mesh>
          ))}
          {/* head */}
          <group ref={head} position={[0, 1.72, 0.1]}>
            <mesh material={MAT.otterOrange} scale={[1.05, 0.95, 1]}>
              <sphereGeometry args={[0.5, 32, 26]} />
            </mesh>
            <mesh material={MAT.otterCream} position={[0, -0.14, 0.38]} scale={[1.25, 0.8, 0.85]}>
              <sphereGeometry args={[0.32, 22, 18]} />
            </mesh>
            <mesh material={MAT.otterNose} position={[0, -0.03, 0.68]} scale={[1.2, 0.85, 1]}>
              <sphereGeometry args={[0.085, 14, 12]} />
            </mesh>
            <mesh ref={mouth} material={MAT.otterNose} position={[0, -0.2, 0.62]}>
              <torusGeometry args={[0.09, 0.016, 6, 14, Math.PI]} />
            </mesh>
            {[-1, 1].map((s) => (
              <group key={s} ref={s < 0 ? eyeL : eyeR} position={[s * 0.2, 0.1, 0.42]}>
                <mesh material={MAT.otterBlack}>
                  <sphereGeometry args={[0.075, 14, 12]} />
                </mesh>
                <mesh material={MAT.eyeWhite} position={[s * 0.025, 0.03, 0.06]}>
                  <sphereGeometry args={[0.024, 8, 8]} />
                </mesh>
              </group>
            ))}
            {[-1, 1].map((s) => (
              <group key={s} ref={s < 0 ? earL : earR} position={[s * 0.42, 0.36, -0.02]}>
                <mesh material={MAT.otterOrange}>
                  <sphereGeometry args={[0.13, 14, 12]} />
                </mesh>
                <mesh material={MAT.otterCream} position={[0, 0, 0.07]}>
                  <sphereGeometry args={[0.07, 10, 8]} />
                </mesh>
              </group>
            ))}
            {[-1, 1].map((s) =>
              [-0.16, 0, 0.16].map((fan) => (
                <mesh
                  key={`${s}${fan}`}
                  material={MAT.whisker}
                  position={[s * 0.45, -0.12 + fan * 0.3, 0.45]}
                  rotation={[0, 0, Math.PI / 2 + s * fan]}
                >
                  <cylinderGeometry args={[0.007, 0.007, 0.38, 5]} />
                </mesh>
              )),
            )}
          </group>
          {/* arms */}
          {[-1, 1].map((s) => (
            <group key={s} ref={s < 0 ? armL : armR} position={[s * 0.52, 1.02, 0.22]} rotation={[ARM_REST, 0, -s * 0.28]}>
              <mesh material={MAT.otterOrange} position={[0, -0.28, 0]}>
                <capsuleGeometry args={[0.13, 0.4, 6, 12]} />
              </mesh>
              <group ref={s > 0 ? pawR : undefined} position={[0, -0.56, 0]}>
                <mesh material={MAT.otterOrange} scale={[1, 0.8, 1.15]}>
                  <sphereGeometry args={[0.15, 14, 12]} />
                </mesh>
              </group>
            </group>
          ))}
          {/* laptop */}
          <group position={[0, 0.47, 0.78]} rotation={[-0.08, 0, 0]}>
            <mesh material={MAT.laptopGrey} position={[0, 0.03, 0]}>
              <boxGeometry args={[0.95, 0.06, 0.62]} />
            </mesh>
            <mesh material={MAT.laptopDark} position={[0, 0.062, 0.02]}>
              <boxGeometry args={[0.8, 0.012, 0.34]} />
            </mesh>
            <mesh material={MAT.laptopDark} position={[0, 0.062, 0.24]}>
              <boxGeometry args={[0.3, 0.008, 0.08]} />
            </mesh>
            {/* hinge on the far edge; the lid folds back over the keyboard when closed and the screen faces Devin when open */}
            <group ref={lid} position={[0, 0.06, 0.31]} rotation={[LID_OPEN, 0, 0]}>
              <mesh material={MAT.laptopGrey} position={[0, 0.025, -0.31]}>
                <boxGeometry args={[0.95, 0.05, 0.62]} />
              </mesh>
              <mesh material={MAT.screen} position={[0, -0.002, -0.31]} rotation={[Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.85, 0.52]} />
              </mesh>
              {LOGO_DOTS.map(([x, z], i) => (
                <mesh key={i} material={MAT.screen} position={[x, 0.054, -0.31 + z]}>
                  <sphereGeometry args={[i === 0 ? 0.045 : 0.03, 10, 10]} />
                </mesh>
              ))}
            </group>
          </group>
        </group>
      </group>
      {confettiKey > 0 && (
        <ParticleBurst
          key={confettiKey}
          position={[0, 2.6, 0]}
          count={70}
          seed={confettiKey * 31}
          speed={[0.6, 2.4]}
          up={[1.2, 3.4]}
          size={[0.05, 0.11]}
          life={[1.4, 2.4]}
          stagger={0.3}
          spread={0.4}
          gravity={-2.4}
          drag={1.4}
          shape="box"
          colors={CONFETTI_COLORS}
        />
      )}
    </group>
  )
}

// ---------------------------------------------------------------------------
// 2D portrait for the HTML HUD
// ---------------------------------------------------------------------------

export interface OtterPortraitProps {
  mood: OtterMood
  /** Diameter in CSS pixels. */
  size?: number
  className?: string
  style?: CSSProperties
  /** Show the mood as a small caption under the portrait. */
  showLabel?: boolean
}

const MOOD_LABEL: Record<OtterMood, string> = {
  idle: 'Devin is thinking…',
  cheer: 'Devin cheers!',
  grumble: 'Devin grumbles.',
  taunt: 'Devin taunts you.',
  victory: 'Devin wins!',
  defeat: 'Devin lost. Squeak.',
}

const MOOD_RING: Record<OtterMood, string> = {
  idle: '#4fb3ff',
  cheer: '#35d07f',
  grumble: '#e8453c',
  taunt: '#f0912d',
  victory: '#ffd166',
  defeat: '#7d8086',
}

const PORTRAIT_CSS = `
.fx-otter-portrait{display:inline-flex;flex-direction:column;align-items:center;gap:.35em;font:inherit;color:inherit}
.fx-otter-portrait__disc{position:relative;border-radius:50%;background:radial-gradient(circle at 50% 35%,#fff7ea 0%,#f7e6c8 70%,#e7cfa4 100%);border:4px solid var(--fx-ring,#4fb3ff);box-shadow:0 6px 18px rgba(0,0,0,.35),inset 0 0 0 2px rgba(255,255,255,.5);overflow:hidden;transition:border-color .4s ease}
.fx-otter-portrait__img{position:absolute;inset:6%;width:88%;height:88%;object-fit:contain;transform-origin:50% 85%;will-change:transform,filter}
.fx-otter-portrait__label{font-size:.8em;opacity:.9;white-space:nowrap}
.fx-otter-portrait--idle .fx-otter-portrait__img{animation:fxOtterIdle 3.2s ease-in-out infinite}
.fx-otter-portrait--cheer .fx-otter-portrait__img{animation:fxOtterCheer .55s cubic-bezier(.3,1.4,.6,1) infinite}
.fx-otter-portrait--grumble .fx-otter-portrait__img{animation:fxOtterGrumble .42s ease-in-out infinite}
.fx-otter-portrait--taunt .fx-otter-portrait__img{animation:fxOtterTaunt 2.4s ease-in-out infinite}
.fx-otter-portrait--victory .fx-otter-portrait__img{animation:fxOtterVictory 1.3s linear infinite}
.fx-otter-portrait--victory .fx-otter-portrait__disc::after{content:"";position:absolute;inset:0;background:radial-gradient(circle,#ffd166 1.5px,transparent 2px) 0 0/14% 14%,radial-gradient(circle,#ef476f 1.5px,transparent 2px) 7% 7%/14% 14%,radial-gradient(circle,#35d07f 1.5px,transparent 2px) 3% 10%/14% 14%;animation:fxOtterConfetti 1.1s linear infinite;pointer-events:none}
.fx-otter-portrait--defeat .fx-otter-portrait__img{animation:fxOtterDefeat 3.5s ease-in-out infinite;filter:grayscale(.55) brightness(.85)}
@keyframes fxOtterIdle{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-3%) scale(1.02,.98)}}
@keyframes fxOtterCheer{0%,100%{transform:translateY(0) scale(1)}45%{transform:translateY(-14%) scale(1.06,1.06) rotate(-3deg)}}
@keyframes fxOtterGrumble{0%,100%{transform:translateX(-4%) rotate(-4deg)}50%{transform:translateX(4%) rotate(4deg)}}
@keyframes fxOtterTaunt{0%,100%{transform:rotate(-7deg) translateX(3%) scale(1.04)}50%{transform:rotate(-10deg) translateX(5%) scale(1.07)}}
@keyframes fxOtterVictory{from{transform:rotateY(0) scale(1.05)}to{transform:rotateY(360deg) scale(1.05)}}
@keyframes fxOtterConfetti{from{background-position:0 -20%,7% -13%,3% -10%}to{background-position:0 100%,7% 107%,3% 110%}}
@keyframes fxOtterDefeat{0%,100%{transform:rotate(9deg) translateY(10%) scale(.95)}50%{transform:rotate(12deg) translateY(12%) scale(.94)}}
@media (prefers-reduced-motion:reduce){.fx-otter-portrait__img,.fx-otter-portrait__disc::after{animation:none!important}}
`

/** 2D Devin portrait (the canonical PNG, CSS-animated per mood) for the HTML overlay. */
export function OtterPortrait({ mood, size = 96, className, style, showLabel = false }: OtterPortraitProps) {
  const src = useMemo(() => `${import.meta.env.BASE_URL}assets/devin-otter.png`, [])
  return (
    <div
      className={`fx-otter-portrait fx-otter-portrait--${mood}${className ? ` ${className}` : ''}`}
      style={{ '--fx-ring': MOOD_RING[mood], ...style } as CSSProperties}
      data-mood={mood}
      role="img"
      aria-label={MOOD_LABEL[mood]}
    >
      <style href="fx-otter-portrait" precedence="default">
        {PORTRAIT_CSS}
      </style>
      <div className="fx-otter-portrait__disc" style={{ width: size, height: size }}>
        <img className="fx-otter-portrait__img" src={src} alt="" draggable={false} />
      </div>
      {showLabel && <span className="fx-otter-portrait__label">{MOOD_LABEL[mood]}</span>}
    </div>
  )
}
