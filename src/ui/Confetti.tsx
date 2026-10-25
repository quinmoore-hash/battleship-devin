import { useState } from 'react'

const COLOURS = ['#f28c28', '#ffb86b', '#5fd3ff', '#ffffff', '#ffd166', '#2ec4b6']

function makePieces(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 2.5,
    duration: 3 + Math.random() * 2.5,
    colour: COLOURS[i % COLOURS.length],
    size: 6 + Math.random() * 8,
    rotate: Math.random() * 360,
  }))
}

export function Confetti({ count = 90 }: { count?: number }) {
  const [pieces] = useState(() => makePieces(count))
  return (
    <div className="confetti" aria-hidden data-testid="confetti">
      {pieces.map((p) => (
        <i
          key={p.id}
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            background: p.colour,
            width: p.size,
            height: p.size * 0.6,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  )
}
