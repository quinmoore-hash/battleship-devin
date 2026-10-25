import type { Difficulty, ShipId } from '../engine'
import { FLEET_BY_ID } from '../engine'

export type DialogueEvent =
  | 'intro'
  | 'placement'
  | 'battle-start'
  | 'player-hit'
  | 'player-miss'
  | 'player-sunk'
  | 'player-streak'
  | 'devin-hit'
  | 'devin-miss'
  | 'devin-sunk'
  | 'devin-streak'
  | 'near-end-player'
  | 'near-end-devin'
  | 'win'
  | 'lose'

export type Mood = 'idle' | 'cheer' | 'grumble' | 'taunt' | 'victory' | 'defeat' | 'think'

interface LineSet {
  any?: string[]
  easy?: string[]
  medium?: string[]
  hard?: string[]
}

/** `{ship}` is replaced with the relevant ship name, `{coord}` with the cell label. */
const LINES: Record<DialogueEvent, LineSet> = {
  intro: {
    any: ['Pick how awake I am today. Choose wisely, I take notes.'],
    easy: ['Easy? Fine. I will play with one paw on the laptop.'],
    medium: ['Medium. I am paying attention now. Mostly.'],
    hard: ['Hard mode. I have a clipboard, a heatmap, and a grudge.'],
  },
  placement: {
    any: [
      'Hide your boats. I promise not to peek. (I am totally peeking.)',
      'Pro tip: ships float better when they are not in a straight line.',
      'Take your time. I have already placed mine. Twice.',
    ],
  },
  'battle-start': {
    any: ['Anchors aweigh! You shoot first, I shoot better.'],
    easy: ['I will go easy on you. Yawn. Where am I again?'],
    medium: ['Shields up, whiskers twitching. Let us begin.'],
    hard: ['Every legal placement of your fleet is already in my spreadsheet.'],
  },
  'player-hit': {
    any: [
      'Ow! That was my favourite plank on the {ship}!',
      'Rude. {coord} was load-bearing.',
      'Okay, okay, you found something. Beginner luck, I assume.',
      'My {ship} felt that. It wants you to know it felt that.',
    ],
    hard: ['Noted. Recalculating the odds in my favour anyway.'],
  },
  'player-miss': {
    any: [
      'Splash! You just scared a very innocent fish at {coord}.',
      'Nothing there but kelp and disappointment.',
      '{coord}? Bold choice. Wrong, but bold.',
      'That is a miss. I will add it to the highlight reel.',
    ],
    easy: ['Miss! Even I could have... wait, no, I probably could not.'],
  },
  'player-sunk': {
    any: [
      'You sank my {ship}! It had so much to live for.',
      'The {ship} is now a very nice reef. Thanks a lot.',
      'Fine. The {ship} was dead weight anyway. (It was not.)',
    ],
    hard: ['The {ship} is down. Statistically irrelevant. Emotionally devastating.'],
  },
  'player-streak': {
    any: [
      'Three in a row? Are you reading my laptop screen?',
      'Okay, who told you where I keep my boats?',
      'Streak alert. I am going to need a snack break.',
    ],
  },
  'devin-hit': {
    any: [
      'Boop! Direct hit at {coord}. Did that hurt? It looked like it hurt.',
      'Found your {ship}! I have an excellent nose for driftwood.',
      'That is a hit. I would like that noted in the official record.',
      'Right in the {ship}. I did not even look.',
    ],
    hard: ['Hit. The heatmap never lies, unlike your poker face.'],
  },
  'devin-miss': {
    any: [
      'Miss. I meant to do that. Reconnaissance.',
      'Splash. The fish at {coord} have been warned.',
      'Hmm. {coord} seemed so promising on paper.',
      'That one was for the pebbles. Pebbles deserve attention too.',
    ],
    easy: ['Miss! I was looking at a very interesting cloud.'],
    hard: ['A miss narrows the search space. You are helping me, really.'],
  },
  'devin-sunk': {
    any: [
      'Glub glub. Your {ship} sleeps with the clams now.',
      'Sunk your {ship}! Should I sign the wreckage?',
      'Another one down. I am going to need a bigger trophy shelf.',
    ],
    medium: ['Hunt, target, sink. Textbook. I wrote the textbook.'],
    hard: ['The {ship} never stood a chance against parity targeting.'],
  },
  'devin-streak': {
    any: [
      'Hit, hit, hit. I could do this with my eyes closed. I might be.',
      'On a roll! Like a river otter. Down a river. On a log.',
    ],
  },
  'near-end-player': {
    any: [
      'One ship left?! Okay, no more Mr Nice Otter.',
      'My last boat is very well hidden. Probably. Please stop.',
    ],
  },
  'near-end-devin': {
    any: [
      'You are down to your last ship. I can smell the driftwood.',
      'One more and I get to do the victory wiggle. Ready the wiggle.',
    ],
  },
  win: {
    any: [
      'You... won? The laptop must be out of battery. Rematch!',
      'Well played. I demand a rematch and a snack, in that order.',
    ],
    hard: ['You beat the heatmap. I am impressed and deeply offended.'],
  },
  lose: {
    any: [
      'Victory wiggle engaged! Better luck next tide.',
      'GG! Your ships are now part of a beautiful underwater exhibit.',
    ],
    easy: ['I won? While napping? Oh dear. Try again!'],
  },
}

export function moodFor(event: DialogueEvent): Mood {
  switch (event) {
    case 'player-hit':
    case 'player-sunk':
    case 'player-streak':
    case 'near-end-player':
      return 'grumble'
    case 'devin-hit':
    case 'devin-sunk':
    case 'devin-streak':
      return 'cheer'
    case 'devin-miss':
    case 'player-miss':
    case 'near-end-devin':
    case 'battle-start':
      return 'taunt'
    case 'win':
      return 'defeat'
    case 'lose':
      return 'victory'
    default:
      return 'idle'
  }
}

export interface DialogueContext {
  difficulty: Difficulty
  shipId?: ShipId
  coord?: string
}

export function pickLine(
  event: DialogueEvent,
  ctx: DialogueContext,
  rng: () => number = Math.random,
): string {
  const set = LINES[event]
  const pool = [...(set.any ?? []), ...(set[ctx.difficulty] ?? []), ...(set[ctx.difficulty] ?? [])]
  const raw = pool[Math.floor(rng() * pool.length)] ?? ''
  const ship = ctx.shipId ? FLEET_BY_ID[ctx.shipId]?.name ?? 'ship' : 'ship'
  return raw.replaceAll('{ship}', ship).replaceAll('{coord}', ctx.coord ?? 'there')
}

export const DIALOGUE_LINE_COUNT = Object.values(LINES).reduce(
  (n, set) => n + Object.values(set).reduce((m, arr) => m + arr.length, 0),
  0,
)
