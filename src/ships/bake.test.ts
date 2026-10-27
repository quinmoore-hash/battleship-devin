import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { bakeObject, bakeStats, geometrySignature, materialKey } from './bakeGeometry'

const box = (mat: THREE.Material, x = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat)
  m.position.x = x
  return m
}

describe('materialKey', () => {
  it('groups stock materials by parameters, not identity', () => {
    const a = new THREE.MeshStandardMaterial({ color: '#8b5a2b', roughness: 0.8 })
    const b = new THREE.MeshStandardMaterial({ color: '#8b5a2b', roughness: 0.8 })
    const c = new THREE.MeshStandardMaterial({ color: '#8b5a2b', roughness: 0.5 })
    expect(materialKey(a)).toBe(materialKey(b))
    expect(materialKey(a)).not.toBe(materialKey(c))
  })
  it('keeps materials with custom shader hooks unique', () => {
    const a = new THREE.MeshStandardMaterial()
    const b = new THREE.MeshStandardMaterial()
    b.onBeforeCompile = () => {}
    expect(materialKey(a)).not.toBe(materialKey(b))
    expect(materialKey(b)).toBe(`id:${b.uuid}`)
    expect(materialKey(new THREE.ShaderMaterial())).toMatch(/^id:/)
  })
})

describe('bakeObject', () => {
  it('merges same-material meshes into one draw and keeps the triangle count', () => {
    const root = new THREE.Group()
    const wood = new THREE.MeshStandardMaterial({ color: 'brown' })
    const iron = new THREE.MeshStandardMaterial({ color: 'black', metalness: 1 })
    const inner = new THREE.Group()
    inner.position.set(0, 2, 0)
    inner.add(box(wood, 0), box(wood, 3), box(new THREE.MeshStandardMaterial({ color: 'brown' }), 6))
    root.add(inner, box(iron, 9))
    const baked = bakeObject(root)
    const stats = bakeStats(baked)
    expect(stats.drawCalls).toBe(2)
    expect(stats.triangles).toBe(4 * 12)
    expect(baked.userData.bakeStats.sourceMeshes).toBe(4)
    // transforms baked into the geometry (the inner group's +2 y and the boxes' x offsets)
    const bb = new THREE.Box3().setFromObject(baked)
    expect(bb.min.y).toBeCloseTo(-0.5)
    expect(bb.max.y).toBeCloseTo(2.5)
    expect(bb.max.x).toBeCloseTo(9.5)
    // shares the source material instance (uniform updates on the live copy show on the bake)
    expect(baked.children.some((c) => (c as THREE.Mesh).material === wood)).toBe(true)
  })
  it('skips invisible subtrees and keeps instanced meshes as-is', () => {
    const root = new THREE.Group()
    const mat = new THREE.MeshStandardMaterial()
    const hidden = box(mat)
    hidden.visible = false
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(), mat, 5)
    inst.position.z = 4
    root.add(hidden, inst, box(mat))
    const baked = bakeObject(root)
    expect(baked.children).toHaveLength(2)
    const kept = baked.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh
    expect(kept.count).toBe(5)
    expect(kept.position.z).toBeCloseTo(4)
    expect(bakeStats(baked).triangles).toBe(12 + 12 * 5)
  })
  it('keeps `userData.bakeAsIs` cloth meshes in their own frame with the depth material, no shadow', () => {
    const root = new THREE.Group()
    const cloth = new THREE.MeshStandardMaterial()
    cloth.onBeforeCompile = () => {}
    const depth = new THREE.MeshDepthMaterial()
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.12, 10, 2), cloth)
    flag.userData.bakeAsIs = true
    flag.customDepthMaterial = depth
    flag.castShadow = true
    const pivot = new THREE.Group()
    pivot.position.set(1, 3, 0)
    pivot.rotation.y = Math.PI
    pivot.add(flag)
    root.add(pivot, box(new THREE.MeshStandardMaterial()))
    const baked = bakeObject(root)
    expect(baked.children).toHaveLength(2)
    const kept = baked.children.find((c) => (c as THREE.Mesh).material === cloth) as THREE.Mesh
    expect(kept.geometry).toBe(flag.geometry)
    expect(kept.position.x).toBeCloseTo(1)
    expect(kept.position.y).toBeCloseTo(3)
    expect(kept.quaternion.angleTo(pivot.quaternion)).toBeCloseTo(0)
    expect(kept.customDepthMaterial).toBe(depth)
    expect(kept.castShadow).toBe(false)
  })
  it('separates geometries with different attribute layouts and line segments', () => {
    const root = new THREE.Group()
    const mat = new THREE.MeshStandardMaterial()
    const noUv = new THREE.BoxGeometry()
    noUv.deleteAttribute('uv')
    root.add(box(mat), new THREE.Mesh(noUv, mat), new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), new THREE.LineBasicMaterial()))
    const baked = bakeObject(root)
    expect(baked.children).toHaveLength(3)
    expect(geometrySignature(noUv)).not.toBe(geometrySignature(new THREE.BoxGeometry()))
    expect(baked.children.filter((c) => (c as THREE.LineSegments).isLineSegments)).toHaveLength(1)
  })
})
