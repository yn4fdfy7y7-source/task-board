const el = id => document.getElementById(id);
const statuses = new Map([['new','Входящие'],['urgent','Срочно'],['active','В работе'],['review','Проверка'],['done','Готово']]);
const categories = new Map([['general','Дальний Восток'],['design','АБК'],['dev','Оранжереи'],['content','Прочее']]);

const fullDate = new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',year:'numeric'});
const shortDate = new Intl.DateTimeFormat('ru',{day:'numeric',month:'short'});
el('today').textContent = fullDate.format(new Date());

const config = window.boardConfig;
const live = Boolean(config?.url && config?.publishableKey);
const db = live ? window.supabase.createClient(config.url, config.publishableKey, {
  auth: {storage: sessionStorage, detectSessionInUrl: false}
}) : null;
let rows = [], staff = null, opened = null;
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
  opened=row;
  const canEdit = staff && (staff.role==='admin' || !row.assignee || row.assignee===staff.id);
  el('statusForm').hidden=!canEdit;
  for (const option of el('status').options) {
    option.disabled = Boolean(canEdit && staff.role==='executor' && !row.assignee && option.value!=='active');
  }
  for (const [id,key] of [['detailTitle','title'],['detailBrief','brief'],['detailOutcome','outcome'],['detailEmail','email']]) el(id).textContent=row[key];
  el('detailEmail').href='mailto:'+encodeURIComponent(row.email).replace('%40','@');
  el('detailDate').textContent=statuses.get(stageOf(row))+' · '+categories.get(row.category)+' · '+fullDate.format(row.created);
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
      if (!group.length && loaded && !query && stage==='new') {
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
  const submit=form.querySelector('[type=submit]');
  if(submit.disabled) return;
  submit.disabled=true;
  message('createError');
  try {
    if (live) {
      const {error}=await db.rpc('board_submit',{
        request_id:draftId,task_title:data.title,task_brief:data.brief,
        task_outcome:data.outcome,contact:data.email,lane:data.category
      });
      if (error) throw error;
    }
    if (!staff) rows.unshift({...data,id:draftId,created:Date.now(),status:'new'});
    else void refreshBoard();
  } catch {
    message('createError','Не удалось подтвердить отправку. Попробуйте ещё раз.');
    return;
  } finally {
    submit.disabled=false;
  }
  el('search').value='';
  draftId='';
  form.reset();
  el('newDialog').close();
  render();
  toast(live ? 'Заявка отправлена команде' : 'Тестовая заявка добавлена в эту вкладку');
});
loaded=true;
render();
