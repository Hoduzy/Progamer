// 국제 대회·포스트시즌 (4단계에서 구현). 지금은 LCK컵·정규 시즌·CL 정규만 진행.
const BASIC = ['lckCup', 'lck12', 'lck34', 'cl12', 'cl34'];
export function ready(state, comp) { return BASIC.includes(comp.id); }
export function startComp() {}
export function updateComp() {}
