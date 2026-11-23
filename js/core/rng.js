// 시드 기반 난수 (sfc32). 상태를 저장/복원할 수 있다.
function hashSeed(seed) {
  // 문자열/숫자 시드를 32비트 정수 4개로 확장 (xmur3)
  const str = String(seed);
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const out = [];
  for (let i = 0; i < 4; i++) {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    out.push(h >>> 0);
  }
  return out;
}

export class RNG {
  constructor(seed = Date.now(), state = null) {
    this.seed = seed;
    this.s = state ? state.slice() : hashSeed(seed);
    if (!state) for (let i = 0; i < 12; i++) this.next();
  }
  static from(obj) { return new RNG(obj.seed, obj.s); }
  toJSON() { return { seed: this.seed, s: this.s.slice() }; }
  next() {
    let [a, b, c, d] = this.s;
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    this.s = [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
    return (t >>> 0) / 4294967296;
  }
  float(a = 0, b = 1) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  normal(mean = 0, sd = 1) {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // items: [{w, v}] 또는 [[v, w]]
  weighted(items, wKey = 'w') {
    let total = 0;
    for (const it of items) total += Array.isArray(it) ? it[1] : it[wKey];
    let r = this.next() * total;
    for (const it of items) {
      const w = Array.isArray(it) ? it[1] : it[wKey];
      if (r < w) return Array.isArray(it) ? it[0] : it;
      r -= w;
    }
    const last = items[items.length - 1];
    return Array.isArray(last) ? last[0] : last;
  }
  sub() { return new RNG(this.int(1, 2 ** 31 - 1)); }
}
