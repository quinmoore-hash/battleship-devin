import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'

/**
 * Optional post-processing (high quality only): a soft bloom that picks up the sun disc,
 * water specular, the lighthouse lamp and the glowing grid lines, plus a gentle vignette.
 */
export function Effects({ night }: { night: number }) {
  return (
    <EffectComposer multisampling={4}>
      <Bloom luminanceThreshold={0.95} luminanceSmoothing={0.2} intensity={0.55 + night * 0.4} mipmapBlur radius={0.6} />
      <Vignette eskil={false} offset={0.25} darkness={0.55} />
    </EffectComposer>
  )
}
