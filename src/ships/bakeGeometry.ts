import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Pure (no React) half of the ship bake — see `./bake.tsx`. Unit-tested in `bake.test.ts`. */

const defaultOnBeforeCompile = THREE.Material.prototype.onBeforeCompile

const texId = (t: THREE.Texture | null | undefined) => (t ? t.uuid : '-')

/**
 * Grouping key for merging: stock materials with the same parameters share one draw call; any
 * material with a custom shader hook (`onBeforeCompile`, `ShaderMaterial`) is keyed by identity
 * because its uniforms are what make it unique.
 */
export function materialKey(m: THREE.Material): string {
  if ((m as THREE.ShaderMaterial).isShaderMaterial || m.onBeforeCompile !== defaultOnBeforeCompile) return `id:${m.uuid}`
  const s = m as THREE.MeshStandardMaterial & THREE.MeshPhysicalMaterial & THREE.LineBasicMaterial
  return [
    m.type,
    s.color?.getHexString() ?? '-',
    texId(s.map),
    texId(s.normalMap),
    texId(s.roughnessMap),
    texId(s.metalnessMap),
    texId(s.emissiveMap),
    texId(s.alphaMap),
    texId(s.aoMap),
    s.roughness ?? '-',
    s.metalness ?? '-',
    s.emissive?.getHexString() ?? '-',
    s.emissiveIntensity ?? '-',
    s.envMapIntensity ?? '-',
    s.clearcoat ?? '-',
    s.sheen ?? '-',
    s.transmission ?? '-',
    s.linewidth ?? '-',
    m.transparent ? 1 : 0,
    m.opacity,
    m.side,
    m.alphaTest,
    m.depthWrite ? 1 : 0,
    m.depthTest ? 1 : 0,
    m.blending,
    (s as THREE.MeshStandardMaterial).flatShading ? 1 : 0,
    m.vertexColors ? 1 : 0,
    (s as THREE.MeshStandardMaterial).wireframe ? 1 : 0,
    m.polygonOffset ? `${m.polygonOffsetFactor}/${m.polygonOffsetUnits}` : 0,
    s.normalScale ? `${s.normalScale.x},${s.normalScale.y}` : '-',
  ].join('|')
}

/** Attribute layout signature — `mergeGeometries` needs identical attribute sets and index-ness. */
export function geometrySignature(g: THREE.BufferGeometry): string {
  const names = Object.keys(g.attributes).sort()
  return (g.index ? 'i' : 'n') + ':' + names.map((n) => `${n}${g.attributes[n].itemSize}`).join(',')
}

interface Bucket {
  kind: 'mesh' | 'lines'
  material: THREE.Material
  geoms: THREE.BufferGeometry[]
  castShadow: boolean
  receiveShadow: boolean
  renderOrder: number
  types: Set<string>
}

const tmpM = new THREE.Matrix4()

export interface BakeStats {
  drawCalls: number
  triangles: number
  sourceMeshes: number
}

export function bakeStats(root: THREE.Object3D): BakeStats {
  let drawCalls = 0
  let triangles = 0
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.geometry) return
    drawCalls++
    const g = m.geometry
    const n = (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3
    triangles += (m as THREE.Mesh).isMesh ? Math.floor(n) * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1) : 0
  })
  return { drawCalls, triangles, sourceMeshes: 0 }
}

/**
 * Bake `root`'s visible subtree into a flat group of merged meshes, in `root`'s local frame.
 * Instanced meshes, sprites, points and multi-material meshes are kept as-is (cloned, sharing
 * their geometry/material). Everything else is merged per (kind, material key, renderOrder,
 * attribute layout).
 */
