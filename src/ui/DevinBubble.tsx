import type { Mood } from './dialogue'

const OTTER_SRC = `${import.meta.env.BASE_URL}assets/devin-otter.png`

interface DevinBubbleProps {
  text: string
  mood: Mood
  compact?: boolean
  testId?: string
}

const MOOD_LABEL: Record<Mood, string> = {
  idle: 'Devin',
  cheer: 'Devin is delighted',
  grumble: 'Devin is grumbling',
  taunt: 'Devin is smug',
  victory: 'Devin is victorious',
  defeat: 'Devin is sulking',
  think: 'Devin is thinking',
}

export function DevinBubble({ text, mood, compact = false, testId = 'devin-bubble' }: DevinBubbleProps) {
  return (
    <div
      className={`devin-bubble mood-${mood}${compact ? ' compact' : ''}`}
      data-testid={testId}
      data-mood={mood}
      aria-live="polite"
    >
      <div className="portrait" title={MOOD_LABEL[mood]}>
        <img src={OTTER_SRC} alt="Devin the Otter" width={96} height={96} draggable={false} />
        {mood === 'think' && (
          <span className="think-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        )}
      </div>
      <div className="speech" key={text}>
        <span className="speaker">{MOOD_LABEL[mood]}</span>
        <p data-testid={`${testId}-text`}>{text}</p>
      </div>
    </div>
  )
}

export { OTTER_SRC }
