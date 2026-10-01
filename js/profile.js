/* DSB Manager · Fotos de perfil + preferências locais de notificações */
(() => {
'use strict';
const $=(s,b=document)=>b.querySelector(s), $$=(s,b=document)=>[...b.querySelectorAll(s)];
const E=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const AVATAR_BUCKET='dsb-avatars';
const NOTIFY_KEY='dsb.tickets.windowsNotifications';
const SOUND_KEY='dsb.tickets.sound';
const SOUND_PREF_KEY='dsb.tickets.soundPreference';
const SOUND_OPTIONS={
  none:{label:'Sem som',src:''},
  suave:{label:'DSB Suave',src:'assets/notification/universfield.mp3'},
  pop:{label:'DSB Pop',src:'assets/notification/notification-038.mp3'},
  alerta:{label:'DSB Alerta',src:'assets/notification/notification-024.mp3'}
};
const avatarUrls=new Map();
const pathUrls=new Map();
let crop=null,observer=null,busy=false,refreshingAvatars=false,audioUnlocked=false;
const soundPlayers=new Map();

function ctx(){return window.DSB_MANAGER_CONTEXT||null;}
function client(){return ctx()?.getClient?.()||null;}
function user(){return ctx()?.getUser?.()||null;}
function member(){return ctx()?.getMember?.()||null;}
function members(){return ctx()?.getMembers?.()||[];}
function toast(msg,error=false){ctx()?.toast?.(msg,error);}
function initials(value){return String(value||'DSB').trim().split(/\s+/).slice(0,2).map(v=>v[0]||'').join('').toUpperCase()||'DS';}
function notificationsEnabled(){return localStorage.getItem(NOTIFY_KEY)==='true'&&'Notification'in window&&Notification.permission==='granted';}
function soundPreference(){
  const fromDb=String(member()?.notification_sound||'').toLowerCase();
  if(SOUND_OPTIONS[fromDb])return fromDb;
  const saved=String(localStorage.getItem(SOUND_PREF_KEY)||'').toLowerCase();
  if(SOUND_OPTIONS[saved])return saved;
  if(localStorage.getItem(SOUND_KEY)==='false')return'none';
  return'suave';
}
function soundEnabled(){return soundPreference()!=='none';}
function soundOptionsMarkup(selected=soundPreference()){return Object.entries(SOUND_OPTIONS).map(([value,item])=>`<option value="${E(value)}"${value===selected?' selected':''}>${E(item.label)}</option>`).join('');}
function getSoundPlayer(pref=soundPreference()){
  const item=SOUND_OPTIONS[pref];if(!item?.src)return null;
  let audio=soundPlayers.get(pref);
  if(!audio){audio=new Audio(item.src);audio.preload='auto';audio.volume=.34;soundPlayers.set(pref,audio);}
  return audio;
}
async function saveSoundPreference(value){
  value=String(value||'').toLowerCase();if(!SOUND_OPTIONS[value])value='suave';
  localStorage.setItem(SOUND_PREF_KEY,value);localStorage.setItem(SOUND_KEY,value==='none'?'false':'true');
  const me=member();if(me)me.notification_sound=value;
  const c=client();if(c){const {error}=await c.rpc('dsb_set_my_notification_sound',{p_sound:value});if(error){if(/does not exist|schema cache|PGRST202/i.test(String(error.message||error))){toast('Som salvo neste dispositivo. Execute supabase/sound-preferences.sql para sincronizar entre dispositivos.',true);}else throw error;}}
  return value;
}

async function signedUrl(path){
  if(!path)return'';
  if(pathUrls.has(path))return pathUrls.get(path);
  const c=client();if(!c)return'';
  const {data,error}=await c.storage.from(AVATAR_BUCKET).createSignedUrl(path,43200);
  if(error||!data?.signedUrl)return'';
  pathUrls.set(path,data.signedUrl);return data.signedUrl;
}
async function refreshMemberAvatars(){
  if(refreshingAvatars)return;refreshingAvatars=true;try{const list=members();
  await Promise.all(list.map(async m=>{if(m.avatar_path){const url=await signedUrl(m.avatar_path);if(url)avatarUrls.set(m.user_id,{url,name:m.name,path:m.avatar_path});}else avatarUrls.set(m.user_id,{url:'',name:m.name,path:''});}));
  decorate();}finally{refreshingAvatars=false;}
}
async function loadTicketProfiles(ticketId){
  const c=client();if(!c||!ticketId)return;
  const {data,error}=await c.rpc('dsb_ticket_profiles',{p_ticket_id:ticketId});
  if(error)return;
  await Promise.all((data||[]).map(async p=>{const url=p.avatar_path?await signedUrl(p.avatar_path):'';avatarUrls.set(p.user_id,{url,name:p.name,path:p.avatar_path||'',kind:p.kind});}));
}
function avatarMarkup(userId,name,className='avatar'){
  const entry=userId?avatarUrls.get(userId):null;const url=entry?.url||'';
  return `<span class="${E(className)}${url?' has-photo':''}"${userId?` data-avatar-user="${E(userId)}"`:''}>${url?`<img src="${E(url)}" alt="">`:E(initials(name))}</span>`;
}
function applyAvatar(el,userId,name){
  if(!el)return;const entry=userId?avatarUrls.get(userId):null;const url=entry?.url||'',fallback=initials(name),sig=url||`initials:${fallback}`;
  if(el.dataset.avatarSignature===sig)return;el.dataset.avatarSignature=sig;el.classList.toggle('has-photo',!!url);el.innerHTML=url?`<img src="${E(url)}" alt="">`:E(fallback);
}
function decorate(){
  const list=members();if(!refreshingAvatars&&list.some(m=>m.avatar_path&&!avatarUrls.has(m.user_id)))queueMicrotask(()=>refreshMemberAvatars());
  const me=member(),uid=user()?.id,name=me?.name||user()?.email||'Equipe DSB';
  $$('.user-avatar,.top-avatar').forEach(el=>applyAvatar(el,uid,name));
  $$('.member-row').forEach(row=>{const email=row.querySelector('.member-info p')?.textContent?.trim().toLowerCase();const m=members().find(x=>String(x.email||'').toLowerCase()===email);if(m)applyAvatar(row.querySelector('.avatar'),m.user_id,m.name);});
  injectSettingsPanel();
}
function notificationStatus(){
  if(!('Notification'in window))return'Não suportado neste navegador';
  if(Notification.permission==='denied')return'Bloqueado no navegador';
  if(notificationsEnabled())return'Ativadas neste dispositivo';
  if(Notification.permission==='granted')return'Desativadas neste dispositivo';
  return'Aguardando permissão';
}
function injectSettingsPanel(){
  if(location.hash!=='#settings')return;
  const layout=$('.settings-layout');if(!layout||$('.dsb-profile-panel'))return;
  const right=layout.querySelector(':scope > div')||layout;
  const me=member(),uid=user()?.id,name=me?.name||user()?.email||'Equipe DSB';
  const entry=uid?avatarUrls.get(uid):null;
  const section=document.createElement('section');section.className='panel settings-panel dsb-profile-panel';
  section.innerHTML=`<h2>Perfil e notificações</h2><div class="dsb-profile-photo-row">${avatarMarkup(uid,name,'avatar dsb-profile-avatar')}<div><strong>${E(name)}</strong><p>Escolha uma foto quadrada. Você poderá mover e aproximar antes de salvar.</p><div class="dsb-profile-actions"><button class="button secondary" type="button" data-avatar-action="open">${entry?.url?'Alterar foto':'Adicionar foto'}</button>${entry?.path?'<button class="button secondary danger" type="button" data-avatar-action="remove">Remover</button>':''}</div></div></div><div class="dsb-notification-block"><div><strong>Notificações de chamados no Windows</strong><p>Exibe avisos do sistema quando chegar uma nova mensagem e o chamado não estiver aberto. Funciona enquanto o navegador/PWA estiver em execução.</p></div><div class="dsb-notification-actions"><span class="dsb-notification-status">${E(notificationStatus())}</span><button class="button secondary" type="button" data-notification-action="toggle">${notificationsEnabled()?'Desativar':'Ativar notificações'}</button></div><div class="dsb-sound-picker"><label for="dsb-notification-sound">Som de nova mensagem</label><div class="dsb-sound-row"><select id="dsb-notification-sound" data-notification-sound-select>${soundOptionsMarkup()}</select><button class="button secondary" type="button" data-notification-action="test-sound">▶ Testar som</button></div><p>Escolha o som deste perfil. Ele toca apenas quando a conversa do chamado não estiver sendo visualizada.</p></div></div>`;
  right.prepend(section);
}
function showModal(html){const modal=$('#modal'),body=$('#modal-content');if(!modal||!body)return;body.innerHTML=html;if(!modal.open)modal.showModal();}
function closeModal(){const modal=$('#modal');if(modal?.open)modal.close();crop=null;}
function avatarModal(){
  showModal(`<div class="modal-head"><h2>Foto de perfil</h2><button class="icon-button" type="button" data-avatar-action="close" aria-label="Fechar">×</button></div><div class="modal-body"><div class="avatar-crop-layout"><div class="avatar-crop-stage"><canvas id="avatar-crop-canvas" width="512" height="512" aria-label="Pré-visualização da foto"></canvas><p id="avatar-crop-empty">Escolha uma imagem para começar.</p></div><div class="avatar-crop-controls"><label class="button secondary avatar-file-button">Escolher foto<input id="avatar-file-input" type="file" accept="image/png,image/jpeg,image/webp"></label><label for="avatar-zoom">Zoom</label><input id="avatar-zoom" type="range" min="1" max="3" step="0.01" value="1" disabled><p class="field-note">Arraste a imagem para ajustar o enquadramento. O arquivo final será salvo em formato WEBP.</p><p class="form-error" id="avatar-error"></p></div></div><div class="form-actions"><button class="button secondary" type="button" data-avatar-action="close">Cancelar</button><button class="button primary" type="button" data-avatar-action="save" disabled>Salvar foto</button></div></div>`);
  crop={img:null,zoom:1,offsetX:0,offsetY:0,drag:false,startX:0,startY:0,originX:0,originY:0};
  bindCropCanvas();
}
function bindCropCanvas(){
  const canvas=$('#avatar-crop-canvas');if(!canvas)return;
  canvas.addEventListener('pointerdown',e=>{if(!crop?.img)return;crop.drag=true;canvas.setPointerCapture(e.pointerId);const r=canvas.getBoundingClientRect();const sx=canvas.width/r.width,sy=canvas.height/r.height;crop.startX=(e.clientX-r.left)*sx;crop.startY=(e.clientY-r.top)*sy;crop.originX=crop.offsetX;crop.originY=crop.offsetY;});
  canvas.addEventListener('pointermove',e=>{if(!crop?.drag||!crop.img)return;const r=canvas.getBoundingClientRect();const sx=canvas.width/r.width,sy=canvas.height/r.height;const x=(e.clientX-r.left)*sx,y=(e.clientY-r.top)*sy;crop.offsetX=crop.originX+(x-crop.startX);crop.offsetY=crop.originY+(y-crop.startY);clampCrop();drawCrop();});
  const end=()=>{if(crop)crop.drag=false;};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
}
function cropGeometry(){const canvas=$('#avatar-crop-canvas');if(!canvas||!crop?.img)return null;const s=canvas.width,base=Math.max(s/crop.img.width,s/crop.img.height),scale=base*crop.zoom,w=crop.img.width*scale,h=crop.img.height*scale;return{s,w,h,x:(s-w)/2+crop.offsetX,y:(s-h)/2+crop.offsetY};}
function clampCrop(){const g=cropGeometry();if(!g)return;crop.offsetX=Math.max(-(g.w-g.s)/2,Math.min((g.w-g.s)/2,crop.offsetX));crop.offsetY=Math.max(-(g.h-g.s)/2,Math.min((g.h-g.s)/2,crop.offsetY));}
function drawCrop(){const canvas=$('#avatar-crop-canvas');const g=cropGeometry();if(!canvas||!g)return;const context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(crop.img,g.x,g.y,g.w,g.h);}
async function loadCropFile(file){
  if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Use PNG, JPG ou WEBP.');if(file.size>5*1024*1024)throw Error('A imagem deve ter no máximo 5 MB.');
  const url=URL.createObjectURL(file);const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Não foi possível ler a imagem.'));img.src=url;});URL.revokeObjectURL(url);
  crop.img=img;crop.zoom=1;crop.offsetX=0;crop.offsetY=0;$('#avatar-zoom').disabled=false;$('#avatar-zoom').value='1';$('[data-avatar-action="save"]').disabled=false;$('#avatar-crop-empty').hidden=true;drawCrop();
}
function canvasBlob(){return new Promise((resolve,reject)=>{$('#avatar-crop-canvas').toBlob(blob=>blob?resolve(blob):reject(Error('Não foi possível preparar a imagem.')),'image/webp',.9);});}
async function saveAvatar(){
  if(busy||!crop?.img)return;const c=client(),uid=user()?.id;if(!c||!uid)throw Error('Sessão indisponível.');busy=true;const button=$('[data-avatar-action="save"]');if(button)button.disabled=true;
  try{
    const blob=await canvasBlob(),old=member()?.avatar_path||'',path=`${uid}/avatar-${Date.now()}.webp`;
    const {error:uploadError}=await c.storage.from(AVATAR_BUCKET).upload(path,blob,{contentType:'image/webp',upsert:false});if(uploadError)throw uploadError;
    const {error:rpcError}=await c.rpc('dsb_set_my_avatar',{p_avatar_path:path});if(rpcError){await c.storage.from(AVATAR_BUCKET).remove([path]);throw rpcError;}
    if(old&&old!==path)await c.storage.from(AVATAR_BUCKET).remove([old]).catch(()=>{});
    pathUrls.delete(old);pathUrls.delete(path);closeModal();await ctx()?.reloadManager?.();await refreshMemberAvatars();toast('Foto de perfil atualizada.');
  }finally{busy=false;if(button?.isConnected)button.disabled=false;}
}
async function removeAvatar(){const c=client(),old=member()?.avatar_path||'';if(!c)return;const {error}=await c.rpc('dsb_set_my_avatar',{p_avatar_path:null});if(error)throw error;if(old)await c.storage.from(AVATAR_BUCKET).remove([old]).catch(()=>{});pathUrls.delete(old);avatarUrls.delete(user()?.id);await ctx()?.reloadManager?.();await refreshMemberAvatars();toast('Foto removida.');}
async function toggleNotifications(){
  if(!('Notification'in window)){toast('Este navegador não oferece notificações do sistema.',true);return;}
  if(notificationsEnabled()){localStorage.setItem(NOTIFY_KEY,'false');decorateSettingsAgain();return;}
  if(Notification.permission==='denied'){toast('As notificações estão bloqueadas. Libere-as nas permissões do navegador para este site.',true);return;}
  const permission=await Notification.requestPermission();localStorage.setItem(NOTIFY_KEY,permission==='granted'?'true':'false');if(permission==='granted')toast('Notificações de chamados ativadas neste dispositivo.');else toast('Permissão de notificações não concedida.',true);decorateSettingsAgain();
}
function decorateSettingsAgain(){const panel=$('.dsb-profile-panel');if(panel)panel.remove();injectSettingsPanel();}
async function unlockMessageSound(){
  if(audioUnlocked||!soundEnabled())return audioUnlocked;
  const audio=getSoundPlayer();if(!audio)return false;
  try{const oldVolume=audio.volume;audio.volume=0;audio.currentTime=0;await audio.play();audio.pause();audio.currentTime=0;audio.volume=oldVolume;audioUnlocked=true;return true;}catch{return false;}
}
async function playMessageSound(pref=soundPreference()){
  if(pref==='none')return;const audio=getSoundPlayer(pref);if(!audio)return;
  try{audio.currentTime=0;await audio.play();audioUnlocked=true;}catch{}
}
async function showWindowsNotification({title='Nova mensagem em chamado',body='',ticketId=null}={}){
  if(!notificationsEnabled())return;
  const url=`${location.origin}${location.pathname}#tickets`;
  const options={body,icon:'assets/images/icons/icon-192.png',badge:'assets/images/icons/icon-192.png',tag:`dsb-ticket-${ticketId||'new'}`,renotify:true,data:{url}};
  try{if('serviceWorker'in navigator){const reg=await navigator.serviceWorker.ready;await reg.showNotification(title,options);}else new Notification(title,options);}catch{}
}

document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-avatar-action],[data-notification-action]');if(!b)return;
  try{
    if(b.dataset.avatarAction==='open')avatarModal();
    if(b.dataset.avatarAction==='close')closeModal();
    if(b.dataset.avatarAction==='save')await saveAvatar();
    if(b.dataset.avatarAction==='remove')await removeAvatar();
    if(b.dataset.notificationAction==='toggle')await toggleNotifications();
    if(b.dataset.notificationAction==='test-sound'){await unlockMessageSound();await playMessageSound();}
  }catch(error){const el=$('#avatar-error');if(el)el.textContent=error?.message||String(error);else toast(error?.message||String(error),true);}
});
document.addEventListener('change',async e=>{try{if(e.target.id==='avatar-file-input')await loadCropFile(e.target.files?.[0]);if(e.target.matches('[data-notification-sound-select]')){const value=await saveSoundPreference(e.target.value);audioUnlocked=false;if(value!=='none'){await unlockMessageSound();await playMessageSound(value);}toast(value==='none'?'Som de mensagens desativado.':`Som selecionado: ${SOUND_OPTIONS[value].label}.`);}}catch(error){const el=$('#avatar-error');if(el)el.textContent=error?.message||String(error);else toast(error?.message||String(error),true);}});
document.addEventListener('input',e=>{if(e.target.id==='avatar-zoom'&&crop?.img){crop.zoom=Number(e.target.value)||1;clampCrop();drawCrop();}});

['pointerdown','touchstart','keydown'].forEach(type=>document.addEventListener(type,()=>{unlockMessageSound();},{passive:true}));
window.addEventListener('hashchange',()=>setTimeout(decorate,0));
window.addEventListener('DOMContentLoaded',()=>{observer=new MutationObserver(()=>decorate());observer.observe(document.body,{childList:true,subtree:true});setTimeout(()=>refreshMemberAvatars(),700);});

window.DSB_PROFILE={avatarMarkup,loadTicketProfiles,refreshMemberAvatars,playMessageSound,showWindowsNotification,notificationsEnabled,soundEnabled,signedUrl,getAvatarUrl:userId=>avatarUrls.get(userId)?.url||''};
})();
