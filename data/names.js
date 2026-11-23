// 가상 닉네임 생성기. 실존 프로 선수 닉네임은 BLOCKLIST로 걸러낸다.
const WORDS = [
  'Lantern', 'Comet', 'Ember', 'Nocturn', 'Quill', 'Halcyon', 'Pyrex', 'Vanta', 'Morrow', 'Sable',
  'Glint', 'Tundra', 'Orbit', 'Riptide', 'Zenith', 'Cobalt', 'Fable', 'Mirage', 'Harbor', 'Warden',
  'Solace', 'Rune', 'Kestrel', 'Vesper', 'Drift', 'Onyx', 'Lumen', 'Talon', 'Aster', 'Breeze',
  'Cinder', 'Dusk', 'Ferro', 'Gale', 'Haze', 'Ivo', 'Jolt', 'Koi', 'Lyric', 'Mako',
  'Nimbus', 'Oak', 'Pulse', 'Quartz', 'Raze', 'Shard', 'Thorn', 'Umbra', 'Vigil', 'Wisp',
  'Xeno', 'Yarrow', 'Zeal', 'Arcus', 'Bolt', 'Crux', 'Dawnly', 'Echoes', 'Flint', 'Grove',
  'Helix', 'Inkwell', 'Jade', 'Karst', 'Lotus', 'Mosaic', 'Nova', 'Opal', 'Prism', 'Quasar',
  'Rook', 'Sonder', 'Tide', 'Ursa', 'Vale', 'Wick', 'Yonder', 'Zephir', 'Atlas', 'Basil',
  'Cypher', 'Delta', 'Eon', 'Fjord', 'Garnet', 'Hollow', 'Iris', 'Juniper', 'Kite', 'Lark',
  'Maple', 'Neon', 'Oracle', 'Pebble', 'Quest', 'Raven', 'Saber', 'Topaz', 'Unity', 'Vortex',
  'Wolfe', 'Yeti', 'Zircon', 'Anvil', 'Briar', 'Coral', 'Dune', 'Elm', 'Frost', 'Gecko',
  'Hydra', 'Ignis', 'Jinn', 'Kumo', 'Lynx', 'Marrow', 'Nectar', 'Osprey', 'Pine', 'Rivet',
  'Sprout', 'Tempo', 'Uplift', 'Velvet', 'Willow', 'Yuzu', 'Zest', 'Alder', 'Bramble', 'Cask',
  'Dagger', 'Ether', 'Falcon', 'Gust', 'Hearth', 'Icarus', 'Jester', 'Kindle', 'Ledger', 'Monsoon',
];
const SYL_A = ['Ka', 'Ve', 'Ri', 'Zo', 'Mi', 'Ta', 'Lu', 'No', 'Se', 'Da', 'Ha', 'Yo', 'Ji', 'Ro', 'Pa', 'Xi', 'Qu', 'Be', 'Fe', 'Gu', 'So', 'Te', 'Wa', 'Ny', 'Ae', 'Ki', 'Mo', 'Re', 'Sa', 'Vi'];
const SYL_B = ['ran', 'lo', 'vin', 'zen', 'rix', 'mel', 'dor', 'sha', 'ku', 'ren', 'lix', 'tos', 'vo', 'nar', 'kel', 'mi', 'ron', 'sel', 'dan', 'yu', 'ris', 'gon', 'pel', 'ter', 'fyn', 'lan', 'zu', 'ber', 'nos', 'cai'];
const SUFFIX = ['', '', '', '', 'x', 'o', 'y', 'ie', 'ion', 'us'];

