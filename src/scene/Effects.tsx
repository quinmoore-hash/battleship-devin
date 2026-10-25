import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, SMAA, Vignette } from '@react-three/postprocessing'
import type { Quality } from './Water'

export interface EffectsProps {
  /** 0 = full day, 1 = deep night. Bloom gets stronger so lanterns and fire glow after dark. */
  night: number
  /** 0..1 storm intensity: desaturates and deepens the vignette. */
  storm?: number
  /** `low` renders no post-processing at all. */
  quality?: Quality
  /** Perf-tier switch (default on); `false` renders no post-processing. */
  enabled?: boolean
}

/** Bloom tuned for lantern/fire highlights, a soft vignette and a warm tropical colour grade. */
export function Effects({ night, storm = 0, quality = 'high', enabled = true }: EffectsProps) {
  if (quality === 'low' || !enabled) return null
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      <Bloom luminanceThreshold={0.9} luminanceSmoothing={0.25} intensity={0.5 + night * 0.6 + storm * 0.15} mipmapBlur radius={0.65} />
      <HueSaturation saturation={0.12 - storm * 0.35 - night * 0.1} hue={0} />
      <BrightnessContrast brightness={-0.01 - storm * 0.03} contrast={0.08 + storm * 0.06} />
      <Vignette eskil={false} offset={0.22} darkness={0.5 + storm * 0.2 + night * 0.1} />
    </EffectComposer>
  )
}
