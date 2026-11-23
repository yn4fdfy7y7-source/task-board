const el = id => document.getElementById(id);
const statuses = new Map([['new','Входящие'],['urgent','Срочно'],['active','В работе'],['review','Проверка'],['done','Готово']]);
const categories = new Map([['general','Дальний Восток'],['design','АБК'],['dev','Оранжереи'],['content','Прочее']]);

const fullDate = new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',year:'numeric'});
const shortDate = new Intl.DateTimeFormat('ru',{day:'numeric',month:'short'});
el('today').textContent = fullDate.format(new Date());

const {mode, invite} = window.boardConfig;
const inbox = mode === 'inbox';
let rows = [];
let loaded = false, draftId = '', noticeTimer;
const stageOf = row => row.stage || row.status;
function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text != null) item.textContent = text;
  return item;
}
for (const [id, options] of [['newStatus',statuses],['status',statuses],['newCategory',categories],['category',categories]]) {
  for (const [value,label] of options) el(id).append(new Option(label,value));
}
function message(id,text='') {
  el(id).textContent=text;
  el(id).hidden=!text;
}
function toast(text) {
  clearTimeout(noticeTimer);
  el('notice').textContent=text;
  noticeTimer=setTimeout(()=>el('notice').textContent='',3600);
}
function startDraft(category, status) {
  if (!draftId) {
    el('createForm').reset();
    draftId=crypto.randomUUID();
  }
  if (category) el('newCategory').value=category;
  if (status) el('newStatus').value=status;
  el('newDialog').dataset.lane=el('newCategory').value;
  message('createError');
  el('newDialog').showModal();
}
function showDetail(row) {
  for (const [id,key] of [['detailTitle','title'],['detailBrief','brief'],['detailOutcome','outcome'],['detailEmail','email']]) el(id).textContent=row[key];
  el('detailEmail').href='mailto:'+encodeURIComponent(row.email).replace('%40','@');
  el('detailDate').textContent='Входящие · '+categories.get(row.category)+' · '+fullDate.format(row.created);
  el('status').value=stageOf(row);
  el('category').value=row.category;
  el('detailDialog').dataset.lane=row.category;
  el('saveStatus').disabled=true;
  message('statusError');
  el('detailDialog').showModal();
}
function taskNote(row) {
  const card=node('button','note task');
  card.type='button';
  card.dataset.id=row.id;
  card.draggable=false;
  card.style.setProperty('--tilt',((parseInt(row.id.slice(0,4),16)%23-11)/8)+'deg');
  card.append(node('strong','',row.title),node('small','',shortDate.format(row.created)));
  card.addEventListener('click',()=>showDetail(row));
  return card;
}
function addControl(lane, stage, starter) {
  const button=node('button',starter?'note add-note':'cell-add');
  button.type='button';
  button.dataset.add=lane+'-'+stage;
  button.setAttribute('aria-label','Добавить заявку. '+categories.get(lane)+', '+statuses.get(stage));
  if (starter) {
    const plus=node('span','note-plus','+');
    plus.setAttribute('aria-hidden','true');
    button.append(plus,node('strong','','Добавить заявку'));
  } else {
    button.textContent='+';
  }
  button.addEventListener('click',()=>startDraft(lane,stage));
  return button;
}
function render() {
  const query=el('search').value.trim().toLocaleLowerCase('ru');
  const filtered=rows.filter(r=>[r.title,r.brief,r.outcome,r.email].some(v=>v.toLocaleLowerCase('ru').includes(query)));
  const byCell=new Map();
  const laneHasTasks=new Set(rows.map(r=>r.category));
  for (const row of filtered) {
    const key=row.category+':'+stageOf(row);
    if (!byCell.has(key)) byCell.set(key,[]);
    byCell.get(key).push(row);
  }
  el('total').textContent=loaded?rows.length:'…';
  message('searchSummary',query && loaded?(filtered.length?'Найдено заявок — '+filtered.length:'Заявок по этому запросу нет.'):'');
  const board=el('board');
  const head=node('thead'), headings=node('tr');
  const corner=node('th','rail corner','Направление');
  corner.scope='col';
  headings.append(corner);
  for (const [stage,label] of statuses) {
    const th=node('th');
    th.scope='col';
    th.append(node('span','paper stage-label '+stage,label));
    headings.append(th);
  }
  head.append(headings);
  const body=node('tbody');
  for (const [lane,label] of categories) {
    const line=node('tr');
    line.dataset.lane=lane;
    const th=node('th','rail');
    th.scope='row';
    th.append(node('span','paper lane-name',label));
    line.append(th);
    for (const stage of statuses.keys()) {
      const cell=node('td');
      cell.dataset.lane=lane;
      cell.dataset.stage=stage;
      const pile=node('div','pile');
      const group=byCell.get(lane+':'+stage) || [];
      for (const row of group) pile.append(taskNote(row));
      if (!inbox && !group.length && loaded && !query && stage==='new') {
        pile.append(addControl(lane,stage,stage==='new' && !laneHasTasks.has(lane)));
      }
      cell.append(pile);
      line.append(cell);
    }
    body.append(line);
  }
  board.replaceChildren(head,body);
}
el('newTask').addEventListener('click',()=>startDraft());
el('share').addEventListener('click', async () => {
  const url = new URL(invite || location.pathname, location.origin);
  url.hash = 'new';
  try {
    await navigator.clipboard.writeText(url.href);
    toast('Ссылка на форму скопирована');
  } catch {
    el('inviteUrl').value = url.href;
    el('inviteDialog').showModal();
    el('inviteUrl').select();
  }
});
if (!inbox && location.hash === '#new') startDraft();
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
el('search').addEventListener('input',render);

