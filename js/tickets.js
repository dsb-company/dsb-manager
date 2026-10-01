/* DSB Manager · Chamados com Realtime, não lidos e notificações */
(() => {
'use strict';

const $=(s,b=document)=>b.querySelector(s);
const $$=(s,b=document)=>[...b.querySelectorAll(s)];
const STATUS=['Novo','Aberto','Em atendimento','Aguardando cliente','Resolvido','Fechado'];
const PRIORITIES=['Baixa','Normal','Alta'];
const CATEGORIES=['Site','Hospedagem','Domínio','E-mail','Alteração','Bug','Outro'];
const MAX_FILE_SIZE=10*1024*1024;
const ALLOWED_MIME=new Set(['image/png','image/jpeg','image/webp','application/pdf','text/plain']);
const state={tickets:[],messages:[],attachments:[],unread:new Map(),ready:null,error:'',loading:false,selected:null,filter:'Todos',query:'',poll:null,realtime:null,lastLoaded:0,unreadSupported:true};
let navObserver=null,appObserver=null;

function ctx(){return window.DSB_MANAGER_CONTEXT||null;}
function client(){return ctx()?.getClient?.()||null;}
function E(value){return ctx()?.escape?.(String(value??''))??String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function icon(name,size=18){return ctx()?.icon?.(name,size)||'';}
function toast(message,error=false){ctx()?.toast?.(message,error);}
function friendly(error){return ctx()?.friendly?.(error)||(error?.message||String(error));}
function managerClients(){return ctx()?.getClients?.()||[];}
function members(){return ctx()?.getMembers?.()||[];}
async function reloadManager(){return ctx()?.reloadManager?.();}
function profiles(){return window.DSB_PROFILE||null;}

function ticketNumber(ticket){return `DSB-${String(ticket.ticket_number||0).padStart(5,'0')}`;}
function companyName(clientId){return managerClients().find(r=>r.id===clientId)?.data?.name||'Cliente não encontrado';}
function memberName(userId){return members().find(m=>m.user_id===userId)?.name||'Não atribuído';}
function initials(value){return String(value||'DSB').trim().split(/\s+/).slice(0,2).map(v=>v[0]||'').join('').toUpperCase();}
function avatarMarkup(userId,name,className='avatar'){return profiles()?.avatarMarkup?.(userId,name,className)||`<span class="${E(className)}">${E(initials(name))}</span>`;}
function safeHttpUrl(value){try{const u=new URL(String(value||''));return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return'';}}
function dateTime(value){if(!value)return'—';const d=new Date(value);if(Number.isNaN(d.getTime()))return'—';return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);}
function shortDate(value){if(!value)return'—';const d=new Date(value);if(Number.isNaN(d.getTime()))return'—';return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(d);}
function statusClass(value){return value==='Novo'?'new':value==='Em atendimento'?'working':value==='Aguardando cliente'?'waiting':['Resolvido','Fechado'].includes(value)?'done':'open';}
function priorityClass(value){return value==='Alta'?'high':value==='Baixa'?'low':'normal';}
function statusPill(value){return `<span class="ticket-pill status-${statusClass(value)}">${E(value)}</span>`;}
function priorityPill(value){return `<span class="ticket-pill priority-${priorityClass(value)}">${E(value)}</span>`;}
function openCount(){return state.tickets.filter(t=>t.status==='Novo').length;}
function unreadCount(ticketId){return Number(state.unread.get(ticketId)||0);}
function totalUnread(){return [...state.unread.values()].reduce((sum,n)=>sum+Number(n||0),0);}
function navCount(){return state.unreadSupported?totalUnread():openCount();}
function activeRoute(){return location.hash==='#tickets';}
function chatIsOpen(ticketId){return activeRoute()&&state.selected===ticketId&&!$('#app-view')?.hidden&&!document.hidden;}
function isMissingSchema(error){const text=`${error?.code||''} ${error?.message||''} ${error?.details||''}`;return /42P01|PGRST205|dsb_tickets|schema cache|does not exist|relation .* does not exist/i.test(text);}

async function loadUnread(){
  const c=client();if(!c)return;
  try{
    const {data,error}=await c.rpc('dsb_ticket_unread_summary');
    if(error)throw error;
    state.unread=new Map((data||[]).map(r=>[r.ticket_id,Number(r.unread_count)||0]));state.unreadSupported=true;
  }catch(error){
    if(/dsb_ticket_unread_summary|PGRST202|does not exist|schema cache/i.test(String(error?.message||error))){state.unreadSupported=false;state.unread=new Map();}
    else throw error;
  }
}
async function loadTickets(force=false){
  const c=client();if(!c||state.loading)return;
  if(!force&&Date.now()-state.lastLoaded<3500)return;
  state.loading=true;
  try{
    const [{data,error}]=await Promise.all([c.from('dsb_tickets').select('*').order('last_activity_at',{ascending:false}).order('ticket_number',{ascending:false}),loadUnread().catch(()=>{})]);
    if(error)throw error;
    state.tickets=data||[];state.ready=true;state.error='';state.lastLoaded=Date.now();
  }catch(error){if(isMissingSchema(error)){state.ready=false;state.error='';}else state.error=friendly(error);}
  finally{state.loading=false;injectNav();}
}
async function loadTicketDetails(ticketId){
  const c=client();if(!c)return;
  const [{data:messages,error:messageError},{data:attachments,error:attachmentError}]=await Promise.all([
    c.from('dsb_ticket_messages').select('*').eq('ticket_id',ticketId).order('created_at',{ascending:true}),
    c.from('dsb_ticket_attachments').select('*').eq('ticket_id',ticketId).order('created_at',{ascending:true}),
    profiles()?.loadTicketProfiles?.(ticketId)
  ]);
  if(messageError)throw messageError;if(attachmentError)throw attachmentError;
  state.messages=messages||[];state.attachments=attachments||[];
}
async function markRead(ticketId){
  if(!ticketId||!client()||!state.unreadSupported)return;
  try{const {error}=await client().rpc('dsb_mark_ticket_read',{p_ticket_id:ticketId});if(error)throw error;state.unread.set(ticketId,0);injectNav();updateUnreadIndicators();}
  catch(error){if(/dsb_mark_ticket_read|PGRST202|does not exist/i.test(String(error?.message||error)))state.unreadSupported=false;}
}

function navButton(){
  const count=navCount();
  const svg='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v12H7l-3 3V4Z"/><path d="M8 8h8M8 12h5"/></svg>';
  const b=document.createElement('button');
  b.className='nav-item dsb-ticket-nav'+(activeRoute()?' active':'');
  b.dataset.ticketsNav='true';
  if(activeRoute())b.setAttribute('aria-current','page');
  b.innerHTML=`${svg}<span>Chamados</span><span class="nav-count" data-ticket-unread-badge ${count?'':'hidden'}>${count||''}</span>`;
  return b;
}
function syncNavBadge(){
  const count=navCount();
  const buttons=document.querySelectorAll('[data-tickets-nav]');
  buttons.forEach(button=>{
    let badge=button.querySelector('[data-ticket-unread-badge]');
    if(!badge){
      badge=document.createElement('span');
      badge.className='nav-count';
      badge.dataset.ticketUnreadBadge='true';
      button.appendChild(badge);
    }
    badge.textContent=count?String(count):'';
    badge.hidden=count===0;
  });
}
function injectNav(){
  const nav=$('#main-nav');if(!nav||$('#app-view')?.hidden)return;
  if(activeRoute())nav.querySelectorAll('[data-nav].active').forEach(item=>{item.classList.remove('active');item.removeAttribute('aria-current');});
  let existing=nav.querySelector('[data-tickets-nav]');
  if(!existing){
    existing=navButton();
    const tasks=nav.querySelector('[data-nav="tasks"]');
    if(tasks)tasks.after(existing);else nav.append(existing);
  }
  existing.classList.toggle('active',activeRoute());
  if(activeRoute())existing.setAttribute('aria-current','page');else existing.removeAttribute('aria-current');
  syncNavBadge();
}
function setBreadcrumb(){const el=$('#breadcrumb');if(el)el.textContent='Chamados';}
function showLoading(){const content=$('#content');if(content)content.innerHTML='<div class="ticket-loading"><span></span><p>Carregando chamados...</p></div>';setBreadcrumb();}
function setupPanel(){return `<div class="page-heading"><div><h1>Chamados</h1><p>Central de suporte e atendimento aos clientes.</p></div></div><section class="panel ticket-setup-panel"><div class="ticket-setup-icon">${icon('lock',22)}</div><div><h2>Módulo pronto para ser conectado</h2><p>Execute <strong>supabase/chamados.sql</strong> e depois <strong>supabase/realtime-perfis.sql</strong> no mesmo projeto Supabase.</p><p class="field-note">O restante do DSB Manager continua funcionando normalmente enquanto esta etapa não é concluída.</p></div></section>`;}
function summaryCard(title,value,subtitle,kind){return `<section class="ticket-summary-card ${kind}"><span>${E(title)}</span><strong>${E(String(value).padStart(2,'0'))}</strong><small>${E(subtitle)}</small></section>`;}
function filteredTickets(){const q=state.query.trim().toLocaleLowerCase('pt-BR');return state.tickets.filter(t=>{const statusOk=state.filter==='Todos'||t.status===state.filter;const text=[ticketNumber(t),companyName(t.client_id),t.subject,t.category,t.priority,t.requester_name,t.requester_email,memberName(t.assigned_to)].join(' ').toLocaleLowerCase('pt-BR');return statusOk&&(!q||text.includes(q));});}
function newMessageBadge(ticketId){const count=unreadCount(ticketId);return count?`<span class="ticket-new-message">Nova mensagem${count>1?` · ${count}`:''}</span>`:'';}
function ticketTable(list){
  if(!list.length)return `<div class="ticket-empty">${icon('projects',30)}<strong>Nenhum chamado encontrado.</strong><span>Altere os filtros ou abra um novo chamado para começar.</span></div>`;
  return `<div class="table-wrap ticket-table-wrap"><table class="ticket-table"><thead><tr><th>CHAMADO / EMPRESA</th><th>CATEGORIA</th><th>PRIORIDADE</th><th>STATUS</th><th>RESPONSÁVEL</th><th>ATUALIZADO</th><th></th></tr></thead><tbody>${list.map(t=>`<tr class="ticket-row ${unreadCount(t.id)?'has-unread':''}" data-ticket-open="${E(t.id)}" tabindex="0" role="button" aria-label="Abrir chamado ${E(ticketNumber(t))}"><td><div class="ticket-main-cell"><div class="ticket-code-line"><span class="ticket-number">#${E(ticketNumber(t))}</span>${newMessageBadge(t.id)}</div><strong>${E(t.subject)}</strong><small>${E(companyName(t.client_id))}</small></div></td><td>${E(t.category)}</td><td>${priorityPill(t.priority)}</td><td>${statusPill(t.status)}</td><td><div class="ticket-owner">${avatarMarkup(t.assigned_to,memberName(t.assigned_to),'avatar')}<span>${E(memberName(t.assigned_to))}</span></div></td><td>${E(shortDate(t.last_activity_at||t.updated_at))}</td><td><span class="ticket-open-arrow">→</span></td></tr>`).join('')}</tbody></table></div>`;
}
function listPage(){const list=filteredTickets(),active=state.tickets.filter(t=>!['Resolvido','Fechado'].includes(t.status)).length,waiting=state.tickets.filter(t=>t.status==='Aguardando cliente').length,resolved=state.tickets.filter(t=>t.status==='Resolvido').length;return `<div class="page-heading"><div><h1>Chamados</h1><p>Central de suporte e atendimento aos clientes.</p></div><div class="heading-actions"><button class="button primary" data-ticket-new>${icon('plus',16)}Novo chamado</button></div></div><div class="ticket-summary-grid">${summaryCard('Não lidas',totalUnread(),'Novas mensagens','new')}${summaryCard('Em aberto',active,'Chamados ativos','active')}${summaryCard('Aguardando cliente',waiting,'Dependem de retorno','waiting')}${summaryCard('Resolvidos',resolved,'Prontos para fechar','resolved')}</div><div class="toolbar ticket-toolbar"><div class="filter-tabs ticket-filter-tabs">${['Todos',...STATUS].map(f=>`<button class="filter-tab ${state.filter===f?'active':''}" data-ticket-filter="${E(f)}">${E(f)}</button>`).join('')}</div><input class="filter-input" id="ticket-search" type="search" value="${E(state.query)}" placeholder="Buscar chamado, empresa..." aria-label="Buscar chamado"></div>${state.error?`<div class="error-panel">${E(state.error)} <button class="text-button" data-ticket-refresh>Tentar novamente</button></div>`:''}<section class="panel ticket-list-panel"><div class="ticket-list-head"><div><h2 class="panel-title">Fila de atendimento</h2><p class="panel-subtitle">${list.length} de ${state.tickets.length} chamados</p></div><button class="icon-button" data-ticket-refresh aria-label="Atualizar chamados">${icon('refresh',17)}</button></div>${ticketTable(list)}</section>`;}

function attachmentForMessage(messageId){return state.attachments.filter(a=>a.message_id===messageId);}
function messageBubble(message){const staff=message.author_kind==='staff',files=attachmentForMessage(message.id);return `<article class="ticket-message ${staff?'staff':'client'}" data-message-id="${E(message.id)}"><div class="ticket-message-meta">${avatarMarkup(message.author_user_id,message.author_name,'avatar')}<div><strong>${E(message.author_name||(staff?'Equipe DSB':'Cliente'))}</strong><small>${staff?'Equipe DSB':'Cliente'} · ${E(dateTime(message.created_at))}</small></div></div><div class="ticket-message-body">${E(message.body).replace(/\n/g,'<br>')}</div>${files.length?`<div class="ticket-attachments">${files.map(a=>`<button type="button" class="ticket-attachment" data-ticket-file="${E(a.storage_path)}">${icon('download',14)}<span>${E(a.file_name)}</span><small>${E(formatSize(a.file_size))}</small></button>`).join('')}</div>`:''}</article>`;}
function formatSize(bytes){const n=Number(bytes)||0;if(n<1024)return`${n} B`;if(n<1024*1024)return`${(n/1024).toFixed(1)} KB`;return`${(n/1024/1024).toFixed(1)} MB`;}
function detailPage(ticket){const clientRecord=managerClients().find(r=>r.id===ticket.client_id)?.data||{};return `<div class="ticket-detail-heading"><button class="button secondary" data-ticket-back>← Voltar aos chamados</button><div class="ticket-detail-title"><div><span class="ticket-number">#${E(ticketNumber(ticket))}</span><h1>${E(ticket.subject)}</h1><p>${E(companyName(ticket.client_id))} · aberto em ${E(dateTime(ticket.created_at))}</p></div><div class="ticket-heading-pills" id="ticket-heading-pills">${priorityPill(ticket.priority)}${statusPill(ticket.status)}</div></div></div><div class="ticket-detail-layout"><section class="panel ticket-conversation-panel"><div class="ticket-conversation-head"><div><h2 class="panel-title">Conversa</h2><p class="panel-subtitle">Atualização em tempo real</p></div><span id="ticket-message-count">${state.messages.length} mensagens</span></div><div class="ticket-messages" id="ticket-messages">${state.messages.length?state.messages.map(messageBubble).join(''):'<div class="ticket-empty"><strong>Nenhuma mensagem ainda.</strong></div>'}</div><form id="ticket-reply-form" class="ticket-reply-form"><label for="ticket-reply">Responder ao cliente</label><textarea id="ticket-reply" name="body" maxlength="5000" required placeholder="Digite sua resposta..."></textarea><div class="ticket-reply-actions"><label class="ticket-file-picker">${icon('download',15)}Anexar arquivo<input id="ticket-files" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf,text/plain"></label><span id="ticket-file-label" class="field-note">PNG, JPG, WEBP, PDF ou TXT · até 10 MB por arquivo</span><button class="button primary" type="submit">Enviar resposta →</button></div><p class="form-error" id="ticket-reply-error" role="alert"></p></form></section><aside class="ticket-side"><section class="panel ticket-info-panel"><h2>Atendimento</h2><label for="ticket-status">Status</label><select id="ticket-status" data-ticket-status="${E(ticket.id)}">${STATUS.map(s=>`<option value="${E(s)}" ${s===ticket.status?'selected':''}>${E(s)}</option>`).join('')}</select><label for="ticket-priority">Prioridade</label><select id="ticket-priority" data-ticket-priority="${E(ticket.id)}">${PRIORITIES.map(s=>`<option value="${E(s)}" ${s===ticket.priority?'selected':''}>${E(s)}</option>`).join('')}</select><label for="ticket-owner">Responsável</label><select id="ticket-owner" data-ticket-owner="${E(ticket.id)}"><option value="">Não atribuído</option>${members().map(m=>`<option value="${E(m.user_id)}" ${m.user_id===ticket.assigned_to?'selected':''}>${E(m.name)}</option>`).join('')}</select></section><section class="panel ticket-info-panel"><h2>Solicitação</h2><dl class="ticket-dl"><div><dt>Empresa</dt><dd>${E(companyName(ticket.client_id))}</dd></div><div><dt>Solicitante</dt><dd>${E(ticket.requester_name||clientRecord.contact||'Não informado')}</dd></div><div><dt>E-mail</dt><dd>${E(ticket.requester_email||clientRecord.email||'Não informado')}</dd></div><div><dt>Categoria</dt><dd>${E(ticket.category)}</dd></div><div><dt>Página</dt><dd>${safeHttpUrl(ticket.page_url)?`<a href="${E(safeHttpUrl(ticket.page_url))}" target="_blank" rel="noopener noreferrer">${E(ticket.page_url)}</a>`:'Não informada'}</dd></div><div><dt>Última atividade</dt><dd id="ticket-last-activity">${E(dateTime(ticket.last_activity_at))}</dd></div></dl></section></aside></div>`;}
function scrollMessages(behavior='auto'){const el=$('#ticket-messages');if(!el)return;requestAnimationFrame(()=>el.scrollTo({top:el.scrollHeight,behavior}));}
function renderMessageList(behavior='smooth'){const el=$('#ticket-messages');if(!el)return;el.innerHTML=state.messages.length?state.messages.map(messageBubble).join(''):'<div class="ticket-empty"><strong>Nenhuma mensagem ainda.</strong></div>';const count=$('#ticket-message-count');if(count)count.textContent=`${state.messages.length} mensagens`;scrollMessages(behavior);}
function updateUnreadIndicators(){if(activeRoute()&&!state.selected){const content=$('#content');if(content)content.innerHTML=listPage();setBreadcrumb();}injectNav();syncNavBadge();}
function syncSelectedTicketUI(ticket){if(!ticket||state.selected!==ticket.id||!activeRoute())return;const pills=$('#ticket-heading-pills');if(pills)pills.innerHTML=priorityPill(ticket.priority)+statusPill(ticket.status);const status=$('#ticket-status');if(status&&status.value!==ticket.status)status.value=ticket.status;const priority=$('#ticket-priority');if(priority&&priority.value!==ticket.priority)priority.value=ticket.priority;const owner=$('#ticket-owner');if(owner&&(owner.value||null)!==(ticket.assigned_to||null))owner.value=ticket.assigned_to||'';const activity=$('#ticket-last-activity');if(activity)activity.textContent=dateTime(ticket.last_activity_at);}

async function renderTickets({force=false}={}){const content=$('#content');if(!content||$('#app-view')?.hidden)return;setBreadcrumb();injectNav();if(state.ready===null&&!state.loading)showLoading();await loadTickets(force);if(!activeRoute())return;if(state.ready===false){content.innerHTML=setupPanel();return;}if(state.selected){const ticket=state.tickets.find(t=>t.id===state.selected);if(!ticket){state.selected=null;content.innerHTML=listPage();return;}try{await loadTicketDetails(ticket.id);content.innerHTML=detailPage(ticket);await markRead(ticket.id);scrollMessages('auto');}catch(error){content.innerHTML=`<div class="error-panel">${E(friendly(error))} <button class="text-button" data-ticket-back>Voltar</button></div>`;}}else content.innerHTML=listPage();setBreadcrumb();injectNav();}
function openTickets(){state.selected=null;state.filter='Todos';state.query='';history.replaceState(null,'','#tickets');renderTickets({force:true});}
function showModal(title,html){const modal=$('#modal'),body=$('#modal-content');if(!modal||!body)return;body.innerHTML=`<div class="modal-head"><h2>${E(title)}</h2><button class="icon-button" data-action="close" aria-label="Fechar">${icon('close')}</button></div><div class="modal-body">${html}</div>`;if(!modal.open)modal.showModal();}
function newTicketModal(){const clients=managerClients();if(!clients.length){toast('Cadastre pelo menos um cliente antes de abrir um chamado.',true);return;}const options=clients.map(r=>`<option value="${E(r.id)}">${E(r.data.name)}</option>`).join('');showModal('Novo chamado',`<form id="ticket-new-form"><div class="form-grid"><div class="span-2"><label for="ticket-client">Empresa / cliente</label><select id="ticket-client" name="client_id" required>${options}</select></div><div><label for="ticket-requester">Solicitante</label><input id="ticket-requester" name="requester_name" maxlength="120" placeholder="Nome do contato"></div><div><label for="ticket-requester-email">E-mail do solicitante</label><input id="ticket-requester-email" name="requester_email" type="email" maxlength="254" placeholder="contato@empresa.com"></div><div class="span-2"><label for="ticket-subject">Assunto</label><input id="ticket-subject" name="subject" required minlength="3" maxlength="180" placeholder="Ex.: Botão de agendamento não funciona"></div><div><label for="ticket-category">Categoria</label><select id="ticket-category" name="category">${CATEGORIES.map(x=>`<option>${E(x)}</option>`).join('')}</select></div><div><label for="ticket-priority-new">Prioridade</label><select id="ticket-priority-new" name="priority">${PRIORITIES.map(x=>`<option ${x==='Normal'?'selected':''}>${E(x)}</option>`).join('')}</select></div><div class="span-2"><label for="ticket-page-url">Página relacionada</label><input id="ticket-page-url" name="page_url" type="url" maxlength="1000" placeholder="https://cliente.com/pagina"></div><div class="span-2"><label for="ticket-description">Descrição</label><textarea id="ticket-description" name="description" required minlength="3" maxlength="5000" placeholder="Descreva o chamado com o máximo de contexto possível..."></textarea></div></div><p class="form-error" id="ticket-new-error" role="alert"></p><div class="form-actions"><button type="button" class="button secondary" data-action="close">Cancelar</button><button type="submit" class="button primary">Criar chamado</button></div></form>`);prefillRequester();}
function prefillRequester(){const selectEl=$('#ticket-client');if(!selectEl)return;const record=managerClients().find(r=>r.id===selectEl.value)?.data||{};const n=$('#ticket-requester'),e=$('#ticket-requester-email');if(n)n.value=record.contact||'';if(e)e.value=record.email||'';}
async function createTicket(form){const c=client();if(!c)throw Error('Sessão indisponível. Entre novamente.');const values=Object.fromEntries(new FormData(form)),subject=values.subject.trim(),description=values.description.trim();if(subject.length<3||description.length<3)throw Error('Informe o assunto e a descrição do chamado.');const pageUrl=values.page_url.trim();if(pageUrl&&!safeHttpUrl(pageUrl))throw Error('A página relacionada precisa usar http:// ou https://.');const payload={client_id:values.client_id,subject,category:CATEGORIES.includes(values.category)?values.category:'Outro',priority:PRIORITIES.includes(values.priority)?values.priority:'Normal',requester_name:values.requester_name.trim()||null,requester_email:values.requester_email.trim().toLowerCase()||null,page_url:pageUrl||null,status:'Novo'};const {data:ticket,error}=await c.from('dsb_tickets').insert(payload).select('*').single();if(error)throw error;const {error:messageError}=await c.from('dsb_ticket_messages').insert({ticket_id:ticket.id,body:description});if(messageError)throw messageError;await loadTickets(true);return ticket;}
async function updateTicket(ticketId,changes){const c=client();if(!c)throw Error('Sessão indisponível.');const {data,error}=await c.from('dsb_tickets').update(changes).eq('id',ticketId).select('*').single();if(error)throw error;patchTicket(data);return data;}
function validateFiles(files){for(const file of files){if(file.size>MAX_FILE_SIZE)throw Error(`${file.name}: o limite é de 10 MB.`);if(!ALLOWED_MIME.has(file.type))throw Error(`${file.name}: formato não permitido.`);}}
function safeFileName(name){return String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120)||'arquivo';}
async function sendReply(form){const ticket=state.tickets.find(t=>t.id===state.selected);if(!ticket)throw Error('Chamado não encontrado.');const body=String(new FormData(form).get('body')||'').trim();if(!body)throw Error('Digite uma resposta.');const files=[...($('#ticket-files')?.files||[])];validateFiles(files);const c=client(),messageId=crypto.randomUUID();const {data:message,error}=await c.from('dsb_ticket_messages').insert({id:messageId,ticket_id:ticket.id,body}).select('*').single();if(error)throw error;upsertMessage(message);renderMessageList('smooth');for(const file of files){const path=`${ticket.id}/${messageId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;const {error:uploadError}=await c.storage.from('dsb-ticket-attachments').upload(path,file,{contentType:file.type,upsert:false});if(uploadError){toast(`A resposta foi enviada, mas o anexo ${file.name} não pôde ser salvo.`,true);continue;}const {data:meta,error:metaError}=await c.from('dsb_ticket_attachments').insert({ticket_id:ticket.id,message_id:messageId,storage_path:path,file_name:file.name,mime_type:file.type,file_size:file.size}).select('*').single();if(metaError){await c.storage.from('dsb-ticket-attachments').remove([path]);toast(`O anexo ${file.name} não pôde ser registrado.`,true);}else if(meta)upsertAttachment(meta);}await loadTickets(true);}
async function openAttachment(path){const c=client();const {data,error}=await c.storage.from('dsb-ticket-attachments').createSignedUrl(path,60);if(error)throw error;if(!data?.signedUrl)throw Error('Não foi possível abrir o anexo.');window.open(data.signedUrl,'_blank','noopener,noreferrer');}

function patchTicket(ticket){if(!ticket?.id)return;const i=state.tickets.findIndex(t=>t.id===ticket.id);if(i>=0)state.tickets[i]={...state.tickets[i],...ticket};else state.tickets.unshift(ticket);state.tickets.sort((a,b)=>new Date(b.last_activity_at||b.updated_at)-new Date(a.last_activity_at||a.updated_at));state.lastLoaded=Date.now();syncSelectedTicketUI(state.tickets.find(t=>t.id===ticket.id));injectNav();}
function upsertMessage(message){if(!message?.id)return false;if(state.messages.some(m=>m.id===message.id))return false;state.messages.push(message);state.messages.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));return true;}
function upsertAttachment(attachment){if(!attachment?.id)return false;const i=state.attachments.findIndex(a=>a.id===attachment.id);if(i>=0)state.attachments[i]=attachment;else state.attachments.push(attachment);return true;}
async function notifyIncomingMessage(message){const ticket=state.tickets.find(t=>t.id===message.ticket_id);if(!ticket)return;profiles()?.playMessageSound?.();await profiles()?.showWindowsNotification?.({title:`${ticketNumber(ticket)} · ${companyName(ticket.client_id)}`,body:`${message.author_name}: ${String(message.body||'Nova mensagem').slice(0,120)}`,ticketId:ticket.id});}
async function handleRealtimeMessage(payload){
  const message=payload.new;if(!message?.id)return;
  let reloaded=false;
  if(!state.tickets.some(t=>t.id===message.ticket_id)){await loadTickets(true);reloaded=true;}
  if(chatIsOpen(message.ticket_id)){
    const added=upsertMessage(message);
    if(added){await profiles()?.loadTicketProfiles?.(message.ticket_id);renderMessageList('smooth');}
    if(message.author_kind==='client')await markRead(message.ticket_id);
  }else if(message.author_kind==='client'){
    // Incrementa imediatamente o não-lido no Manager.
    // O RPC loadUnread() continua sendo usado ao carregar/recarregar a aplicação.
    if(!reloaded)state.unread.set(message.ticket_id,unreadCount(message.ticket_id)+1);
    injectNav();
    syncNavBadge();
    updateUnreadIndicators();
    await notifyIncomingMessage(message);
  }
}
function handleRealtimeAttachment(payload){const a=payload.new;if(!a?.id||!chatIsOpen(a.ticket_id))return;if(upsertAttachment(a))renderMessageList('auto');}
function handleRealtimeTicket(payload){if(payload.eventType==='DELETE'){const id=payload.old?.id;state.tickets=state.tickets.filter(t=>t.id!==id);state.unread.delete(id);if(state.selected===id)state.selected=null;}else patchTicket(payload.new);if(activeRoute()&&!state.selected){const content=$('#content');if(content)content.innerHTML=listPage();setBreadcrumb();}injectNav();}
function startRealtime(){const c=client();if(!c||state.realtime)return;const uid=ctx()?.getUser?.()?.id||'session';state.realtime=c.channel(`dsb-manager-realtime-${uid}`).on('postgres_changes',{event:'*',schema:'public',table:'dsb_tickets'},handleRealtimeTicket).on('postgres_changes',{event:'INSERT',schema:'public',table:'dsb_ticket_messages'},payload=>{handleRealtimeMessage(payload).catch(()=>{});}).on('postgres_changes',{event:'INSERT',schema:'public',table:'dsb_ticket_attachments'},handleRealtimeAttachment).subscribe();}
function stopRealtime(){const c=client();if(state.realtime&&c)c.removeChannel(state.realtime);state.realtime=null;}

async function handleSubmit(event){const form=event.target;if(form.id==='ticket-new-form'){event.preventDefault();const button=form.querySelector('button[type="submit"]'),errorEl=$('#ticket-new-error');button.disabled=true;errorEl.textContent='';try{const ticket=await createTicket(form);$('#modal').close();state.selected=ticket.id;history.replaceState(null,'','#tickets');await renderTickets({force:true});toast('Chamado criado com sucesso.');}catch(error){errorEl.textContent=friendly(error);}finally{if(button.isConnected)button.disabled=false;}}if(form.id==='ticket-reply-form'){event.preventDefault();const button=form.querySelector('button[type="submit"]'),errorEl=$('#ticket-reply-error');button.disabled=true;errorEl.textContent='';try{await sendReply(form);form.reset();$('#ticket-file-label').textContent='PNG, JPG, WEBP, PDF ou TXT · até 10 MB por arquivo';toast('Resposta enviada.');scrollMessages('smooth');}catch(error){errorEl.textContent=friendly(error);}finally{if(button.isConnected)button.disabled=false;}}}
async function handleChange(event){const el=event.target;try{if(el.id==='ticket-client'){prefillRequester();return;}if(el.id==='ticket-files'){const files=[...(el.files||[])];$('#ticket-file-label').textContent=files.length?files.map(f=>f.name).join(', '):'PNG, JPG, WEBP, PDF ou TXT · até 10 MB por arquivo';return;}if(el.dataset.ticketStatus){await updateTicket(el.dataset.ticketStatus,{status:el.value});toast('Status atualizado.');}if(el.dataset.ticketPriority){await updateTicket(el.dataset.ticketPriority,{priority:el.value});toast('Prioridade atualizada.');}if(el.dataset.ticketOwner){await updateTicket(el.dataset.ticketOwner,{assigned_to:el.value||null});toast('Responsável atualizado.');}}catch(error){toast(friendly(error),true);await renderTickets({force:true});}}
function handleInput(event){if(event.target.id==='ticket-search'){const pos=event.target.selectionStart;state.query=event.target.value;const content=$('#content');if(content)content.innerHTML=listPage();setBreadcrumb();const field=$('#ticket-search');field?.focus();try{field?.setSelectionRange(pos,pos)}catch{}}}
async function handleRefreshCapture(event){const b=event.target.closest?.('#refresh');if(!b||!activeRoute())return;event.preventDefault();event.stopImmediatePropagation();b.disabled=true;try{await reloadManager();await profiles()?.refreshMemberAvatars?.();await renderTickets({force:true});}catch(error){toast(friendly(error),true);}finally{b.disabled=false;}}
async function handleClick(event){const b=event.target.closest('button,[data-ticket-open]');if(!b)return;if(b.dataset.ticketsNav){event.preventDefault();openTickets();return;}if(!activeRoute())return;if(b.dataset.ticketNew!==undefined){newTicketModal();return;}if(b.dataset.ticketBack!==undefined){state.selected=null;state.messages=[];state.attachments=[];renderTickets();return;}if(b.dataset.ticketRefresh!==undefined){renderTickets({force:true});return;}if(b.dataset.ticketFilter){state.filter=b.dataset.ticketFilter;const content=$('#content');if(content)content.innerHTML=listPage();setBreadcrumb();return;}if(b.dataset.ticketOpen){state.selected=b.dataset.ticketOpen;showLoading();await renderTickets();return;}if(b.dataset.ticketFile){try{await openAttachment(b.dataset.ticketFile);}catch(error){toast(friendly(error),true);}return;}}
function handleKeydown(event){const row=event.target.closest?.('[data-ticket-open]');if(row&&activeRoute()&&(event.key==='Enter'||event.key===' ')){event.preventDefault();state.selected=row.dataset.ticketOpen;renderTickets();}}
function ensureObservers(){const nav=$('#main-nav');if(nav&&!navObserver){navObserver=new MutationObserver(()=>injectNav());navObserver.observe(nav,{childList:true});}const app=$('#app-view');if(app&&!appObserver){appObserver=new MutationObserver(()=>{if(!app.hidden){injectNav();loadTickets(true).then(()=>{injectNav();if(activeRoute())renderTickets();});startRealtime();startPolling();}else{stopRealtime();stopPolling();}});appObserver.observe(app,{attributes:true,attributeFilter:['hidden']});}}
function startPolling(){if(state.poll)return;state.poll=setInterval(async()=>{if($('#app-view')?.hidden)return;await loadTickets(true);if(activeRoute()&&!state.selected){const content=$('#content');if(content)content.innerHTML=listPage();setBreadcrumb();}else injectNav();},60000);}
function stopPolling(){if(state.poll){clearInterval(state.poll);state.poll=null;}}
function bootstrap(){ensureObservers();injectNav();if(!$('#app-view')?.hidden){loadTickets(true).then(()=>{injectNav();if(activeRoute())renderTickets();});startRealtime();startPolling();}}

document.addEventListener('click',handleRefreshCapture,true);
document.addEventListener('click',handleClick);
document.addEventListener('change',handleChange);
document.addEventListener('input',handleInput);
document.addEventListener('submit',handleSubmit);
document.addEventListener('keydown',handleKeydown);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.selected&&chatIsOpen(state.selected))markRead(state.selected);});
window.addEventListener('hashchange',()=>{injectNav();if(activeRoute())renderTickets({force:true});});
window.addEventListener('DOMContentLoaded',bootstrap);
})();
