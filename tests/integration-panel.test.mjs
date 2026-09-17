import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {JSDOM} from 'jsdom';
import * as profiles from '../extension/profiles.js';import * as recovery from '../extension/recovery.js';import {AutoRetryClock} from '../extension/auto-retry.js';import {createTask,ImportEngine} from '../extension/engine.js';import {buildExports,contentHash} from '../extension/core.js';import {parseSpecification} from '../extension/openapi.js';
const html=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');
const source=(await readFile(new URL('../extension/panel.js',import.meta.url),'utf8')).replace(/^import .*$/gm,'');
const flush=()=>new Promise(r=>setImmediate(r));
const seed=()=>profiles.validateProfile({schemaVersion:1,id:'profile',revision:1,name:'IPS',adapterId:'generic',entry:'https://manual.test/docs/index',origin:'https://manual.test',pathPrefix:'/docs',hashMode:'route',queryKeys:[],tocSelector:'nav',contentSelector:'main',navigation:'links',samples:[]});
async function setup(t,{holdTab=false,savedProfiles=[],savedTasks=[],currentURL=null,savedSettings=[]}={}){
 const dom=new JSDOM(html,{url:'https://extension.test/panel.html?tab=1',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());
 const settings=new Map(savedSettings);let releaseTab;const gate=new Promise(r=>releaseTab=r),disk=new Map(savedTasks.map(task=>[task.taskId,structuredClone(task)])),held=new Set();
 const state={captured:[],verified:[],rotation:{running:false,count:0,message:'未开始'},profile:currentURL?{...seed(),id:'detected-profile',entry:currentURL}:seed(),detected:0,picked:null,previewPage:{status:'ok',text:'preview'},verificationPreviews:null};
 const chapters=['A','C'].map(title=>({key:'url:https://manual.test/docs/'+title,url:'https://manual.test/docs/'+title,title}));
 const clone=v=>structuredClone(v);
 const io={recover:async()=>{state.recovered=(state.recovered||0)+1;},tab:async()=>{if(holdTab)await gate;return{id:1,url:state.profile.entry,status:'complete'};},install:async()=>{if(state.installGate)await state.installGate;},detect:async()=>{state.detected++;return{profile:clone(state.profile),warnings:[]};},discover:async()=>({items:clone(chapters),warnings:[],diagnostics:{}}),pick:async()=>state.picked,
  capture:async(c,p)=>{if(state.captureError)throw new Error(state.captureError);state.captured.push(clone(p));return{status:'ok',url:c.url,text:'body '+c.title,navigationProof:{verified:true},warnings:[],diagnostics:{}};},
  verifySamples:async p=>{if(state.verifyError)throw new Error(state.verifyError);state.verified.push(clone(p));return{verified:true,previews:state.verificationPreviews||p.samples.map(c=>({title:c.title,text:'body '+c.title}))};}};
 function serializable(value){if(value===undefined)throw new Error('Value is unserializable');if(value&&typeof value==='object')Object.values(value).forEach(serializable);}
 Object.assign(w,profiles,recovery,{AutoRetryClock,createTask,ImportEngine,buildExports,contentHash,parseSpecification,createBrowserIO:()=>io,Blob,
  loadProfiles:async()=>clone(savedProfiles),saveProfile:async p=>{state.savedProfile=clone(p);},loadTask:async id=>disk.has(id)?clone(disk.get(id)):null,listTasks:async()=>[...disk.values()],saveTask:async task=>disk.set(task.taskId,clone(task)),saveWholeTask:async task=>disk.set(task.taskId,clone(task)),setSetting:async(key,value)=>settings.set(key,clone(value)),getSetting:async key=>settings.get(key)||null,
  chrome:{tabs:{getCurrent:async()=>({id:2}),update:async()=>{}},scripting:{executeScript:async options=>{
   if(options.files)return[];if(options.args)serializable(options.args);
   if(typeof options.args?.[0]==='string'){
    const action=options.args[0];if(action==='start')state.rotation={running:true,count:0,message:'运行中'};
    if(action==='stop')state.rotation={...state.rotation,running:false,message:'停止'};
    return[{result:{...state.rotation}}];
   }
   if(options.args)return[{result:state.previewPage}];return[{result:{running:state.rotation.running}}];
  }}}});
 w.navigator.locks={request:async(name,_options,callback)=>{if(held.has(name))return callback(null);held.add(name);try{return await callback({name});}finally{held.delete(name);}}};
 w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=()=>{};w.setInterval=()=>0;
 w.eval(source+'\n;globalThis.TestPanel={render,retryAutomatically,pauseImport,retryClock,previewCurrent,importSpec,scan,run,sample,verifyAndSave,rotationAction,rotationTrial,rotationCall,getTask:()=>task,getProfile:()=>profile,setRotation:value=>{rotationConfig=value;rotationVerified=false;showRotationTargets();},getRotationVerified:()=>rotationVerified};');
 return{w,document:w.document,state,disk,held,api:w.TestPanel,releaseTab,settle:async()=>{for(let i=0;i<15;i++)await flush();}};
}
test('panel web actions remain gated until initialization finishes',async t=>{
 const p=await setup(t,{holdTab:true});assert.equal(p.document.getElementById('start').disabled,true);assert.equal(p.document.getElementById('spec-file').disabled,false);
 p.releaseTab();await p.settle();assert.equal(p.document.getElementById('start').disabled,false);
});
test('edited selectors verify and capture in a new task without replacing earlier pages',async t=>{
 const p=await setup(t);await p.settle();const oldId=p.api.getTask().taskId;
 p.document.getElementById('content-selector').value='#article';await p.api.run();
 assert.notEqual(p.api.getTask().taskId,oldId);assert.ok(p.disk.has(oldId));assert.ok(p.state.captured.every(profile=>profile.contentSelector==='#article'));
 assert.equal(p.api.getTask().profile.contentSelector,p.api.getProfile().contentSelector);
});
test('a denied task lock leaves another task running and scan does not overwrite its metadata',async t=>{
 const p=await setup(t);await p.settle();const task=p.api.getTask();task.status='running';task.queue[0].status='processing';p.disk.set(task.taskId,structuredClone(task));p.held.add('task:'+task.taskId);
 await assert.rejects(p.api.scan(),/另一个|正在/);assert.equal(p.disk.get(task.taskId).status,'running');assert.equal(p.disk.get(task.taskId).queue[0].status,'processing');
});
test('sample B selected first stays in the B slot when A is selected later',async t=>{
 const p=await setup(t);await p.settle();p.state.picked={url:'https://manual.test/docs/B',title:'B'};await p.api.sample(1);p.state.picked={url:'https://manual.test/docs/A',title:'A'};await p.api.sample(0);await p.api.verifyAndSave();
 assert.deepEqual(p.state.verified.at(-1).samples.map(c=>c.title),['A','B']);
});
test('trial can be interrupted from the control page and cannot mutate targets while running',async t=>{
 const p=await setup(t);await p.settle();p.api.setRotation({origin:'https://manual.test',pathPrefix:'/docs',intervalMs:60000,targets:[{selector:'#a',title:'A'}]});
 const trial=p.api.rotationAction(p.api.rotationTrial);await p.settle();assert.equal(p.state.rotation.running,true);
 assert.equal(p.document.querySelector('#rotation-targets button').disabled,true);
 p.document.getElementById('rotation-stop').click();await p.settle();assert.equal(p.state.rotation.running,false);
 await trial;assert.equal(p.api.getRotationVerified(),false);
});

test('all panel previews replace embedded image payloads with a readable offline-image note',async t=>{
 const p=await setup(t);await p.settle();const page={status:'ok',title:'示意图',text:'正常正文',markdown:'正常正文\n![拓扑](data:image/png;base64,QUJDREVGRw==)\n<img alt="截图" src="data:image/png;base64,SElKS0w=">\n'};
 const check=()=>{const value=p.document.getElementById('preview').textContent;assert.match(value,/正常正文/);assert.match(value,/图片：拓扑，导出离线HTML可查看/);assert.match(value,/图片：截图，导出离线HTML可查看/);assert.doesNotMatch(value,/data:image|QUJDREVGRw|SElKS0w/);};
 p.state.previewPage=page;await p.api.previewCurrent();check();
 p.state.verificationPreviews=[page,page];await p.api.verifyAndSave();check();
 p.api.getTask().pages={one:page};p.api.render();check();assert.match(page.markdown,/QUJDREVGRw/);
});
test('panel rejects specification files above 16 MiB before reading or parsing',async t=>{
 const p=await setup(t);await p.settle();let read=false;
 Object.defineProperty(p.document.getElementById('spec-file'),'files',{value:[{size:16*1024*1024+1,name:'large.json',text:async()=>{read=true;return '{}';}}]});
 await p.document.getElementById('spec-file').onchange();assert.equal(read,false);assert.match(p.document.getElementById('error').textContent,/16MiB/);
 await assert.rejects(p.api.importSpec(' '.repeat(16*1024*1024+1),'large.json'),/16MiB/);
});

function storedTask(p,{product='Custom IPS',version='2026.9',updatedAt='2026-09-16T00:00:00Z'}={}){const task=createTask(p,product,version);task.updatedAt=updatedAt;task.queue=[{key:'url:https://manual.test/docs/A',url:'https://manual.test/docs/A',title:'A',status:'captured'}];task.pages={[task.queue[0].key]:{status:'ok',text:'saved content'}};return task;}
test('an unfamiliar manual under the same scope gets detection and a separate task',async t=>{
 const original=seed(),old=storedTask(original);const p=await setup(t,{savedProfiles:[original],savedTasks:[old],currentURL:'https://manual.test/docs/other'});await p.settle();
 assert.equal(p.api.getProfile().entry,'https://manual.test/docs/other');assert.notEqual(p.api.getTask().taskId,old.taskId);assert.equal(p.state.detected,1);assert.equal(p.disk.get(old.taskId).pages[old.queue[0].key].text,'saved content');
});
test('reopening a known chapter restores the newest proven profile and custom product/version',async t=>{
 const a=seed(),b={...seed(),id:'second',contentSelector:'#body'};const older=storedTask(a,{updatedAt:'2026-09-15T00:00:00Z'}),recent=storedTask(b,{product:'My appliance',version:'release 42'});
 const p=await setup(t,{savedProfiles:[a,b],savedTasks:[older,recent],currentURL:'https://manual.test/docs/A'});await p.settle();
 assert.equal(p.api.getProfile().id,'second');assert.equal(p.api.getTask().taskId,recent.taskId);assert.equal(p.document.getElementById('product').value,'My appliance');assert.equal(p.document.getElementById('version').value,'release 42');assert.equal(p.api.getTask().queue[0].status,'captured');assert.equal(p.state.detected,0);
});
test('ambiguous proven profiles wait for explicit saved-rule selection rather than creating a new task',async t=>{
 const a=seed(),b={...seed(),id:'second'};const p=await setup(t,{savedProfiles:[a,b]});await p.settle();
 assert.equal(p.api.getProfile(),null);assert.equal(p.api.getTask(),null);assert.equal(p.state.detected,0);assert.match(p.document.getElementById('profile-status').textContent,/选择.*规则/);assert.equal(p.document.getElementById('start').disabled,true);assert.equal(p.document.getElementById('profile-list').disabled,false);
 p.document.getElementById('profile-list').value='second';await p.document.getElementById('profile-list').onchange();assert.equal(p.api.getTask().profileId,'second');assert.equal(p.state.detected,0);
});


test('transient capture failure schedules automatic recovery and resumes only unsaved chapters',async t=>{
 const p=await setup(t);await p.settle();p.state.captureError='Failed to fetch';await p.api.run();
 const failed=p.api.getTask();assert.equal(failed.autoRecovery.enabled,true);assert.ok(failed.autoRecovery.nextAttemptAt-Date.now()>170000);
 p.state.captureError=null;await p.api.retryAutomatically(failed.taskId);await p.settle();
 assert.equal(p.api.getTask().queue.filter(c=>c.status==='captured').length,2);assert.equal(p.api.getTask().autoRecovery.enabled,false);assert.equal(p.state.recovered,1);
});
test('a temporary preflight error also gets a retry deadline',async t=>{
 const p=await setup(t);await p.settle();p.state.verifyError='Failed to fetch';await p.api.run();
 assert.equal(p.api.getTask().autoRecovery.enabled,true);assert.ok(p.disk.get(p.api.getTask().taskId).autoRecovery.nextAttemptAt);
 await p.api.pauseImport();assert.equal(p.api.getTask().autoRecovery.enabled,false);assert.equal(p.disk.get(p.api.getTask().taskId).autoRecovery.enabled,false);
});
test('duplicate-body review is retained and never scheduled for automatic retry',async t=>{
 const p=await setup(t);await p.settle();await p.api.run();const task=p.api.getTask();
 task.queue[1].status='review';task.queue[1].error='duplicate';p.disk.set(task.taskId,structuredClone(task));
 await p.api.run();assert.equal(p.api.getTask().queue[1].status,'review');assert.equal(p.api.getTask().autoRecovery.enabled,false);
});
test('changing task metadata prevents a pending automatic recovery from taking over another task',async t=>{
 const p=await setup(t);await p.settle();p.state.verifyError='Failed to fetch';await p.api.run();const old=p.api.getTask().taskId;
 p.document.getElementById('product').value='A different manual';await p.api.retryAutomatically(old);
 assert.equal(p.state.recovered||0,0);assert.equal(p.api.getTask().taskId,old);assert.equal(p.api.getTask().autoRecovery.enabled,false);
});


test('reopening the same source login tab restores its persisted recovery plan without fresh detection',async t=>{
 const profile=seed(),saved=createTask(profile,'Saved product','V1');saved.status='waiting_login';saved.recovery={retryable:true,reason:'auth'};
 saved.queue=[{key:'url:https://manual.test/docs/A',url:'https://manual.test/docs/A',title:'A',status:'captured'},{key:'url:https://manual.test/docs/C',url:'https://manual.test/docs/C',title:'C',status:'waiting_login'}];
 saved.pages={[saved.queue[0].key]:{status:'ok',text:'already saved'}};saved.autoRecovery={enabled:true,nextAttemptAt:Date.now()+180000,attempts:2,sourceTabId:1};
 const p=await setup(t,{savedTasks:[saved],savedSettings:[['recovery-tab:1',saved.taskId]],currentURL:'https://manual.test/login'});await p.settle();
 assert.equal(p.api.getTask().taskId,saved.taskId);assert.equal(p.api.getTask().autoRecovery.attempts,2);assert.equal(p.state.detected,0);assert.equal(p.api.getTask().pages[saved.queue[0].key].text,'already saved');await p.api.pauseImport();
});


test('a controller cannot reclaim automatic recovery after the task was bound to another source tab',async t=>{
 const p=await setup(t);await p.settle();p.state.verifyError='Failed to fetch';await p.api.run();const local=p.api.getTask();
 const saved=structuredClone(local);saved.autoRecovery.sourceTabId=9;p.disk.set(saved.taskId,saved);
 await p.api.retryAutomatically(local.taskId);assert.equal(p.state.recovered||0,0);assert.equal(p.disk.get(saved.taskId).autoRecovery.sourceTabId,9);await p.api.pauseImport();
});
test('a newer persisted retry deadline is honored instead of a stale controller starting immediately',async t=>{
 const p=await setup(t);await p.settle();p.state.verifyError='Failed to fetch';await p.api.run();const local=p.api.getTask();
 const saved=structuredClone(local);saved.autoRecovery.nextAttemptAt+=180000;p.disk.set(saved.taskId,saved);
 await p.api.retryAutomatically(local.taskId);assert.equal(p.state.recovered||0,0);assert.equal(p.disk.get(saved.taskId).autoRecovery.nextAttemptAt,saved.autoRecovery.nextAttemptAt);await p.api.pauseImport();
});
test('pausing during source preflight prevents subsequent sample navigation',async t=>{
 const p=await setup(t);await p.settle();let release;p.state.installGate=new Promise(r=>release=r);const running=p.api.run();await p.settle();assert.equal(p.document.getElementById('pause').disabled,false);
 await p.api.pauseImport();release();await running;assert.equal(p.state.verified.length,0);assert.equal(p.state.captured.length,0);assert.equal(p.api.getTask().autoRecovery.enabled,false);
});


test('reopening an interrupted running task persists its new retry deadline before scheduling',async t=>{
 const profile=seed(),saved=createTask(profile,'Interrupted','V1');saved.status='running';saved.autoRecovery={enabled:true,nextAttemptAt:null,attempts:0,sourceTabId:1};
 saved.queue=[{key:'url:https://manual.test/docs/A',url:'https://manual.test/docs/A',title:'A',status:'processing'},{key:'url:https://manual.test/docs/C',url:'https://manual.test/docs/C',title:'C',status:'pending'}];
 const p=await setup(t,{savedTasks:[saved],savedSettings:[['recovery-tab:1',saved.taskId]],currentURL:profile.entry});await p.settle();
 const deadline=p.api.getTask().autoRecovery.nextAttemptAt;assert.ok(deadline>Date.now());assert.equal(p.disk.get(saved.taskId).autoRecovery.nextAttemptAt,deadline);
 await p.api.retryAutomatically(saved.taskId);assert.equal(p.state.recovered,1);assert.equal(p.api.getTask().queue.filter(c=>c.status==='captured').length,2);assert.equal(p.api.getTask().autoRecovery.enabled,false);
});