export function bakeObject(root: THREE.Object3D): THREE.Group {
  // the caller usually hides the live copy under `root`; bake its subtree regardless
  const wasVisible = root.visible
  root.visible = true
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const out = new THREE.Group()
  out.name = 'baked-ship'
  const buckets = new Map<string, Bucket>()
  let sourceMeshes = 0

  const labels: string[] = []
  const keepAsIs = (o: THREE.Object3D) => {
    labels.push(`${o.type}:${(o as THREE.Mesh).geometry?.type ?? ''} as-is`)
    const c = o.clone(false)
    tmpM.multiplyMatrices(inv, o.matrixWorld)
    tmpM.decompose(c.position, c.quaternion, c.scale)
    c.updateMatrix()
    out.add(c)
    return c
  }

  root.traverseVisible((o) => {
    if (o === root) return
    const mesh = o as THREE.Mesh
    const isLineSeg = (o as THREE.LineSegments).isLineSegments
    if ((o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.SkinnedMesh).isSkinnedMesh) {
      keepAsIs(o)
      return
    }
    if (!mesh.isMesh && !isLineSeg) {
      if ((o as THREE.Line).isLine) keepAsIs(o)
      return
    }
    if (!mesh.geometry || !mesh.material) return
    if (Array.isArray(mesh.material)) {
      keepAsIs(o)
      return
    }
    if (mesh.userData.bakeAsIs) {
      // cloth (kit Flag / Sail): the vertex shader displaces from the plane's own local xy, so the
      // geometry must stay in its own frame instead of being transformed into the ship's
      const c = keepAsIs(o) as THREE.Mesh
      c.customDepthMaterial = mesh.customDepthMaterial
      c.castShadow = o.castShadow && triangleCount(mesh.geometry) >= SHADOW_MIN_TRIS
      return
    }
    sourceMeshes++
    tmpM.multiplyMatrices(inv, o.matrixWorld)
    const g = mesh.geometry.clone()
    for (const k of Object.keys(g.morphAttributes)) delete g.morphAttributes[k as keyof typeof g.morphAttributes]
    g.applyMatrix4(tmpM)
    const kind = isLineSeg ? 'lines' : 'mesh'
    const key = `${kind}|${o.renderOrder}|${materialKey(mesh.material)}|${geometrySignature(g)}`
    let b = buckets.get(key)
    if (!b) {
      b = { kind, material: mesh.material, geoms: [], castShadow: false, receiveShadow: false, renderOrder: o.renderOrder, types: new Set() }
      buckets.set(key, b)
    }
    b.geoms.push(g)
    b.types.add(mesh.geometry.type)
    b.castShadow ||= o.castShadow
    b.receiveShadow ||= o.receiveShadow
  })

  for (const b of buckets.values()) {
    const merged = b.geoms.length === 1 ? b.geoms[0] : mergeGeometries(b.geoms, false)
    const label = `${[...b.types].join('+')} x${b.geoms.length} ${b.castShadow ? 'S' : ''}`
    if (!merged) {
      for (const g of b.geoms) {
        out.add(makeObject(b, g))
        labels.push(label)
      }
      continue
    }
    if (b.geoms.length > 1) for (const g of b.geoms) g.dispose()
    out.add(makeObject(b, merged))
    labels.push(label)
  }
  root.visible = wasVisible
  out.userData.bakeStats = { ...bakeStats(out), sourceMeshes } satisfies BakeStats
  out.userData.buckets = labels
  return out
}

/** Merged parts smaller than this never cast shadows: the hull / deck / sails carry the silhouette, trim just costs a draw. */
export const SHADOW_MIN_TRIS = 4000

const triangleCount = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3

function makeObject(b: Bucket, g: THREE.BufferGeometry) {
  g.computeBoundingSphere()
  const o = b.kind === 'lines' ? new THREE.LineSegments(g, b.material) : new THREE.Mesh(g, b.material)
  const tris = triangleCount(g)
  o.castShadow = b.castShadow && b.kind === 'mesh' && tris >= SHADOW_MIN_TRIS
  o.receiveShadow = b.receiveShadow
  o.renderOrder = b.renderOrder
  o.matrixAutoUpdate = false
  return o
}

