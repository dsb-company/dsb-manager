/* DSB Manager · Acessos ao DSB Client
   Módulo isolado: gerencia o vínculo entre clientes e usuários do Portal. */
(() => {
'use strict';

const $=(s,b=document)=>b.querySelector(s);
const $$=(s,b=document)=>[...b.querySelectorAll(s)];
const state={accesses:[],ready:null,error:'',loading:false,filter:'Todos',query:'',lastLoaded:0};
let secondaryObserver=null,appObserver=null,contentObserver=null;

function ctx(){return window.DSB_MANAGER_CONTEXT||null;}
function client(){return ctx()?.getClient?.()||null;}
function E(value){return ctx()?.escape?.(String(value??''))??String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function icon(name,size=18){return ctx()?.icon?.(name,size)||'';}
function toast(message,error=false){ctx()?.toast?.(message,error);}
function friendly(error){return ctx()?.friendly?.(error)||(error?.message||String(error));}
function managerClients(){return ctx()?.getClients?.()||[];}
function currentMember(){return ctx()?.getMember?.()||null;}
function isAdmin(){return currentMember()?.role==='admin';}
function activeRoute(){return location.hash==='#accesses';}
function company(clientId){return managerClients().find(r=>r.id===clientId)?.data?.name||'Cliente não encontrado';}
function initials(value){return String(value||'DSB').trim().split(/\s+/).slice(0,2).map(v=>v[0]).join('').toUpperCase();}
function dateTime(value){if(!value)return'—';const d=new Date(value);if(Number.isNaN(d.getTime()))return'—';return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);}
function statusText(status){return status==='pending'?'Convite pendente':status==='disabled'?'Desativado':'Ativo';}
function statusClass(status){return status==='pending'?'pending':status==='disabled'?'disabled':'active';}
function statusPill(status){return `<span class="portal-status ${statusClass(status)}"><span></span>${E(statusText(status))}</span>`;}
function schemaMissing(error){const t=`${error?.code||''} ${error?.message||''} ${error?.details||''}`;return /42P01|42703|PGRST202|PGRST205|portal_status|dsb_customer_users|dsb_link_existing_customer_user|schema cache|does not exist/i.test(t);}

async function loadAccesses(force=false){
  const c=client();if(!c||state.loading)return;
  if(!force&&Date.now()-state.lastLoaded<4000)return;
  state.loading=true;
  try{
    const {data,error}=await c.from('dsb_customer_users').select('user_id,client_id,name,email,active,portal_status,created_at,invited_at,activated_at,updated_at').order('created_at',{ascending:false});
    if(error)throw error;
    state.accesses=data||[];state.ready=true;state.error='';state.lastLoaded=Date.now();
  }catch(error){
    if(schemaMissing(error)){state.ready=false;state.error='';}
    else state.error=friendly(error);
  }finally{
    state.loading=false;injectNav();decorateClientCards();
  }
}

function navButton(){
  const b=document.createElement('button');
  b.className='nav-item dsb-portal-nav'+(activeRoute()?' active':'');b.dataset.portalNav='true';
  if(activeRoute())b.setAttribute('aria-current','page');
  const svg='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h5"/><circle cx="16.5" cy="16.5" r="1.5"/></svg>';
  const pending=state.accesses.filter(a=>a.portal_status==='pending'&&a.active).length;
  b.innerHTML=`${svg}<span>Acessos</span>${pending?`<span class="nav-count">${pending}</span>`:''}`;
  return b;
}

function injectNav(){
  const nav=$('#secondary-nav');if(!nav||$('#app-view')?.hidden)return;
  if(activeRoute()){
    $$('.nav-item.active').forEach(item=>{item.classList.remove('active');item.removeAttribute('aria-current');});
  }
  const existing=nav.querySelector('[data-portal-nav]');
  if(existing){
    existing.classList.toggle('active',activeRoute());
    if(activeRoute())existing.setAttribute('aria-current','page');else existing.removeAttribute('aria-current');
    const old=existing.querySelector('.nav-count'),pending=state.accesses.filter(a=>a.portal_status==='pending'&&a.active).length;
    if(pending){if(old)old.textContent=String(pending);else existing.insertAdjacentHTML('beforeend',`<span class="nav-count">${pending}</span>`);}else old?.remove();
    return;
  }
  const button=navButton();const team=nav.querySelector('[data-nav="team"]');
  if(team)nav.insertBefore(button,team);else nav.prepend(button);
}

function setBreadcrumb(){const el=$('#breadcrumb');if(el)el.textContent='Acessos';}
function summaryCard(title,value,subtitle,kind){return `<section class="portal-summary-card ${kind}"><span>${E(title)}</span><strong>${E(String(value).padStart(2,'0'))}</strong><small>${E(subtitle)}</small></section>`;}

function filtered(){
  const q=state.query.trim().toLocaleLowerCase('pt-BR');
  return state.accesses.filter(a=>{
    const status=state.filter==='Todos'||a.portal_status===state.filter;
    const text=[a.name,a.email,company(a.client_id),statusText(a.portal_status)].join(' ').toLocaleLowerCase('pt-BR');
    return status&&(!q||text.includes(q));
  });
}

function setupPanel(){return `<div class="page-heading"><div><h1>Acessos</h1><p>Gerencie quem pode entrar no DSB Client.</p></div></div><section class="panel portal-setup-panel"><div class="portal-setup-icon">${icon('lock',22)}</div><div><h2>Ative a gestão de acessos</h2><p>Execute <strong>supabase/portal-access.sql</strong> no SQL Editor do mesmo Supabase usado pelo Manager. O arquivo apenas complementa a tabela de usuários do Portal e adiciona funções administrativas seguras.</p><p class="field-note">Para convidar e-mails que ainda não existem no Authentication, publique também a Edge Function <strong>dsb-portal-admin</strong>. Usuários que já existem, como o seu teste, podem ser vinculados somente com o SQL.</p></div></section>`;}

function accessActions(a,compact=false){
  if(!isAdmin())return '<span class="subtle">Somente leitura</span>';
  const toggle=a.active
    ? `<button class="button secondary portal-small danger-soft" data-portal-toggle="${E(a.user_id)}" data-active="false">Desativar</button>`
    : `<button class="button secondary portal-small" data-portal-toggle="${E(a.user_id)}" data-active="true">Reativar</button>`;
  let links='';
  if(a.active){
    links=a.portal_status==='pending'
      ? `<button class="button secondary portal-small" data-portal-link="${E(a.user_id)}">Gerar link de convite</button>`
      : `<button class="button secondary portal-small" data-portal-link="${E(a.user_id)}">Acesso direto</button><button class="button secondary portal-small" data-portal-reset="${E(a.user_id)}">Redefinir senha</button>`;
  }
  return `<div class="portal-row-actions ${compact?'compact':''}">${links}${toggle}</div>`;
}

function accessTable(list){
  if(!list.length)return `<div class="portal-empty">${icon('team',30)}<strong>Nenhum acesso encontrado.</strong><span>Adicione um usuário do Portal do Cliente para começar.</span></div>`;
  return `<div class="table-wrap portal-table-wrap"><table class="portal-table"><thead><tr><th>EMPRESA</th><th>USUÁRIO</th><th>E-MAIL</th><th>STATUS</th><th>CRIADO</th><th>AÇÕES</th></tr></thead><tbody>${list.map(a=>`<tr><td><strong>${E(company(a.client_id))}</strong></td><td><div class="portal-user"><span class="avatar">${E(initials(a.name))}</span><strong>${E(a.name)}</strong></div></td><td>${E(a.email)}</td><td>${statusPill(a.portal_status)}</td><td>${E(dateTime(a.created_at))}</td><td>${accessActions(a,true)}</td></tr>`).join('')}</tbody></table></div>`;
}

function listPage(){
  const list=filtered();
  const active=state.accesses.filter(a=>a.active&&a.portal_status==='active').length;
  const pending=state.accesses.filter(a=>a.active&&a.portal_status==='pending').length;
  const disabled=state.accesses.filter(a=>!a.active||a.portal_status==='disabled').length;
  const companies=new Set(state.accesses.filter(a=>a.active).map(a=>a.client_id)).size;
  return `<div class="page-heading"><div><h1>Acessos</h1><p>Usuários autorizados a entrar no DSB Client.</p></div><div class="heading-actions">${isAdmin()?`<button class="button primary" data-portal-new>${icon('plus',16)}Adicionar acesso</button>`:''}</div></div>
  <div class="portal-summary-grid">${summaryCard('Ativos',active,'Contas liberadas','active')}${summaryCard('Pendentes',pending,'Ainda não ativaram','pending')}${summaryCard('Desativados',disabled,'Sem acesso ao portal','disabled')}${summaryCard('Empresas',companies,'Com algum acesso','companies')}</div>
  <div class="toolbar portal-toolbar"><div class="filter-tabs">${[['Todos','Todos'],['active','Ativos'],['pending','Pendentes'],['disabled','Desativados']].map(([v,l])=>`<button class="filter-tab ${state.filter===v?'active':''}" data-portal-filter="${v}">${l}</button>`).join('')}</div><input class="filter-input" id="portal-search" type="search" value="${E(state.query)}" placeholder="Buscar empresa, nome ou e-mail..." aria-label="Buscar acessos"></div>
  ${state.error?`<div class="error-panel">${E(state.error)} <button class="text-button" data-portal-refresh>Tentar novamente</button></div>`:''}
  <section class="panel portal-list-panel"><div class="portal-list-head"><div><h2 class="panel-title">Acessos ao DSB Client</h2><p class="panel-subtitle">${list.length} de ${state.accesses.length} usuários</p></div><button class="icon-button" data-portal-refresh aria-label="Atualizar acessos">${icon('refresh',17)}</button></div>${accessTable(list)}</section>`;
}

async function renderAccesses({force=false}={}){
  const content=$('#content');if(!content||$('#app-view')?.hidden)return;
  setBreadcrumb();injectNav();await loadAccesses(force);if(!activeRoute())return;
  if(state.ready===false){content.innerHTML=setupPanel();return;}
  content.innerHTML=listPage();setBreadcrumb();injectNav();
}

function openAccesses(){history.replaceState(null,'','#accesses');state.filter='Todos';state.query='';renderAccesses({force:true});$('#sidebar')?.classList.remove('open');$('#sidebar-overlay')?.classList.remove('show');window.scrollTo({top:0,behavior:'instant'});}
function showModal(title,html){const modal=$('#modal'),body=$('#modal-content');if(!modal||!body)return;body.innerHTML=`<div class="modal-head"><h2>${E(title)}</h2><button class="icon-button" data-action="close" aria-label="Fechar">${icon('close')}</button></div><div class="modal-body">${html}</div>`;if(!modal.open)modal.showModal();}

function clientAccessSummary(clientId){
  if(state.ready===false)return {label:'Configurar acesso',kind:'setup'};
  const all=state.accesses.filter(a=>a.client_id===clientId);
  const active=all.filter(a=>a.active&&a.portal_status==='active').length;
  const pending=all.filter(a=>a.active&&a.portal_status==='pending').length;
  if(active)return {label:`${active} acesso${active===1?'':'s'} ativo${active===1?'':'s'}`,kind:'active'};
  if(pending)return {label:`${pending} convite${pending===1?'':'s'} pendente${pending===1?'':'s'}`,kind:'pending'};
  if(all.length)return {label:'Acesso desativado',kind:'disabled'};
  return {label:'Sem acesso ao portal',kind:'none'};
}

function decorateClientCards(){
  if(location.hash!=='#clients'||$('#app-view')?.hidden)return;
  $$('.client-card').forEach(card=>{
    const edit=card.querySelector('[data-edit]');const clientId=edit?.dataset.edit;if(!clientId)return;
    const summary=clientAccessSummary(clientId);
    let box=card.querySelector('.portal-card-access');
    if(!box){box=document.createElement('div');box.className='portal-card-access';const bottom=card.querySelector('.card-bottom');if(bottom)card.insertBefore(box,bottom);else card.append(box);}
    const signature=`${summary.kind}|${summary.label}|${clientId}`;
    if(box.dataset.portalSignature!==signature){
      box.dataset.portalSignature=signature;
      box.innerHTML=`<div><span class="portal-card-dot ${summary.kind}"></span><div><small>ACESSO AO PORTAL</small><strong>${E(summary.label)}</strong></div></div><button type="button" class="text-button" data-portal-client="${E(clientId)}">Gerenciar →</button>`;
    }
  });
}

function accessRowsForClient(clientId){return state.accesses.filter(a=>a.client_id===clientId).sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR'));}
function accessUserList(clientId){
  const list=accessRowsForClient(clientId);
  if(!list.length)return '<div class="portal-modal-empty">Nenhum usuário do portal vinculado a esta empresa.</div>';
  return `<div class="portal-modal-users">${list.map(a=>`<article class="portal-modal-user"><span class="avatar">${E(initials(a.name))}</span><div class="portal-modal-user-info"><strong>${E(a.name)}</strong><small>${E(a.email)}</small></div>${statusPill(a.portal_status)}${accessActions(a,true)}</article>`).join('')}</div>`;
}

function accessForm(clientId=''){
  const clients=managerClients();
  const clientField=clientId
    ? `<input type="hidden" name="client_id" value="${E(clientId)}"><div class="portal-fixed-company"><small>EMPRESA</small><strong>${E(company(clientId))}</strong></div>`
    : `<div><label for="portal-client-select">Empresa</label><select id="portal-client-select" name="client_id" required><option value="">Selecione...</option>${clients.map(r=>`<option value="${E(r.id)}">${E(r.data.name)}</option>`).join('')}</select></div>`;
  return `<form id="portal-access-form"><div class="form-grid"><div class="span-2">${clientField}</div><div><label for="portal-name">Nome do usuário</label><input id="portal-name" name="name" required minlength="2" maxlength="120" placeholder="João Silva"></div><div><label for="portal-email">E-mail de acesso</label><input id="portal-email" name="email" type="email" required maxlength="254" placeholder="joao@empresa.com"></div></div><p class="field-note">Se o e-mail já existir no Authentication, o vínculo é feito na hora. Se ainda não existir, o sistema tentará enviar um convite pelo Supabase.</p><p class="form-error" id="portal-access-error" role="alert"></p><div class="form-actions"><button type="button" class="button secondary" data-action="close">Cancelar</button><button type="submit" class="button primary">Criar acesso</button></div></form>`;
}

function clientModal(clientId){
  const record=managerClients().find(r=>r.id===clientId);if(!record){toast('Cliente não encontrado.',true);return;}
  showModal(`Acesso ao Portal · ${record.data.name}`,`<div class="portal-client-modal"><div class="portal-client-intro"><p>Usuários desta empresa que podem entrar no DSB Client.</p></div>${accessUserList(clientId)}${isAdmin()?`<div class="portal-add-divider"><span>ADICIONAR USUÁRIO</span></div>${accessForm(clientId)}`:'<div class="info-callout">Somente administradores podem criar ou alterar acessos.</div>'}</div>`);
}

function newAccessModal(){
  if(!isAdmin()){toast('Apenas administradores podem criar acessos.',true);return;}
  if(!managerClients().length){toast('Cadastre um cliente antes de criar um acesso.',true);return;}
  showModal('Adicionar acesso ao DSB Client',accessForm());
}

async function parseFunctionError(error){
  let message=error?.message||'Não foi possível executar a função.';
  try{
    const response=error?.context;
    if(response?.clone){const data=await response.clone().json();message=data?.error||data?.message||message;}
  }catch{}
  if(/not found|404|FunctionsFetchError|Failed to send/i.test(message)){
    message='A Edge Function dsb-portal-admin ainda não está publicada. Usuários que já existem no Authentication podem ser vinculados normalmente; para novos e-mails, publique a função em supabase/functions/dsb-portal-admin.';
  }
  return message;
}

async function invokeAdmin(body){
  const c=client();if(!c)throw Error('Sessão indisponível.');
  const {data,error}=await c.functions.invoke('dsb-portal-admin',{body});
  if(error)throw Error(await parseFunctionError(error));
  if(data?.error)throw Error(data.error);
  return data||{};
}

async function createAccess(form){
  const values=Object.fromEntries(new FormData(form));
  const clientId=String(values.client_id||''),name=String(values.name||'').trim(),email=String(values.email||'').trim().toLowerCase();
  if(!managerClients().some(r=>r.id===clientId))throw Error('Selecione uma empresa válida.');
  if(name.length<2||name.length>120)throw Error('Informe um nome entre 2 e 120 caracteres.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Informe um e-mail válido.');

  // Toda criação/vinculação passa pela Edge Function. Ela é a única fonte de
  // verdade para decidir se o usuário já existe no Auth, criar convite e
  // persistir o vínculo. Isso evita o estado intermediário em que o Auth já
  // contém o e-mail, mas o acesso ainda não foi salvo no Manager.
  const result=await invokeAdmin({action:'invite',clientId,name,email});
  await loadAccesses(true);
  return result;
}

async function setActive(userId,active){
  const c=client();const {error}=await c.rpc('dsb_set_customer_user_active',{p_user_id:userId,p_active:active});
  if(error)throw error;await loadAccesses(true);
}

async function generateLink(userId){
  const result=await invokeAdmin({action:'generate_link',userId});
  if(!result.link)throw Error('O Supabase não retornou um link de acesso.');
  return {link:result.link,type:result.type};
}

async function generateRecoveryLink(userId){
  const result=await invokeAdmin({action:'generate_recovery_link',userId});
  if(!result.link)throw Error('O Supabase não retornou um link de redefinição de senha.');
  return {link:result.link,type:'recovery'};
}

function linkModal(link,type){
  const title=type==='invite'?'Novo link de convite':type==='recovery'?'Link de redefinição de senha':'Link de acesso ao DSB Client';
  const help=type==='recovery'
    ? 'Este link abre o fluxo de criação de uma nova senha no DSB Client. Envie somente para o responsável correto da conta.'
    : 'Este link dá acesso a uma etapa sensível da conta. Envie somente para o responsável correto da empresa.';
  showModal(title,`<p class="portal-link-help">${help}</p><label for="portal-generated-link">Link</label><textarea id="portal-generated-link" class="portal-link-box" readonly>${E(link)}</textarea><p class="form-error" id="portal-copy-error"></p><div class="form-actions"><button type="button" class="button secondary" data-action="close">Fechar</button><button type="button" class="button primary" data-portal-copy>Copiar link</button></div>`);
}

async function copyGeneratedLink(){
  const field=$('#portal-generated-link');if(!field)return;
  try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(field.value);else{field.select();document.execCommand('copy');}toast('Link copiado.');}
  catch(error){$('#portal-copy-error').textContent='Não foi possível copiar automaticamente. Selecione o link e copie manualmente.';}
}

async function handleSubmit(event){
  const form=event.target;if(form.id!=='portal-access-form')return;
  event.preventDefault();const button=form.querySelector('button[type="submit"]'),errorEl=$('#portal-access-error');button.disabled=true;errorEl.textContent='';
  try{
    const result=await createAccess(form);$('#modal').close();
    if(result?.manualLink){
      linkModal(result.manualLink,result?.linkType||'invite');
      toast(result?.mode==='existing_pending'?'Usuário já existia e foi vinculado. Use o link para concluir o primeiro acesso.':'Acesso criado. Também gerei um link para você encaminhar ao cliente.');
    }
    else if(result?.mode==='invite_sent')toast('Convite enviado e acesso criado como pendente.');
    else if(result?.mode==='invite_link')toast('Acesso criado como pendente. Gere um link de convite na lista.');
    else if(result?.mode==='linked_existing')toast('Usuário existente vinculado à empresa.');
    else toast('Acesso criado.');
    if(activeRoute())renderAccesses();else decorateClientCards();
  }catch(error){errorEl.textContent=friendly(error);}finally{if(button?.isConnected)button.disabled=false;}
}

async function handleClick(event){
  const b=event.target.closest('button,[data-portal-client]');if(!b)return;
  if(b.dataset.portalNav!==undefined){event.preventDefault();openAccesses();return;}
  if(b.dataset.portalClient){await loadAccesses();clientModal(b.dataset.portalClient);return;}
  if(b.dataset.portalNew!==undefined&&activeRoute()){newAccessModal();return;}
  if(b.dataset.portalRefresh!==undefined&&activeRoute()){renderAccesses({force:true});return;}
  if(b.dataset.portalFilter&&activeRoute()){state.filter=b.dataset.portalFilter;$('#content').innerHTML=listPage();setBreadcrumb();return;}
  if(b.dataset.portalToggle){
    const active=b.dataset.active==='true';const access=state.accesses.find(a=>a.user_id===b.dataset.portalToggle);if(!access)return;
    b.disabled=true;try{await setActive(access.user_id,active);toast(active?'Acesso reativado.':'Acesso desativado.');if($('#modal').open&&location.hash==='#clients')clientModal(access.client_id);else if(activeRoute())renderAccesses();decorateClientCards();}catch(error){toast(friendly(error),true);}finally{if(b.isConnected)b.disabled=false;}return;
  }
  if(b.dataset.portalLink){
    b.disabled=true;try{const result=await generateLink(b.dataset.portalLink);linkModal(result.link,result.type);}catch(error){toast(friendly(error),true);}finally{if(b.isConnected)b.disabled=false;}return;
  }
  if(b.dataset.portalReset){
    b.disabled=true;try{const result=await generateRecoveryLink(b.dataset.portalReset);linkModal(result.link,result.type);}catch(error){toast(friendly(error),true);}finally{if(b.isConnected)b.disabled=false;}return;
  }
  if(b.dataset.portalCopy!==undefined){copyGeneratedLink();return;}
}

function handleInput(event){
  if(event.target.id!=='portal-search'||!activeRoute())return;
  const pos=event.target.selectionStart;state.query=event.target.value;$('#content').innerHTML=listPage();setBreadcrumb();const field=$('#portal-search');field?.focus();try{field?.setSelectionRange(pos,pos)}catch{}
}

async function handleRefreshCapture(event){
  const b=event.target.closest?.('#refresh');if(!b||!activeRoute())return;
  event.preventDefault();event.stopImmediatePropagation();b.disabled=true;
  try{await renderAccesses({force:true});toast('Acessos atualizados.');}catch(error){toast(friendly(error),true);}finally{b.disabled=false;}
}

function ensureObservers(){
  const nav=$('#secondary-nav');if(nav&&!secondaryObserver){secondaryObserver=new MutationObserver(()=>injectNav());secondaryObserver.observe(nav,{childList:true});}
  const app=$('#app-view');if(app&&!appObserver){appObserver=new MutationObserver(()=>{if(!app.hidden){injectNav();loadAccesses(true).then(()=>{if(activeRoute())renderAccesses();decorateClientCards();});}});appObserver.observe(app,{attributes:true,attributeFilter:['hidden']});}
  const content=$('#content');if(content&&!contentObserver){contentObserver=new MutationObserver(()=>{if(location.hash==='#clients')decorateClientCards();});contentObserver.observe(content,{childList:true});}
}

function bootstrap(){ensureObservers();injectNav();if(!$('#app-view')?.hidden)loadAccesses(true).then(()=>{if(activeRoute())renderAccesses();decorateClientCards();});}

document.addEventListener('click',handleRefreshCapture,true);
document.addEventListener('click',handleClick);
document.addEventListener('input',handleInput);
document.addEventListener('submit',handleSubmit);
window.addEventListener('hashchange',()=>{injectNav();if(activeRoute())renderAccesses({force:true});else if(location.hash==='#clients'){loadAccesses().then(decorateClientCards);}});
window.addEventListener('DOMContentLoaded',bootstrap);
})();