// 실존 프로 선수 닉네임 (사용 금지)
export const BLOCKLIST = new Set([
  'faker', 'chovy', 'keria', 'zeus', 'oner', 'gumayusi', 'peyz', 'canyon', 'showmaker', 'ruler', 'viper', 'peanut',
  'doran', 'kiin', 'canna', 'bdd', 'deft', 'lehends', 'duro', 'aiming', 'kellin', 'lucid', 'beryl', 'pyosik', 'clid',
  'zeka', 'delight', 'smash', 'siwoo', 'cuzz', 'perfect', 'deokdam', 'morgan', 'kingen', 'clozer', 'teddy', 'effort',
  'rascal', 'callme', 'ucal', 'envyy', 'jiwoo', 'kael', 'andil', 'sylvie', 'dudu', 'croco', 'raptor', 'ellim', 'willer',
  'sponge', 'rahel', 'calix', 'fate', 'diable', 'vicla', 'hena', 'peter', 'life', 'moham', 'bull', 'dove', 'karis',
  'gideon', 'way', 'kiwoogi', 'ivory', 'clear', 'lazyfeel', 'juhan', 'pleata', 'loki', 'bin', 'knight', 'elk', 'on',
  'xun', 'meiko', '369', 'kanavi', 'tian', 'caps', 'jankos', 'mikyx', 'humanoid', 'yike', 'brokenblade', 'impact',
  'inspired', 'jojopyun', 'blaber', 'berserker', 'vulcan', 'apa', 'massu', 'busio', 'hanssama', 'labrov', 'upset',
  'razork', 'rekkles', 'caliste', 'yeon', 'quid', 'bwipo', 'licorice', 'fudge', 'core', 'coreJJ', 'corejj', 'tarzan',
  'scout', 'jackeylove', 'rookie', 'theshy', 'uzi', 'ming', 'xiaohu', 'wei', 'gala', 'hope', 'missing', 'bin', 'shanks',
  'creme', 'leave', 'ale', 'tarzan', 'light', 'kaiwing', 'maple', 'karsa', 'hanabi', 'westdoor', 'unified', 'kati',
  'bdd', 'mata', 'ambition', 'crown', 'cvmax', 'score', 'mystic', 'pawn', 'smeb', 'kuro', 'mata', 'wolf', 'bang',
  'bengi', 'marin', 'impact', 'easyhoon', 'duke', 'blank', 'huni', 'untara', 'sangyoon', 'effort', 'cuvee', 'ambition',
  'expession', 'rich', 'nuguri', 'khan', 'ghost', 'beryl', 'tusin', 'gorilla', 'mata', 'rush', 'lira', 'kakao', 'rookie',
  'wolf', 'nova', 'atlas', 'jade', 'raven', 'rush', 'saber', 'flame', 'pray', 'deft', 'madlife', 'mafa', 'mightybear',
  'lindarang', 'sword', 'trick', 'piccaboo', 'kramer', 'kuzan', 'bdd', 'trigger', 'peanut', 'tempt', 'lava', 'dread',
  'reapered', 'hoya', 'kiaya', 'kingen', 'pyosik', 'moojin', 'route', 'ellim', 'frozen', 'tolki', 'jun', 'feisty',
  'yaharong', 'jinho', 'malrang', 'hirit', 'odoamne', 'jensen', 'perkz', 'mikyx', 'nemesis', 'hylissang', 'targamas',
  'oscarinin', 'hans', 'noah', 'trymbi', 'elyoya', 'supa', 'myrwn', 'alvaro', 'ice', 'kaiser', 'nisqy', 'vetheo',
  'zven', 'doublelift', 'bjergsen', 'sneaky', 'jensen', 'blaber', 'fudge', 'emenes', 'berserker', 'zven', 'busio',
  'quad', 'massu', 'eyla', 'yeon', 'contractz', 'spica', 'tactical', 'palafox', 'wildturtle', 'robo', 'tinowns',
  'brtt', 'titan', 'route', 'croc', 'robo', 'wiz', 'shrimp', 'kogi', 'ceos', 'aegis', 'jojo', 'mikasa', 'hiro',
]);

export function makeNamePool(rng, count) {
  const out = new Set();
  const words = rng.shuffle(WORDS);
  for (const w of words) if (!BLOCKLIST.has(w.toLowerCase())) out.add(w);
  let guard = 0;
  while (out.size < count && guard++ < count * 20) {
    const n = rng.pick(SYL_A) + rng.pick(SYL_B) + rng.pick(SUFFIX);
    if (n.length < 3 || n.length > 9) continue;
    if (BLOCKLIST.has(n.toLowerCase())) continue;
    out.add(n);
  }
  return rng.shuffle([...out]);
}

export function isBlocked(nick) { return BLOCKLIST.has(String(nick).toLowerCase().replace(/\s/g, '')); }

const COACH_PRE = ['Mentor', 'Tactica', 'Overseer', 'Sensei', 'Compass', 'Anchor', 'Architect', 'Pilot', 'Keeper', 'Scholar', 'Bastion', 'Helm', 'Sage', 'Admiral', 'Maestro', 'Navigator', 'Forge', 'Pillar', 'Beacon', 'Strategos'];
export function makeCoachNames(rng, count) {
  const list = rng.shuffle(COACH_PRE);
  const out = [];
  for (let i = 0; i < count; i++) out.push(list[i % list.length] + (i >= list.length ? String(i) : ''));
  return out;
}
