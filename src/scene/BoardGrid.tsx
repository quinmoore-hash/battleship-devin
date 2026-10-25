import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Coord } from '../engine'
import { cellToWorld, worldToCell, type Vec3 } from './layout'
import { getSeaState, sampleWaveHeight } from './waves'

export interface BoardGridProps {
  origin: Vec3
  size?: number
  cellSize?: number
  /** Cell to light up (hover / selected). */
  highlight?: Coord | null
  /** Accent colour for the rope lines and cork floats (defaults to sun-bleached hemp). */
  color?: string
  /** Hex colour of the highlight cell (defaults to polished brass). */
  highlightColor?: string
  /** Show A–J / 1–10 along the edges. */
  labels?: boolean
  /** Called with the hovered cell, or null when the pointer leaves the board. */
  onCellPointerMove?: (coord: Coord | null) => void
  onCellClick?: (coord: Coord) => void
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function makeLabelTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 128, 128)
  // a small driftwood plaque behind each letter
  ctx.fillStyle = 'rgba(70,50,30,0.75)'
  ctx.beginPath()
  ctx.roundRect(14, 22, 100, 84, 10)
  ctx.fill()
  ctx.strokeStyle = 'rgba(226,179,90,0.8)'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.font = '700 70px Georgia, "Times New Roman", serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 6
  ctx.fillStyle = color
  ctx.fillText(text, 64, 66)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function makeRopeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 16
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#b89a6a'
  ctx.fillRect(0, 0, 64, 16)
  ctx.strokeStyle = 'rgba(60,40,20,0.55)'
  ctx.lineWidth = 3
  for (let x = -16; x < 80; x += 8) {
    ctx.beginPath()
    ctx.moveTo(x, 16)
    ctx.lineTo(x + 8, 0)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.repeat.set(12, 1)
  return tex
}

function Label({ text, position, size, color }: { text: string; position: Vec3; size: number; color: string }) {
  const texture = useMemo(() => makeLabelTexture(text, color), [text, color])
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} opacity={0.95} />
    </mesh>
  )
}

/**
 * A 10x10 firing grid marked out on the water the way a harbour master would: hemp rope lines
 * strung between cork floats that bob on the swell, a brass-framed highlight cell and
 * driftwood coordinate plaques. Pointer events are resolved to cells via `worldToCell` on an
 * invisible plate so the UI can hover/fire on the 3D board.
 */
