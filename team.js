let activeUser = null;
let generation = 0;
let channel = null;
let running = null;
let pendingRefresh = false;

function renderAccess() {
  el('boardTitle').textContent = staff ? 'Доска команды' : 'Мои заявки';
  el('boardNotice').textContent = staff
    ? 'Новые заявки появляются здесь автоматически.'
    : formReady ? 'Оставьте заявку. Техническое задание и почту увидит команда.'
      : 'Приём заявок пока закрыт. Идёт подключение базы.';
  el('newTask').disabled = !formReady;
  el('staffLogin').hidden = false;
  el('staffLogin').textContent = activeUser ? 'Выйти' : 'Вход для команды';
  el('team').hidden = staff?.role !== 'admin';
}

function clearTeam() {
  if (channel) void db.removeChannel(channel);
  channel = null;
  staff = null;
  opened = null;
  rows = [];
  for (const id of ['detailDialog', 'teamDialog']) el(id).close();
  for (const id of ['detailTitle','detailBrief','detailOutcome','detailEmail','detailDate']) el(id).textContent='';
  el('detailEmail').removeAttribute('href');
  el('loadError').hidden = true;
  renderAccess();
  render();
}

function watchBoard() {
  if (channel) return;
  channel = db.channel('team-inbox-' + generation)
    .on('postgres_changes', {event:'INSERT',schema:'public',table:'board_tasks'}, refreshBoard)
    .on('postgres_changes', {event:'UPDATE',schema:'public',table:'board_tasks'}, refreshBoard)
    .subscribe(status => { if (status === 'SUBSCRIBED') void refreshBoard(); });
}

async function refreshBoard() {
  if (!activeUser || document.hidden) return;
  const version = generation;
  if (running === version) { pendingRefresh = true; return; }
  running = version;
  try {
    const {data:member, error} = await db.from('board_members').select('role')
      .eq('user_id',activeUser).maybeSingle();
    if (version !== generation) return;
    if (error) throw error;
    if (!member) {
      clearTeam();
      el('boardNotice').textContent='У аккаунта пока нет доступа к заявкам. Обратитесь к владельцу доски.';
      return;
    }
    staff={id:activeUser,role:member.role};
    renderAccess();
    watchBoard();
    const fresh=[];
    const pageSize=500;
    for (let offset=0;;offset+=pageSize) {
      const {data,error:readError} = await db.from('board_tasks').select('*')
        .order('created',{ascending:false}).order('id').range(offset,offset+pageSize-1);
      if (version !== generation) return;
      if (readError) throw readError;
      fresh.push(...data.map(row=>({...row,created:Date.parse(row.created)})));
      if (data.length < pageSize) break;
    }
    if (JSON.stringify(rows)!==JSON.stringify(fresh)) {
      rows=fresh;
      render();
    }
    el('loadError').hidden=true;
  } catch {
    if (version===generation) el('loadError').hidden=false;
  } finally {
    if (running===version) {
      running=null;
      if (pendingRefresh) {pendingRefresh=false;void refreshBoard();}
    }
  }
}

function useSession(id) {
  if (activeUser===id) return;
  generation++;
  activeUser=id;
  pendingRefresh=false;
  clearTeam();
  if (id) void refreshBoard();
}

function openTeamInbox() {
  if (location.hash !== '#team') return;
  for (const id of ['newDialog', 'detailDialog', 'teamDialog']) el(id).close();
  if (activeUser) {
    el('loginDialog').close();
    void refreshBoard();
  } else if (!el('loginDialog').open) {
    message('loginError');
    el('loginDialog').showModal();
  }
}

if (live) {
  document.title='Бюро задач · Доска заявок';
  renderAccess();
  db.auth.onAuthStateChange((event,session)=>{
    const id=session?.user.id || null;
    setTimeout(()=>{
      useSession(id);
      if (event === 'INITIAL_SESSION') openTeamInbox();
    },0);
  });
  window.addEventListener('hashchange',openTeamInbox);
  el('staffLogin').addEventListener('click', async ()=>{
    if (!activeUser) {
      message('loginError');
      el('loginDialog').showModal();
      return;
    }
    const {error}=await db.auth.signOut({scope:'local'});
    if (error) {toast('Не удалось выйти. Попробуйте ещё раз.');return;}
    useSession(null);
  });
  el('loginForm').addEventListener('submit', async event=>{
    event.preventDefault();
    const form=event.currentTarget, button=form.querySelector('[type=submit]');
    button.disabled=true;
    try {
      const details=new FormData(form);
      const {data,error}=await db.auth.signInWithPassword({email:details.get('email').trim(),password:details.get('password')});
      if (error) throw error;
      useSession(data.user.id);
      form.reset();
      el('loginDialog').close();
    } catch {
      message('loginError','Не удалось войти. Проверьте почту и пароль.');
    } finally {button.disabled=false;}
  });
  el('status').addEventListener('change',()=>{el('saveStatus').disabled=el('status').value===opened?.status;});
  el('statusForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if (!opened || !staff) return;
    el('saveStatus').disabled=true;
    try {
      const {error}=await db.rpc('board_move',{request_id:opened.id,expected_version:opened.revision,new_status:el('status').value});
      if (error) throw error;
      el('detailDialog').close(); toast('Статус сохранён');
    } catch {
      message('statusError','Не удалось изменить заявку. Откройте её заново и проверьте исполнителя.');
    } finally {void refreshBoard();}
  });
  el('team').addEventListener('click',()=>{message('teamError');el('teamDialog').showModal();});
  el('teamForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget, button=form.querySelector('[type=submit]'), data=new FormData(form);
    button.disabled=true;
    try {
      const {error}=await db.rpc('board_executor',{account_email:data.get('email'),enabled:data.get('access')==='grant'});
      if (error) throw error;
      form.reset(); el('teamDialog').close();toast('Доступ обновлён');
    } catch {
      message('teamError','Проверьте, что у участника есть подтверждённый аккаунт Supabase Auth этой доски.');
    } finally {button.disabled=false;}
  });
  document.addEventListener('visibilitychange',refreshBoard);
  window.addEventListener('online',refreshBoard);
  el('retry').addEventListener('click',refreshBoard);
  setInterval(refreshBoard,10000);
}
async function enableFormWhenReady() {
  const {data}=await db.rpc('board_ready');
  if (data!==true) {
    setTimeout(enableFormWhenReady, 10000);
    return;
  }
  formReady=true;
  renderAccess();
  render();
  if (location.hash==='#new' && !document.querySelector('dialog[open]')) startDraft();
}
if (live) void enableFormWhenReady();
else if (location.hash==='#new') startDraft();
