// 6단계(이벤트·커뮤니티·인터뷰)에서 채워지는 훅
export async function afterActivities(state, rng, opts) { return []; }
export async function afterDayEnd(state, rng) {}
export async function afterSeries(state, rng, match, info) {}
export function shouldStop(state) { return false; }
export async function onSeasonEnd(state, rng) {}
