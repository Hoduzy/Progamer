// 기기 간 세이브 옮기기: 세이브 코드 복사 / 붙여넣기, JSON 불러오기 확인창
import { App, modal, toast } from './app.js';
import { esc, fmtDate } from '../core/util.js';
import { copySaveCode, readSaveCode, importJSON, saveTo, slotInfo, summaryOf, describeSlot } from './save.js';
import { startLoaded } from './screens/title.js';

const sumText = s => s ? `${esc(s.nick)} (${esc(s.team)}${s.squad === 'academy' ? ' 2군' : ''}) · ${fmtDate(s.date)}` : '알 수 없음';

// "현재 세이브를 덮어씁니다" 확인
export async function confirmOverwrite(incoming) {
  const cur = App.state ? summaryOf(App.state) : null;
  const auto = slotInfo('auto');
  const v = await modal({
    title: '⚠ 현재 세이브를 덮어씁니다',
    body: `<div class="col" style="gap:10px">
      <div>불러온 세이브로 <b>지금 진행 중인 게임과 자동 저장</b>이 바뀝니다. 되돌릴 수 없습니다.</div>
      <div class="panel" style="padding:8px 12px"><div class="tiny dim">불러올 세이브</div><b>${sumText(incoming)}</b></div>
      <div class="panel" style="padding:8px 12px"><div class="tiny dim">현재</div>${cur ? sumText(cur) : esc(describeSlot(auto))}</div>
      <div class="small muted">현재 진행을 남겨 두려면 취소한 뒤 슬롯에 저장하거나 세이브 코드를 먼저 복사해 두세요.</div></div>`,
    buttons: [{ label: '취소', value: false }, { label: '덮어쓰고 불러오기', primary: true, danger: true, value: true }],
  });
  return v === true;
}

async function applyImport(loaded, summary) {
  if (!(await confirmOverwrite(summary))) return false;
  saveTo('auto', loaded.state, loaded.rng);
  startLoaded(loaded);
  toast('세이브를 불러왔습니다.');
  return true;
}

export async function importFile(file) {
  try {
    const r = await importJSON(file);
    return await applyImport(r, r.summary || summaryOf(r.state));
  } catch (err) { toast('불러오기 실패: ' + esc(err.message)); return false; }
}

// 세이브 코드 복사 — 버튼을 누른 그 순간 클립보드 쓰기를 시작해야 Safari에서도 된다
export async function copyCodeFlow() {
  if (!App.state) return;
  let res;
  try { res = await copySaveCode(App.state, App.rng); } catch (err) { toast('세이브 코드 만들기 실패: ' + esc(err.message)); return; }
  const kb = (res.code.length / 1024).toFixed(0);
  if (res.copied) toast(`세이브 코드를 복사했습니다 (${kb}KB)`);
  modal({
    title: res.copied ? '✅ 세이브 코드를 복사했어요' : '세이브 코드',
    body: `<div class="col" style="gap:8px">
      <div class="small">${res.copied ? '다른 기기에서 <b>설정·저장 → 세이브 코드 붙여넣기</b> (또는 타이틀 → 불러오기)에 붙여넣으세요. 메모·메신저 나에게 보내기 등으로 옮기면 됩니다.' : '자동 복사가 막혀 있어요. 아래 칸을 길게 눌러 <b>전체 선택 → 복사</b> 하세요.'}</div>
      <textarea class="inp code-box" id="codebox" readonly>${esc(res.code)}</textarea>
      <div class="tiny dim">길이 ${kb}KB · ${sumText(summaryOf(App.state))}</div></div>`,
    buttons: [{ label: '다시 복사', onClick: bg => { const t = bg.querySelector('#codebox'); t.focus(); t.select(); t.setSelectionRange(0, t.value.length); let ok = false; try { ok = document.execCommand('copy'); } catch { } if (!ok && navigator.clipboard) navigator.clipboard.writeText(res.code).then(() => toast('복사했습니다.'), () => toast('직접 선택해서 복사하세요.')); else toast(ok ? '복사했습니다.' : '직접 선택해서 복사하세요.'); return false; } }, { label: '닫기', primary: true }],
  });
}

// 세이브 코드 붙여넣기
export function pasteCodeFlow(onDone) {
  modal({
    title: '세이브 코드 붙여넣기',
    body: `<div class="col" style="gap:8px">
      <div class="small">다른 기기에서 복사한 세이브 코드(LCKC…)를 아래 칸에 붙여넣으세요.</div>
      <textarea class="inp code-box" id="codein" placeholder="LCKC1.…" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea>
      <div class="row"><button class="btn sm" id="clip">📋 클립보드에서 붙여넣기</button><span class="tiny dim grow" id="codeinfo"></span></div></div>`,
    buttons: [{ label: '취소', value: null }, {
      label: '불러오기', primary: true, onClick: bg => {
        const text = bg.querySelector('#codein').value;
        const info = bg.querySelector('#codeinfo');
        info.textContent = '확인 중…';
        readSaveCode(text).then(async ({ data, loaded }) => {
          bg._close('ok');
          const ok = await applyImport(loaded, data.summary || summaryOf(loaded.state));
          if (onDone) onDone(ok);
        }).catch(err => { info.textContent = '❌ ' + err.message; info.className = 'tiny neg grow'; });
        return false;
      },
    }],
    onOpen: bg => {
      const ta = bg.querySelector('#codein');
      bg.querySelector('#clip').addEventListener('click', async () => {
        try { ta.value = await navigator.clipboard.readText(); toast('붙여넣었습니다.'); } catch { toast('클립보드를 읽을 수 없어요. 칸을 길게 눌러 붙여넣으세요.'); ta.focus(); }
      });
    },
  });
}