export function BoardGrid({
  origin,
  size = 10,
  cellSize = 1,
  highlight = null,
  color = '#d8bb8a',
  highlightColor = '#e2b35a',
  labels = true,
  onCellPointerMove,
  onCellClick,
}: BoardGridProps) {
  const extent = size * cellSize
  const center: Vec3 = [origin[0] + extent / 2, origin[1], origin[2] + extent / 2]
  const highlightRef = useRef<THREE.Group>(null)
  const floatsRef = useRef<THREE.InstancedMesh>(null)
  const ropesRef = useRef<THREE.InstancedMesh>(null)
  const lastHover = useRef<string | null>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  const ropeGeo = useMemo(() => new THREE.CylinderGeometry(0.018, 0.018, 1, 5, 1, true), [])
  const floatGeo = useMemo(() => new THREE.CylinderGeometry(0.07, 0.055, 0.12, 8), [])
  const ropeTex = useMemo(() => makeRopeTexture(), [])
  const ropeMat = useMemo(() => new THREE.MeshStandardMaterial({ map: ropeTex, color, roughness: 1 }), [ropeTex, color])
  const floatMat = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.85), roughness: 0.9 }), [color])
  useEffect(() => () => void (ropeGeo.dispose(), floatGeo.dispose(), ropeTex.dispose()), [ropeGeo, floatGeo, ropeTex])

  // one rope segment per cell edge so each can follow the water between its two floats
  const ropeCount = 2 * size * (size + 1)
  const floatCount = (size + 1) * (size + 1)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const h = extent / 2
    const yAt = (lx: number, lz: number) => sampleWaveHeight(center[0] + lx, center[2] + lz, t) - center[1] + 0.08 + getSeaState() * 0.25
    const floats = floatsRef.current
    const ropes = ropesRef.current
    if (floats) {
      let k = 0
      for (let i = 0; i <= size; i++) {
        for (let j = 0; j <= size; j++) {
          const lx = -h + i * cellSize
          const lz = -h + j * cellSize
          dummy.position.set(lx, yAt(lx, lz), lz)
          dummy.rotation.set(Math.sin(t * 1.3 + i) * 0.08, 0, Math.cos(t * 1.1 + j) * 0.08)
          dummy.scale.setScalar(1)
          dummy.updateMatrix()
          floats.setMatrixAt(k++, dummy.matrix)
        }
      }
      floats.instanceMatrix.needsUpdate = true
    }
    if (ropes) {
      let k = 0
      const a = new THREE.Vector3()
      const b = new THREE.Vector3()
      const seg = (ax: number, az: number, bx: number, bz: number) => {
        a.set(ax, yAt(ax, az), az)
        b.set(bx, yAt(bx, bz), bz)
        dummy.position.copy(a).add(b).multiplyScalar(0.5)
        dummy.position.y -= 0.012 // ropes sag a touch between floats
        dummy.scale.set(1, a.distanceTo(b), 1)
        dummy.quaternion.setFromUnitVectors(UP, b.sub(a).normalize())
        dummy.updateMatrix()
        ropes.setMatrixAt(k++, dummy.matrix)
      }
      for (let i = 0; i <= size; i++) {
        const o = -h + i * cellSize
        for (let j = 0; j < size; j++) {
          const s0 = -h + j * cellSize
          seg(o, s0, o, s0 + cellSize)
          seg(s0, o, s0 + cellSize, o)
        }
      }
      ropes.instanceMatrix.needsUpdate = true
    }
    if (highlightRef.current) {
      const g = highlightRef.current
      const plate = g.children[0] as THREE.Mesh
      const m = plate.material as THREE.MeshBasicMaterial
      m.opacity = 0.32 + 0.14 * Math.sin(t * 4)
      g.position.y = yAt(g.position.x, g.position.z) + 0.03
    }
  })

  const resolve = useCallback(
    (e: ThreeEvent<PointerEvent | MouseEvent>) => worldToCell(e.point, origin, cellSize, size),
    [origin, cellSize, size],
  )

  const handleMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!onCellPointerMove) return
      const c = resolve(e)
      const key = c ? `${c.x},${c.y}` : null
      if (key === lastHover.current) return
      lastHover.current = key
      onCellPointerMove(c)
    },
    [onCellPointerMove, resolve],
  )

  const handleLeave = useCallback(() => {
    if (lastHover.current === null) return
    lastHover.current = null
    onCellPointerMove?.(null)
  }, [onCellPointerMove])

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!onCellClick) return
      const c = resolve(e)
      if (c) {
        e.stopPropagation()
        onCellClick(c)
      }
    },
    [onCellClick, resolve],
  )

  const hl = highlight ? cellToWorld(highlight, origin, cellSize) : null
  const labelSize = cellSize * 0.72
  const labelOffset = cellSize * 0.75
  const brass = useMemo(() => new THREE.Color(highlightColor), [highlightColor])

  return (
    <group position={center}>
      {/* invisible pointer target; a faint tint so the board reads as a zone */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1} onPointerMove={handleMove} onPointerLeave={handleLeave} onClick={handleClick}>
        <planeGeometry args={[extent, extent]} />
        <meshBasicMaterial color={color} transparent opacity={0.03} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <instancedMesh ref={ropesRef} args={[ropeGeo, ropeMat, ropeCount]} frustumCulled={false} renderOrder={2} />
      <instancedMesh ref={floatsRef} args={[floatGeo, floatMat, floatCount]} frustumCulled={false} renderOrder={2} castShadow />
      {hl && (
        <group ref={highlightRef} position={[hl[0] - center[0], 0.04, hl[2] - center[2]]} renderOrder={4}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[cellSize * 0.9, cellSize * 0.9]} />
            <meshBasicMaterial color={highlightColor} transparent opacity={0.4} toneMapped={false} depthWrite={false} />
          </mesh>
          {/* brass frame that bloom picks up */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
            <ringGeometry args={[cellSize * 0.42, cellSize * 0.47, 4, 1, Math.PI / 4]} />
            <meshBasicMaterial color={brass.clone().multiplyScalar(2.4)} toneMapped={false} depthWrite={false} transparent opacity={0.95} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
      {labels &&
        Array.from({ length: size }, (_, i) => {
          const o = -extent / 2 + (i + 0.5) * cellSize
          return (
            <group key={i}>
              {/* column letters along the near (+z) and far (-z) edges */}
              <Label text={LETTERS[i]} position={[o, 0.03, extent / 2 + labelOffset]} size={labelSize} color="#f6e7c6" />
              <Label text={LETTERS[i]} position={[o, 0.03, -extent / 2 - labelOffset]} size={labelSize} color="#f6e7c6" />
              {/* row numbers along the left and right edges */}
              <Label text={String(i + 1)} position={[-extent / 2 - labelOffset, 0.03, o]} size={labelSize} color="#f6e7c6" />
              <Label text={String(i + 1)} position={[extent / 2 + labelOffset, 0.03, o]} size={labelSize} color="#f6e7c6" />
            </group>
          )
        })}
    </group>
  )
}

const UP = new THREE.Vector3(0, 1, 0)
