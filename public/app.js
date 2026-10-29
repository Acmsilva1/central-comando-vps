import './ui.js';
const $ = s => document.querySelector(s);
const number = (n, digits = 1) => new Intl.NumberFormat('pt-BR',{maximumFractionDigits:digits}).format(n || 0);
const bytes = n => { const units=['B','KB','MB','GB','TB']; let unit=0; while(n>=1024 && unit<4){n/=1024;unit++;} return `${number(n)} ${units[unit]}`; };
const duration = seconds => seconds >= 86400 ? `${Math.floor(seconds/86400)} d ${Math.floor(seconds%86400/3600)} h` : `${Math.floor(seconds/3600)} h ${Math.floor(seconds%3600/60)} min`;
const stateLabels = {running:'Em execução',exited:'Parado',paused:'Pausado',restarting:'Reiniciando',created:'Criado',dead:'Falhou',removing:'Removendo',unknown:'Desconhecido'};
let snapshot = null, activeView = 'overview', authenticated = false, busy = false, historyVersion = 0;
function el(tag, text, cls) { const node=document.createElement(tag); if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node; }
function feedback(message, critical=false) { const node=$('#feedback');node.textContent=message;node.hidden=!message;node.classList.toggle('critical',critical); }
async function api(path,options={}) {
  const response=await fetch(path,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000),...options});
  let data;try{data=await response.json();}catch{throw new Error('Não foi possível ler a resposta da central.');}
  if(response.status===401){showLogin();throw new Error('Sua sessão expirou. Entre novamente.');}
  if(!response.ok)throw new Error(({collector_unavailable:'O coletor ainda não forneceu métricas. Confira a configuração do serviço na VPS.',rate_limited:'Muitas tentativas. Aguarde 15 minutos.',invalid_credentials:'Chave de administração incorreta.',origin_rejected:'O endereço de acesso difere do endereço configurado.'})[data.error]||'Não foi possível concluir a consulta. Tente novamente.');
  return data;
}
function showLogin(){document.querySelectorAll('[data-session-only]').forEach(node=>node.hidden=true);window.AppUI.closeConfirmation();authenticated=false;snapshot=null;historyVersion++;$('#login').hidden=false;$('#dashboard').hidden=true;$('#initial-loading').hidden=true;$('#logout').hidden=true;$('#connection').textContent='Acesso restrito';$('#connection').className='badge neutral';$('#container-dialog').close();$('#container-rows').replaceChildren();$('#container-list').replaceChildren();$('#history-chart').replaceChildren();}
function showDashboard(demo){document.querySelectorAll('[data-session-only]').forEach(node=>node.hidden=false);authenticated=true;$('#login').hidden=true;$('#dashboard').hidden=false;$('#initial-loading').hidden=true;$('#logout').hidden=demo;$('#demo-banner').hidden=!demo;}
function badge(container){const unhealthy=container.health==='unhealthy';return el('span',unhealthy?'Sem saúde':stateLabels[container.state]||'Desconhecido',`badge ${unhealthy||container.state==='dead'?'critical':container.state==='running'?'':container.state==='restarting'?'warn':'neutral'}`);}
function statusTone(value){return value>=90?'critical':value>=75?'warn':'';}
function metric(name,value,detail){$(`#${name}-value`).textContent=number(value);const meter=$(`#${name}-meter`);meter.value=value;meter.closest('.kpi').className=`kpi panel ${statusTone(value)}`;$(`#${name}-detail`).textContent=detail;}
function renderOverview(data){
  const h=data.host,containers=data.containers,running=containers.filter(c=>c.state==='running').length;
  $('#hostname').textContent=h.name;$('#server-info').textContent=`${number(h.cpuCount,0)} vCPU · ${bytes(h.memoryTotal)} RAM · ${bytes(h.diskTotal)} disco`;
  $('#uptime').textContent=`Ligado há ${duration(h.uptime)}`;$('#updated').textContent=`Coleta ${new Date(data.sampledAt).toLocaleTimeString('pt-BR')}`;
  metric('cpu',h.cpuPercent,`Carga em 1 min: ${number(h.load1,2)} · ${h.cpuCount} vCPU`);
  metric('memory',h.memoryPercent,`${bytes(h.memoryUsed)} de ${bytes(h.memoryTotal)} em uso`);
  metric('disk',h.diskPercent,`${bytes(h.diskTotal-h.diskUsed)} livres de ${bytes(h.diskTotal)}`);
  $('#running-value').textContent=running;$('#total-value').textContent=`/ ${containers.length}`;$('#nav-count').textContent=containers.length;
  $('#service-detail').textContent=running===containers.length?'Todos em execução':`${containers.length-running} fora de execução`;
  const restarts=containers.reduce((sum,c)=>sum+c.restarts,0);$('#restarts-detail').textContent=`${restarts} reinício${restarts===1?'':'s'} desde a criação`;
  const tone=h.memoryPercent>=90||h.diskPercent>=90?'critical':h.memoryPercent>=75||h.diskPercent>=75?'warn':'';
  $('#capacity-title').textContent=tone==='critical'?'Os recursos precisam de atenção':tone==='warn'?'Acompanhe a margem disponível':'Há margem no uso atual';
  $('#capacity-badge').textContent=tone==='critical'?'Crítico':tone==='warn'?'Atenção':'Dentro da referência';$('#capacity-badge').className=`badge ${tone}`;
  $('#available-value').textContent=bytes(h.memoryAvailable);
  const insights=[];
  if(containers.length){const top=[...containers].sort((a,b)=>b.memoryUsed-a.memoryUsed)[0];insights.push([`${top.name} concentra o maior uso: ${bytes(top.memoryUsed)}.`, '']);}
  const unlimited=containers.filter(c=>!c.memoryLimit&&c.state==='running').length;
  if(unlimited)insights.push([`${unlimited} container${unlimited>1?'s':''} sem teto de memória configurado.`, 'warn']);
  if(h.swapTotal===0)insights.push(['Swap não configurada. Picos de RAM precisam de acompanhamento.','warn']);
  else insights.push([`Swap: ${bytes(h.swapUsed)} de ${bytes(h.swapTotal)} em uso.`,'']);
  if(data.stale)insights.push(['A última leitura está desatualizada. Não representa o estado atual.','critical']);
  if(data.historyAvailable===false)insights.push(['O histórico está apenas em memória; confira a permissão do volume de dados.','warn']);
  if(data.monitor?.enabled)insights.push([data.monitor.error?'O envio de alertas requer atenção; consulte o estado do monitor.':'Alertas no WhatsApp ativos · perfil 1 · relatório diário às 20h.',data.monitor.error?'warn':'']);
  $('#insights').replaceChildren(...insights.map(([text,tone])=>{const n=el('div',undefined,`insight ${tone}`);n.append(el('span',undefined,'dot'),el('span',text));return n;}));
  const ranking=[...containers].sort((a,b)=>b.memoryUsed-a.memoryUsed).slice(0,4);
  $('#memory-ranking').replaceChildren(...(ranking.length?ranking.map(c=>{const row=el('div'),line=el('div',undefined,'rank-line'),progress=el('progress');line.append(el('strong',c.name),el('span',bytes(c.memoryUsed)));progress.max=h.memoryTotal||1;progress.value=c.memoryUsed;progress.setAttribute('aria-label',`Memória de ${c.name}`);row.append(line,progress);return row;}):[el('p','Nenhum container encontrado.','empty')]));
  $('#connection').textContent=data.stale?'Leitura antiga':data.demo?'Demonstração':'Atualizado';$('#connection').className=`badge ${data.stale?'warn':data.demo?'neutral':''}`;
  renderContainers();
}
function detailButton(c){const b=el('button','Detalhes','button');b.setAttribute('aria-label',`Detalhes de ${c.name}`);b.addEventListener('click',()=>openDetails(snapshot?.containers.find(item=>item.id===c.id)||c));return b;}
function renderContainers(){
  if(!snapshot)return;
  if($('#container-dialog').open || document.activeElement?.closest('#container-rows, #container-list'))return;
  const containers=snapshot.containers;
  $('#container-rows').replaceChildren(...(containers.length?containers.map(c=>{const row=el('tr'),name=el('td');name.append(el('strong',c.name),el('small',c.project||'Sem projeto Compose'));row.append(name);const state=el('td');state.append(badge(c));row.append(state,el('td',`${number(c.cpuPercent)}%`,'numeric'),el('td',bytes(c.memoryUsed),'numeric'),el('td',number(c.restarts,0),'numeric'));const action=el('td');action.append(detailButton(c));row.append(action);return row;}):[(()=>{const tr=el('tr'),td=el('td','Nenhum container encontrado.','empty');td.colSpan=6;tr.append(td);return tr;})()]));
  const query=$('#search').value.trim().toLocaleLowerCase('pt-BR');const filtered=containers.filter(c=>`${c.name} ${c.project}`.toLocaleLowerCase('pt-BR').includes(query));
  $('#container-list').replaceChildren(...(filtered.length?filtered.map(c=>{const card=el('article',undefined,'container-card');card.append(badge(c),el('h3',c.name),el('p',c.image,'image-name'));const group=el('div',undefined,'card-metrics');for(const [name,value]of [['CPU',`${number(c.cpuPercent)}%`],['Memória',bytes(c.memoryUsed)],['Processos',number(c.pids,0)],['Reinícios',number(c.restarts,0)]]){const n=el('div');n.append(el('span',name),el('strong',value));group.append(n);}card.append(group,detailButton(c));return card;}):[el('p',query?'Nenhum container corresponde à busca.':'Nenhum container encontrado.','empty')]));
}
function openDetails(c){$('#dialog-name').textContent=c.name;const entries=[['Imagem',c.image],['Projeto',c.project||'Sem projeto Compose'],['Estado',stateLabels[c.state]||c.state],['Healthcheck',c.health==='healthy'?'Saudável':c.health==='unhealthy'?'Falhando':c.health==='starting'?'Inicializando':'Não configurado'],['CPU',`${number(c.cpuPercent)}%`],['RAM de trabalho',bytes(c.memoryUsed)],['Limite de RAM',c.memoryLimit?bytes(c.memoryLimit):'Sem limite configurado'],['Início',c.startedAt?new Date(c.startedAt).toLocaleString('pt-BR'):'—'],['Reinícios',number(c.restarts,0)],['Encerramento por memória',c.oomKilled?'Sim':'Não registrado'],['Processos',number(c.pids,0)],['Rede recebida / enviada',`${bytes(c.networkRx)} / ${bytes(c.networkTx)}`],['Disco lido / gravado',`${bytes(c.blockRead)} / ${bytes(c.blockWrite)}`]];$('#dialog-details').replaceChildren(...entries.flatMap(([label,value])=>[el('dt',label),el('dd',value)]));$('#container-dialog').showModal();}
async function loadHistory(){
  const version=++historyVersion;
  try{const data=await api(`/api/history?period=${encodeURIComponent($('#period').value)}`);if(version!==historyVersion||!authenticated)return;const points=data.points;
    const root=$('#history-chart');root.replaceChildren();
    if(points.length<2){root.append(el('p',`Histórico em formação. ${points.length} amostra${points.length===1?'':'s'} disponível${points.length===1?'':'s'}; o gráfico aparece a partir de duas coletas.`, 'empty'));return;}
    const ns='http://www.w3.org/2000/svg';const svg=(tag,attrs)=>{const node=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,String(v));return node;};
    const chart=svg('svg',{viewBox:'0 0 900 280',role:'img','aria-label':'Histórico de CPU, RAM e disco em percentual'});
    for(const value of [0,25,50,75,100]){const y=240-value*2.1;chart.append(svg('line',{x1:43,x2:882,y1:y,y2:y,class:'chart-grid'}));const label=svg('text',{x:2,y:y+4,class:'chart-axis'});label.textContent=`${value}%`;chart.append(label);}
    const start=points[0].at,span=Math.max(1,points.at(-1).at-start);
    for(const key of ['cpu','memory','disk']){
      const segments=[[]];for(const [index,p]of points.entries()){if(index&&p.at-points[index-1].at>120_000)segments.push([]);segments.at(-1).push(`${43+(p.at-start)/span*839},${240-Math.max(0,Math.min(100,p[key]))*2.1}`);}
      for(const segment of segments)chart.append(svg('polyline',{points:segment.join(' '),class:`chart-line chart-${key}`}));
    }
    for(const[index,p]of[[0,points[0]],[1,points.at(-1)]]){const label=svg('text',{x:index?882:43,y:270,class:'chart-axis','text-anchor':index?'end':'start'});label.textContent=new Date(p.at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});chart.append(label);}root.append(chart);
    $('#history-note').textContent=`${points.length} amostras disponíveis neste período · CPU, RAM e disco em %. Lacunas de coleta não representam uso zero.`;
  }catch(error){if(version===historyVersion&&authenticated)$('#history-chart').replaceChildren(el('p',error.message,'empty'));}
}
async function refresh(){if(!authenticated||busy)return;busy=true;$('#refresh').disabled=true;try{const data=await api('/api/overview');if(!authenticated)return;snapshot=data;renderOverview(data);feedback(data.stale?'Métricas desatualizadas. Confira o coletor; os valores abaixo são da última coleta válida.':'');if(activeView==='history')await loadHistory();return true;}catch(error){if(authenticated){feedback(error.message,true);$('#connection').textContent=navigator.onLine?'Sem leitura':'Sem conexão';$('#connection').className='badge warn';}}finally{busy=false;$('#refresh').disabled=false;}}
function setView(view){activeView=view;const titles={overview:['Sua VPS, em perspectiva.','Acompanhe recursos, serviços e os sinais que merecem atenção.','Visão geral'],containers:['Cada serviço, em detalhe.','Consumo, estado e limites dos seus containers.','Containers'],history:['Entenda o uso ao longo do tempo.','Compare a utilização da VPS nas últimas horas e dias.','Histórico']};const title=titles[view];if(!title)return;$('#page-title').textContent=title[0];$('#page-copy').textContent=title[1];$('#breadcrumb').textContent=title[2];document.querySelectorAll('[data-panel]').forEach(n=>n.hidden=n.dataset.panel!==view);document.querySelectorAll('.nav-item[data-view]').forEach(n=>{n.classList.toggle('active',n.dataset.view===view);if(n.dataset.view===view)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});if(view==='history'&&authenticated)loadHistory();}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$('#refresh').addEventListener('click',async()=>{if(await refresh())AppUI.toast('Os indicadores foram atualizados.',{title:'Dados atualizados'});});$('#search').addEventListener('input',renderContainers);$('#period').addEventListener('change',loadHistory);$('#close-dialog').addEventListener('click',()=>$('#container-dialog').close());
$('#login-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;$('#login-error').hidden=true;try{await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Panel-Request':'1'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});form.elements.token.value='';showDashboard(false);await refresh();}catch(error){$('#login-error').textContent=error.message;$('#login-error').hidden=false;}finally{button.disabled=false;}});
const sessionChannel='BroadcastChannel'in window?new BroadcastChannel('central-session'):null;
sessionChannel?.addEventListener('message',event=>{if(event.data==='logout')showLogin();});
$('#logout').addEventListener('click',async()=>{if(!await AppUI.confirm({title:'Sair da central?',message:'Você precisará informar a chave administrativa para entrar novamente.',confirmLabel:'Sair'}))return;try{await api('/api/logout',{method:'POST',headers:{'Content-Type':'application/json','X-Panel-Request':'1'},body:'{}'});showLogin();sessionChannel?.postMessage('logout');}catch(error){feedback(error.message,true);}});
window.addEventListener('online',refresh);window.addEventListener('offline',()=>{if(authenticated)feedback('Sem conexão. Os valores exibidos são da última leitura recebida.');});document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
setInterval(()=>{if(!document.hidden)refresh();},15000);
try{const session=await api('/api/session');if(session.authenticated){showDashboard(session.demo);await refresh();}else showLogin();}catch{$('#initial-loading').textContent='Não foi possível conectar à central. Recarregue a página para tentar novamente.';}
