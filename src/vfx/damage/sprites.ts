import * as THREE from 'three'

/**
 * Instanced billboard sprites with procedural shaders (no textures to load). Each instance's
 * matrix gives position + scale; `aParam` = (alpha, rotation, seed, extra). Three fragment
 * programs: `flame` (additive licking tongue, anchored at its base), `smoke` (soft noisy puff,
 * fogged) and `glow` (radial additive flash).
 */
export type SpriteKind = 'flame' | 'smoke' | 'glow'

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = p * 2.07 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }
`

const VERT = /* glsl */ `
  attribute vec4 aParam;
  uniform float uUpright;
  uniform float uAnchorBottom;
  varying vec2 vUv;
  varying vec4 vParam;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vParam = aParam;
    vec3 centre = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec2 sc = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
    vec2 p = vec2(position.x, position.y + 0.5 * uAnchorBottom) * sc;
    float c = cos(aParam.y);
    float s = sin(aParam.y);
    p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    vec4 mv = modelViewMatrix * vec4(centre, 1.0);
    vec3 upView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    vec3 up = mix(vec3(0.0, 1.0, 0.0), upView, uUpright);
    vec3 right = normalize(cross(up, vec3(0.0, 0.0, 1.0)));
    mv.xyz += right * p.x + up * p.y;
    vec4 mvPosition = mv;
    gl_Position = projectionMatrix * mv;
    #include <fog_vertex>
  }
`

const FRAG: Record<SpriteKind, string> = {
  flame: /* glsl */ `
    uniform float uTime;
    uniform float uIntensity;
    varying vec2 vUv;
    varying vec4 vParam;
    ${NOISE}
    void main() {
      vec2 uv = vUv;
      float seed = vParam.z;
      float t = uTime * 1.7 + seed * 10.0;
      vec2 q = vec2(uv.x * 2.4 + seed * 5.0, uv.y * 3.2 - t);
      float n = fbm(q);
      float n2 = fbm(q * 2.3 + vec2(3.1, -t * 0.6));
      float x = (uv.x - 0.5) * 2.0 + (n - 0.5) * 1.1 * uv.y;
      float width = (1.0 - uv.y * 0.85) * (0.7 + 0.3 * n2);
      float body = 1.0 - smoothstep(width * 0.15, width, abs(x));
      float tip = 1.0 - smoothstep(0.45, 1.0, uv.y + (n - 0.5) * 0.6);
      float base = smoothstep(0.0, 0.1, uv.y);
      float f = body * tip * base * (0.55 + 0.9 * n) * vParam.x;
      if (f < 0.025) discard;
      vec3 col = mix(vec3(0.6, 0.03, 0.0), vec3(1.0, 0.36, 0.03), smoothstep(0.05, 0.5, f));
      col = mix(col, vec3(1.0, 0.78, 0.25), smoothstep(0.6, 1.0, f) * (1.0 - uv.y * 0.6));
      gl_FragColor = vec4(col * uIntensity * 1.35 * f, f);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
  smoke: /* glsl */ `
    uniform float uTime;
    uniform float uOpacity;
    uniform vec3 uColor;
    varying vec2 vUv;
    varying vec4 vParam;
    #include <fog_pars_fragment>
    ${NOISE}
    void main() {
      vec2 p = vUv - 0.5;
      float d = length(p) * 2.0;
      float n = fbm(vUv * 3.0 + vParam.z * 7.0 + vec2(0.0, -uTime * 0.12));
      float n2 = vnoise(vUv * 7.0 + vParam.z * 3.0 + uTime * 0.05);
      float edge = 1.0 - smoothstep(0.25, 1.0, d + (n - 0.5) * 0.7 + (n2 - 0.5) * 0.25);
      float a = edge * vParam.x * uOpacity;
      if (a < 0.01) discard;
      vec3 col = uColor * (0.7 + 0.6 * n) * (1.0 + 0.45 * (p.y + p.x * 0.35));
      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }
  `,
  glow: /* glsl */ `
    uniform float uIntensity;
    uniform vec3 uColor;
    varying vec2 vUv;
    varying vec4 vParam;
    void main() {
      float d = length(vUv - 0.5) * 2.0;
      float a = pow(max(0.0, 1.0 - d), 2.2) * vParam.x;
      if (a < 0.01) discard;
      vec3 col = mix(uColor, vec3(1.0, 0.97, 0.85), pow(max(0.0, 1.0 - d), 4.0) * 0.8);
      gl_FragColor = vec4(col * uIntensity * a, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
}

export interface SpriteMaterialOptions {
  /** 1 = stays upright (world up), 0 = faces the camera fully and may spin. */
  upright?: number
  /** 1 = the quad grows upward from its position (flames); 0 = centred. */
  anchorBottom?: number
  color?: THREE.ColorRepresentation
  opacity?: number
  intensity?: number
}

export function makeSpriteMaterial(kind: SpriteKind, opts: SpriteMaterialOptions = {}): THREE.ShaderMaterial {
  const additive = kind !== 'smoke'
  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uUpright: { value: opts.upright ?? (kind === 'flame' ? 1 : 0) },
    uAnchorBottom: { value: opts.anchorBottom ?? (kind === 'flame' ? 1 : 0) },
    uIntensity: { value: opts.intensity ?? 1 },
    uOpacity: { value: opts.opacity ?? 0.8 },
    uColor: { value: new THREE.Color(opts.color ?? (kind === 'smoke' ? '#3a3734' : '#ff9a2a')) },
  }
  return new THREE.ShaderMaterial({
    uniforms: kind === 'smoke' ? THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]) : uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG[kind],
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: kind === 'smoke',
    side: THREE.DoubleSide,
  })
}

/** Unit quad shared by every sprite mesh. */
let quad: THREE.PlaneGeometry | null = null
export function spriteQuad(): THREE.PlaneGeometry {
  if (!quad) quad = new THREE.PlaneGeometry(1, 1)
  return quad
}

/**
 * The per-instance `aParam` attribute of an InstancedMesh, allocated on first use. Idempotent and
 * keyed on the mesh itself: when R3F rebuilds the mesh (e.g. the instance count changes with the
 * reduced-motion setting) the new mesh gets its own attribute instead of inheriting a stale ref.
 */
export function attachParams(mesh: THREE.InstancedMesh, count: number): THREE.InstancedBufferAttribute {
  const existing = mesh.geometry.getAttribute('aParam') as THREE.InstancedBufferAttribute | undefined
  if (existing && existing.count === count) return existing
  const geom = mesh.geometry.clone()
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
  attr.setUsage(THREE.DynamicDrawUsage)
  geom.setAttribute('aParam', attr)
  mesh.geometry = geom
  return attr
}
