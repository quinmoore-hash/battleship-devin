import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useCallback, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Coord } from '../engine'
import { cellToWorld, worldToCell, type Vec3 } from './layout'

export interface BoardGridProps {
  origin: Vec3
  size?: number
  cellSize?: number
  /** Cell to light up (hover / selected). */
  highlight?: Coord | null
  /** Accent colour for lines and highlight. */
  color?: string
  /** Hex colour of the highlight cell (defaults to a warm otter-orange). */
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
  ctx.font = '700 86px Inter, system-ui, Helvetica, Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 10
  ctx.fillStyle = color
  ctx.fillText(text, 64, 70)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
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
 * A translucent 10x10 grid floating just above the water with glowing cell borders, an
 * optional highlighted cell and coordinate labels along the edges. Pointer events are
 * resolved to cells via `worldToCell` so the UI can hover/fire on the 3D board.
 */
export function BoardGrid({
  origin,
  size = 10,
  cellSize = 1,
  highlight = null,
  color = '#7fe9ff',
  highlightColor = '#ffb347',
  labels = true,
  onCellPointerMove,
  onCellClick,
}: BoardGridProps) {
  const extent = size * cellSize
  const center: Vec3 = [origin[0] + extent / 2, origin[1], origin[2] + extent / 2]
  const highlightRef = useRef<THREE.Mesh>(null)
  const lineMat = useRef<THREE.LineBasicMaterial>(null)
  const lastHover = useRef<string | null>(null)

  const lines = useMemo(() => {
    const pts: number[] = []
    const y = 0
    for (let i = 0; i <= size; i++) {
      const o = -extent / 2 + i * cellSize
      pts.push(o, y, -extent / 2, o, y, extent / 2)
      pts.push(-extent / 2, y, o, extent / 2, y, o)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [size, cellSize, extent])

  const edge = useMemo(() => {
    const h = extent / 2
    const pts = [-h, 0, -h, h, 0, -h, h, 0, -h, h, 0, h, h, 0, h, -h, 0, h, -h, 0, h, -h, 0, -h]
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [extent])

  const lineColor = useMemo(() => new THREE.Color(color), [color])
  const glowColor = useMemo(() => new THREE.Color(color).multiplyScalar(1.6), [color])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (highlightRef.current) {
      const m = highlightRef.current.material as THREE.MeshBasicMaterial
      m.opacity = 0.45 + 0.25 * Math.sin(t * 4)
      highlightRef.current.position.y = 0.03 + 0.01 * Math.sin(t * 4)
    }
    if (lineMat.current) {
      lineMat.current.opacity = 0.55 + 0.15 * Math.sin(t * 1.5)
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
  const labelSize = cellSize * 0.62
  const labelOffset = cellSize * 0.7

  return (
    <group position={center}>
      {/* translucent glass plate; also the pointer target */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={1}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        onClick={handleClick}
      >
        <planeGeometry args={[extent, extent]} />
        <meshPhysicalMaterial
          color={color}
          transparent
          opacity={0.14}
          roughness={0.15}
          metalness={0}
          transmission={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* glowing cell borders (toneMapped=false so bloom picks them up) */}
      <lineSegments geometry={lines} position={[0, 0.012, 0]} renderOrder={2}>
        <lineBasicMaterial ref={lineMat} color={glowColor} transparent opacity={0.65} toneMapped={false} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={edge} position={[0, 0.02, 0]} renderOrder={3}>
        <lineBasicMaterial color={lineColor.clone().multiplyScalar(2.2)} toneMapped={false} depthWrite={false} />
      </lineSegments>
      {hl && (
        <mesh
          ref={highlightRef}
          position={[hl[0] - center[0], 0.03, hl[2] - center[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={4}
        >
          <planeGeometry args={[cellSize * 0.94, cellSize * 0.94]} />
          <meshBasicMaterial color={highlightColor} transparent opacity={0.6} toneMapped={false} depthWrite={false} />
        </mesh>
      )}
      {labels &&
        Array.from({ length: size }, (_, i) => {
          const o = -extent / 2 + (i + 0.5) * cellSize
          return (
            <group key={i}>
              {/* column letters along the near (+z) and far (-z) edges */}
              <Label text={LETTERS[i]} position={[o, 0.02, extent / 2 + labelOffset]} size={labelSize} color="#eaf6ff" />
              <Label text={LETTERS[i]} position={[o, 0.02, -extent / 2 - labelOffset]} size={labelSize} color="#eaf6ff" />
              {/* row numbers along the left and right edges */}
              <Label text={String(i + 1)} position={[-extent / 2 - labelOffset, 0.02, o]} size={labelSize} color="#eaf6ff" />
              <Label text={String(i + 1)} position={[extent / 2 + labelOffset, 0.02, o]} size={labelSize} color="#eaf6ff" />
            </group>
          )
        })}
    </group>
  )
}
