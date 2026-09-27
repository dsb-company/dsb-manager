/* Funções puras de validação, datas e indicadores. */
(function (root) {
'use strict';
const TYPES=['client','project','task','transaction','event'];
const choices={
 client:['Prospect','Ativo','Inativo'],project:['Planejamento','Em andamento','Em revisão','Concluído','Pausado'],
 task:['A fazer','Em andamento','Concluída'],transaction:['Pendente','Pago'],event:['Reunião','Entrega','Outro']
};
const fields={client:['name','contact','email','phone','status','notes'],project:['name','client_id','service','status','value','progress','due','owner','notes'],task:['name','project_id','status','priority','due','owner','notes'],transaction:['name','client_id','direction','value','status','due','paid_date','category','notes'],event:['name','date','time','duration','status','location','notes']};
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const date=v=>v?new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(new Date(v+'T12:00:00')).replace('.',''):'Sem prazo';
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)||0);
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00'))&&iso(new Date(v+'T12:00:00'))===v;
function validate(type,input){
 if(!TYPES.includes(type))throw Error('Tipo de registro inválido.');
 const d={};for(const k of fields[type])d[k]=String(input[k]??'').trim();
 if(d.name.length<2||d.name.length>160)throw Error('Informe um nome entre 2 e 160 caracteres.');
 for(const[k,v]of Object.entries(d))if(v.length>(k==='notes'?3000:254))throw Error('O campo '+k+' é muito longo.');
 if(!choices[type].includes(d.status))throw Error('Selecione uma situação válida.');
 for(const k of ['due','date','paid_date'])if(d[k]&&!validDate(d[k]))throw Error('Informe uma data válida.');
 if(d.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email))throw Error('Informe um e-mail válido.');
 if('value'in d){d.value=Math.round(Number(d.value)*100)/100;if(!Number.isFinite(d.value)||d.value<0||d.value>999999999)throw Error('Informe um valor de 0 a 999.999.999.');}
 if('progress'in d){d.progress=Number(d.progress);if(!Number.isInteger(d.progress)||d.progress<0||d.progress>100)throw Error('O progresso deve ser um número inteiro entre 0 e 100.');if(d.status==='Concluído')d.progress=100;}
 if(type==='task'&&!['Baixa','Média','Alta'].includes(d.priority))throw Error('Selecione a prioridade.');
 if(type==='transaction'){if(!['Receita','Despesa'].includes(d.direction))throw Error('Selecione receita ou despesa.');if(!d.due)throw Error('Informe o vencimento.');if(d.status==='Pago'&&!d.paid_date)throw Error('Informe a data do pagamento.');if(d.status==='Pendente')d.paid_date='';}
 if(type==='event'){if(!d.date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time))throw Error('Informe data e horário válidos.');d.duration=Number(d.duration);if(!Number.isInteger(d.duration)||d.duration<5||d.duration>1440)throw Error('A duração deve ser de 5 a 1.440 minutos.');}
 return d;
}
function metrics(records,month){const tx=records.filter(r=>r.type==='transaction');const paid=tx.filter(r=>r.data.status==='Pago'&&r.data.paid_date.startsWith(month));const sum=(arr,dir)=>Math.round(arr.filter(r=>r.data.direction===dir).reduce((n,r)=>n+Number(r.data.value),0)*100)/100;return{revenue:sum(paid,'Receita'),expenses:sum(paid,'Despesa'),balance:Math.round((sum(paid,'Receita')-sum(paid,'Despesa'))*100)/100,receivable:sum(tx.filter(r=>r.data.status==='Pendente'&&r.data.due.startsWith(month)),'Receita'),payable:sum(tx.filter(r=>r.data.status==='Pendente'&&r.data.due.startsWith(month)),'Despesa'),projects:records.filter(r=>r.type==='project'&&!['Concluído','Pausado'].includes(r.data.status)).length,clients:records.filter(r=>r.type==='client'&&r.data.status==='Ativo').length,pending:records.filter(r=>r.type==='task'&&r.data.status!=='Concluída').length};}
function validConfig(c){if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(c.supabaseUrl||''))return false;const k=c.supabaseKey||'';if(/^sb_publishable_[\w-]+$/.test(k))return true;try{const p=JSON.parse(atob(k.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return p.role==='anon';}catch{return false;}}
root.DSB={TYPES,choices,fields,escape,today,iso,date,money,validate,metrics,validConfig};
})(typeof window==='undefined'?globalThis:window);