el('newCategory').addEventListener('change',()=>el('newDialog').dataset.lane=el('newCategory').value);
el('createForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const data=Object.fromEntries(new FormData(form));
  if(['title','brief','outcome','email'].some(key=>!data[key].trim())){
    message('createError','Заполните все поля заявки.');
    return;
  }
  const button = form.querySelector('[type=submit]');
  if (button.disabled) return;
  button.disabled = true;
  message('createError');
  try {
    const row = mode === 'demo'
      ? {...data, id:draftId, created:Date.now(), status:'new'}
      : await api({method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...data, id:draftId})});
    rows = [row, ...rows.filter(item => item.id !== row.id)];
  } catch (error) {
    message('createError', error.message);
    return;
  } finally {
    button.disabled = false;
  }
  el('search').value='';
  draftId='';
  form.reset();
  el('newDialog').close();
  render();
  toast(mode === 'demo' ? 'Тестовая заявка добавлена в эту вкладку' : 'Заявка отправлена на доску');
});
async function api(options = {}) {
  let response;
  try {
    response = await fetch('./api/tasks', {cache:'no-store', ...options});
  } catch {
    throw new Error('Сервер недоступен. Попробуйте ещё раз.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || 'Сервер недоступен. Попробуйте ещё раз.');
  return data;
}
let refreshing = false;
async function refreshInbox() {
  if (refreshing || document.hidden) return;
  refreshing = true;
  try {
    const data = await api();
    if (!Array.isArray(data)) throw new Error();
    el('loadError').hidden = true;
    if (!loaded || JSON.stringify(rows) !== JSON.stringify(data)) {
      rows = data;
      loaded = true;
      render();
    }
  } catch {
    el('loadError').hidden = false;
  } finally {
    refreshing = false;
  }
}
if (mode !== 'demo') {
  document.title = inbox ? 'Входящие заявки · Бюро задач' : 'Подать заявку · Бюро задач';
  el('boardNotice').textContent = inbox
    ? 'Здесь появляются заявки из общей формы. Доска обновляется автоматически.'
    : 'Отправьте заявку. Техническое задание и почту увидит владелец доски.';
}
if (inbox) {
  document.querySelector('h1').textContent = 'Входящие заявки';
  el('newTask').hidden = true;
  el('retry').addEventListener('click', refreshInbox);
  document.addEventListener('visibilitychange', refreshInbox);
  setInterval(refreshInbox, 5000);
  void refreshInbox();
} else {
  loaded = true;
}
render();
