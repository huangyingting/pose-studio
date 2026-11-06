/*
 * Searching the Library and the action picker in everyday words: a name matches what it says, and
 * the words people use for what it shows (a gun for a pistol or a rifle, a workout for push-ups,
 * goodbye for a wave), so a search finds the motion its name does not say in those words.
 */

const WORKOUT = ['push-ups', 'sit-ups', 'squats', 'burpees', 'plank', 'warm up', 'jumping jacks', 'skip rope', 'punching bag', 'curls', 'kettlebell', 'overhead squats'];
const FIGHT = ['punch', 'kick', 'jab', 'uppercut', 'block', 'guard', 'dodge', 'fighting', 'tackle', 'strangle', 'capoeira'];

/** Everyday words, and what the Library's names say for them. */
const ALSO: Record<string, string[]> = {
  gun: ['pistol', 'rifle'], shoot: ['fire', 'aim', 'shot'], weapon: ['pistol', 'rifle', 'sword', 'knife', 'grenade', 'bow'], archery: ['bow', 'arrow'], weights: ['curls', 'kettlebell', 'squats'], dumbbell: ['curls'], barbell: ['overhead squats'], blade: ['sword', 'knife'], bomb: ['grenade'], army: ['rifle', 'cover', 'crawl, low'], soldier: ['rifle', 'salute', 'cover'],
  hello: ['wave', 'greet'], 'come here': ['beckon'], come: ['beckon'], call: ['beckon', 'yell'], hi: ['wave', 'greet'], bye: ['wave'], goodbye: ['wave'], greeting: ['greet', 'wave', 'bow', 'shake hands'],
  workout: WORKOUT, exercise: WORKOUT, gym: WORKOUT, train: WORKOUT,
  fight: FIGHT, attack: [...FIGHT, 'strike'], hit: [...FIGHT, 'hit'], martial: ['kick', 'capoeira'],
  dead: ['die', 'shot', 'lie face down', 'knocked out'], death: ['die', 'shot'], kill: ['strangle', 'shot', 'die', 'stab'],
  injured: ['hurt', 'limping', 'agony', 'pain'], wounded: ['hurt', 'limping', 'agony', 'pain'], pain: ['hurt', 'agony', 'pain'],
  happy: ['cheer', 'laugh', 'excited', 'happy', 'clap'], joy: ['cheer', 'laugh', 'excited', 'happy'], sad: ['cry', 'sad', 'rejected', 'defeated', 'disappointed'],
  afraid: ['scared', 'nervous'], fear: ['scared', 'nervous'], shocked: ['surprised', 'disbelief'],
  shout: ['yell', 'argue'], scream: ['yell', 'scared'], speak: ['talk', 'argue', 'yell'], chat: ['talk'], conversation: ['talk', 'nod', 'shrug', 'shake head'],
  vehicle: ['car'], cigarette: ['smoke'], football: ['tackle', 'football', 'penalty kick'], soccer: ['penalty kick'],
  hide: ['cover', 'corner', 'crouch', 'sneak'], stealth: ['sneak', 'cover', 'corner', 'crawl'],
  floor: ['ground', 'lie', 'lying', 'crawl', 'kneel'], sleep: ['sleep', 'lie'], rest: ['idle', 'sit', 'lie'],
  love: ['kiss', 'hug', 'blow a kiss'], romance: ['kiss', 'hug', 'blow a kiss'], party: ['dance', 'cheer', 'clap', 'drink'],
  stunt: ['roll', 'flip', 'vault', 'slide', 'cartwheel', 'jump'], parkour: ['vault', 'roll', 'jump', 'ledge'],
  tired: ['exhausted', 'yawn'], impatient: ['check the time'], watch: ['check the time'], camera: ['photo'], cook: ['stir'], kitchen: ['stir', 'eat'], dog: ['pet an animal'], cat: ['pet an animal'], yoga: ['meditate'], door: ['door'], shoe: ['shoe'],
  embarrassed: ['cover your face'], shame: ['cover your face'], confused: ['scratch your head', 'shrug'], win: ['celebrate', 'cheer', 'victory'], victory: ['celebrate', 'victory'], ill: ['sneeze', 'cough'], sick: ['sneeze', 'cough'],
  monster: ['zombie'], horror: ['zombie', 'scream', 'thriller'], undead: ['zombie'],
  garden: ['plant', 'water the'], farm: ['plant', 'water the'], food: ['eat'], axe: ['chop'], wood: ['chop'], disco: ['dance', 'twist', 'ymca', 'macarena', 'shuffle'],
};

/** Whether `name` matches what was searched for: as it says, or in the words people use for it. */
export function matches(name: string, query: string): boolean {
  const n = name.toLowerCase();
  const q = query.trim().toLowerCase();
  return !q || n.includes(q) || (ALSO[q] ?? []).some((w) => n.includes(w));
}
