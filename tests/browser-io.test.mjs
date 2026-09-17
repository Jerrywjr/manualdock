import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserIO} from '../extension/browser-io.js';
const profile={schemaVersion:1,id:'p',revision:1,adapterId:'generic',entry:'https://manual.test/docs/#a',origin:'https://manual.test',pathPrefix:'/docs',hashMode:'route',queryKeys:[],tocSelector:'nav',contentSelector:'main',navigation:'links',samples:[]};
function serializable(value){if(value===undefined||typeof value==='function')throw new Error('Value is unserializable');if(value&&typeof value==='object')for(const v of Object.values(value))serializable(v);}
test('browser IO directory discovery uses serializable arguments when no chapter is requested',async t=>{
 const previous=globalThis.chrome;t.after(()=>{globalThis.chrome=previous;});
 globalThis.chrome={tabs:{get:async()=>({url:profile.entry,status:'complete'})},scripting:{executeScript:async options=>{
  if(options.files)return[];serializable(options.args);
  if(options.args[0]==='discover')return[{result:{items:[{url:profile.entry,title:'A'}],warnings:[]}}];
  return[{result:{body:{auth:false,signature:'A',nonEmpty:true},proof:null}}];
 }}};
 const result=await createBrowserIO(1).discover(profile);assert.equal(result.items[0].title,'A');
});

async function simulatedCapture(t,{fullDocument=false,alreadySelected=false}={}){
 const previous={chrome:globalThis.chrome,setTimeout:globalThis.setTimeout,now:Date.now};
 t.after(()=>{globalThis.chrome=previous.chrome;globalThis.setTimeout=previous.setTimeout;Date.now=previous.now;});
 let now=0,opened=false,url=fullDocument?'https://manual.test/docs/a.html':profile.entry;
 const selected=fullDocument?'https://manual.test/docs/b.html':alreadySelected?profile.entry:'https://manual.test/docs/#b';
 Date.now=()=>now;globalThis.setTimeout=(fn,ms)=>{queueMicrotask(()=>{now+=ms;fn();});return 1;};
 const body=()=>fullDocument?'same body':now>=4000?'new body':'old body';
 globalThis.chrome={tabs:{get:async()=>({url,status:'complete'}),update:async(_id,options)=>{opened=true;url=options.url;}},scripting:{executeScript:async options=>{
  if(options.files)return[];serializable(options.args);
  if(options.args.length===1){return[{result:{status:'ok',url,text:body(),warnings:[],diagnostics:{}}}];}
  return[{result:{documentId:fullDocument&&opened?'new-document':'original-document',body:{auth:false,signature:body(),nonEmpty:true,loading:false},proof:{verified:alreadySelected||opened,kind:'url'}}}];
 }}};
 return createBrowserIO(1).capture({key:'url:'+selected,url:selected,title:'B'},profile);
}
test('hash route capture waits for replacement body even when URL and old body are already stable',async t=>{
 const page=await simulatedCapture(t);assert.equal(page.text,'new body');assert.equal(page.navigationProof.verified,true);
});
test('a new document may legitimately have identical text to the previous page',async t=>{
 const page=await simulatedCapture(t,{fullDocument:true});assert.equal(page.text,'same body');assert.equal(page.navigationProof.verified,true);
});
test('the already selected current chapter does not require an artificial body change',async t=>{
 const page=await simulatedCapture(t,{alreadySelected:true});assert.equal(page.text,'old body');assert.equal(page.navigationProof.verified,true);
});

for(const mode of ['frame-link','reloading-click'])test('browser IO handles '+mode+' navigation without losing its scope or document proof',async t=>{
 const previous={chrome:globalThis.chrome,setTimeout:globalThis.setTimeout,now:Date.now};t.after(()=>{globalThis.chrome=previous.chrome;globalThis.setTimeout=previous.setTimeout;Date.now=previous.now;});
 let now=0,opened=false;Date.now=()=>now;globalThis.setTimeout=(fn,ms)=>{queueMicrotask(()=>{now+=ms;fn();});return 1;};
 const frame=mode==='frame-link',topURL='https://manual.test/docs/wrapper',chapter={url:'https://manual.test/docs/b',title:'B',...(frame?{}:{locator:{kind:'generic-toc',path:['B']}})},p={...profile,entry:topURL,...(frame?{frameSelector:'#manual-frame'}:{})};
 globalThis.chrome={tabs:{get:async()=>({url:topURL,status:'complete'}),update:async()=>{throw new Error('top-level navigation destroys the configured frame');}},scripting:{executeScript:async options=>{
  if(options.files)return[];serializable(options.args);
  if(options.args[0]==='open'){opened=true;throw new Error('Execution context was destroyed');}
  if(options.args.length===3){opened=true;return[{result:{navigated:true}}];}
  if(options.args.length===1)return[{result:{status:'ok',url:topURL,text:'new body',warnings:[],diagnostics:{}}}];
  return[{result:{documentId:opened?'new-document':'old-document',documentURL:opened?chapter.url:'https://manual.test/docs/a',body:{auth:false,signature:opened?'new body':'old body',nonEmpty:true,loading:false},proof:{verified:opened,kind:frame?'frame-url':'generic-toc'}}}];
 }}};
 const result=await createBrowserIO(1).capture(chapter,p);assert.equal(result.status,'ok');assert.equal(result.navigationProof.verified,true);if(frame)assert.equal(result.url,chapter.url);
});

const pictureA='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==';
const pictureB='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
async function verifyImageSamples(t,pages){
 const previous={chrome:globalThis.chrome,setTimeout:globalThis.setTimeout,now:Date.now};t.after(()=>{globalThis.chrome=previous.chrome;globalThis.setTimeout=previous.setTimeout;Date.now=previous.now;});
 let now=0,url=profile.entry;Date.now=()=>now;globalThis.setTimeout=(fn,ms)=>{queueMicrotask(()=>{now+=ms;fn();});return 1;};
 const samples=pages.map((_,index)=>({key:'sample:'+index,url:'https://manual.test/docs/'+index,title:String(index)}));
 globalThis.chrome={tabs:{get:async()=>({url,status:'complete'}),update:async(_id,options)=>{url=options.url;}},scripting:{executeScript:async options=>{
  if(options.files)return[];serializable(options.args);
  if(options.args.length===1)return[{result:{status:'ok',url,...pages[samples.findIndex(c=>c.url===url)]}}];
  return[{result:{documentId:url,body:{auth:false,signature:url,nonEmpty:true,loading:false},proof:{verified:true,kind:'url'}}}];
 }}};
 return createBrowserIO(1).verifySamples({...profile,samples});
}
for(const entry of [
 {name:'different embedded images can verify image-only chapters',text:'',images:[pictureA,pictureB],pass:true},
 {name:'different embedded images distinguish otherwise identical text',text:'shared',images:[pictureA,pictureB],pass:true},
 {name:'the same image and text cannot verify merely different wrapper HTML',text:'shared',images:[pictureA,pictureA],pass:false},
 {name:'image-only chapters without embedded images remain unverified',text:'',images:['https://manual.test/a.png','https://manual.test/b.png'],pass:false},
])test(entry.name,async t=>{
 const pages=entry.images.map((src,index)=>({text:entry.text,html:'<div class="wrapper'+index+'"><img alt="'+index+'" src="'+src+'"></div>',diagnostics:{images:{embedded:src.startsWith('data:')?1:0}}}));
 if(entry.pass)assert.equal((await verifyImageSamples(t,pages)).verified,true);else await assert.rejects(verifyImageSamples(t,pages),/正文相同|图片|切换/);
});

test('recovery reloads only the bound manual tab and waits until its document is ready',async t=>{
 const previous={chrome:globalThis.chrome,setTimeout:globalThis.setTimeout,now:Date.now};t.after(()=>{globalThis.chrome=previous.chrome;globalThis.setTimeout=previous.setTimeout;Date.now=previous.now;});
 let now=0,navigated=false,checks=0;Date.now=()=>now;globalThis.setTimeout=(fn,ms)=>{queueMicrotask(()=>{now+=ms;fn();});return 1;};
 const navigations=[];globalThis.chrome={tabs:{get:async()=>({url:profile.entry,status:!navigated||++checks>2?'complete':'loading'}),update:async(id,options)=>{navigated=true;navigations.push({id,...options});}},scripting:{executeScript:async options=>options.files?[]:[{result:{body:{auth:false}}}]}};
 assert.deepEqual(await createBrowserIO(12).recover(profile),{status:'ok'});assert.deepEqual(navigations,[{id:12,url:profile.entry}]);assert.ok(checks>2);
});
for(const source of ['https://another.test/docs/','https://manual.test/settings','chrome-error://chromewebdata/'])test('recovery refuses an unrelated or unprovable source: '+source,async t=>{
 const previous=globalThis.chrome;t.after(()=>{globalThis.chrome=previous;});let writes=0;
 globalThis.chrome={tabs:{get:async()=>({url:source,status:'complete'}),update:async()=>{writes++;}},scripting:{executeScript:async()=>{throw new Error('must not inspect an unrelated tab');}}};
 await assert.rejects(createBrowserIO(1).recover(profile),/来源|范围|无法确认|网站/);assert.equal(writes,0);
});
test('recovery can restore a browser error page when its pending navigation still proves the manual scope',async t=>{
 const previous={chrome:globalThis.chrome,setTimeout:globalThis.setTimeout,now:Date.now};t.after(()=>{globalThis.chrome=previous.chrome;globalThis.setTimeout=previous.setTimeout;Date.now=previous.now;});
 let now=0,url='chrome-error://chromewebdata/';Date.now=()=>now;globalThis.setTimeout=(fn,ms)=>{queueMicrotask(()=>{now+=ms;fn();});return 1;};
 globalThis.chrome={tabs:{get:async()=>({url,pendingUrl:profile.entry,status:'complete'}),update:async(_id,options)=>{url=options.url;}},scripting:{executeScript:async options=>options.files?[]:[{result:{body:{auth:false}}}]}};
 assert.equal((await createBrowserIO(1).recover(profile)).status,'ok');assert.equal(url,profile.entry);
});
test('authentication waiting never reloads or submits the login page',async t=>{
 const previous=globalThis.chrome;t.after(()=>{globalThis.chrome=previous;});let writes=0;
 globalThis.chrome={tabs:{get:async()=>({url:'https://manual.test/login.php',status:'complete'}),update:async()=>{writes++;}},scripting:{executeScript:async()=>{throw new Error('login form must remain untouched');}}};
 assert.equal((await createBrowserIO(1).recover(profile)).status,'auth');assert.equal(writes,0);
});
test('sample verification preserves authentication failures for the automatic scheduler',async t=>{
 const previous=globalThis.chrome;t.after(()=>{globalThis.chrome=previous;});
 globalThis.chrome={tabs:{get:async()=>({url:'https://manual.test/login.php',status:'complete'})}};
 await assert.rejects(createBrowserIO(1).verifySamples({...profile,samples:[{key:'a',url:profile.entry},{key:'b',url:'https://manual.test/docs/#b'}]}),error=>error.code==='AUTH_REQUIRED');
});

test('cancelling verification before it starts never opens a sample',async t=>{
 const previous=globalThis.chrome;t.after(()=>{globalThis.chrome=previous;});let reads=0;
 globalThis.chrome={tabs:{get:async()=>{reads++;throw new Error('must not inspect');}}};
 await assert.rejects(createBrowserIO(1).verifySamples({...profile,samples:[{key:'a',url:profile.entry},{key:'b',url:'https://manual.test/docs/#b'}]},{shouldContinue:()=>false}),error=>error.code==='CANCELLED');assert.equal(reads,0);
});
test('cancelling during the first sample prevents navigation to the second sample',async t=>{
 const previous={chrome:globalThis.chrome,setTimeout:globalThis.setTimeout,now:Date.now};t.after(()=>{globalThis.chrome=previous.chrome;globalThis.setTimeout=previous.setTimeout;Date.now=previous.now;});
 let now=0,url=profile.entry,allowed=true;const opened=[];Date.now=()=>now;globalThis.setTimeout=(fn,ms)=>{queueMicrotask(()=>{now+=ms;fn();});return 1;};
 globalThis.chrome={tabs:{get:async()=>({url,status:'complete'}),update:async(_id,options)=>{url=options.url;opened.push(url);}},scripting:{executeScript:async options=>{
  if(options.files)return[];
  if(options.args.length===1){allowed=false;return[{result:{status:'ok',url,text:'one sample'}}];}
  return[{result:{documentId:url,body:{auth:false,signature:url,nonEmpty:true,loading:false},proof:{verified:true,kind:'url'}}}];
 }}};
 const samples=[{key:'a',url:profile.entry},{key:'b',url:'https://manual.test/docs/#b'}];
 await assert.rejects(createBrowserIO(1).verifySamples({...profile,samples},{shouldContinue:()=>allowed}),error=>error.code==='CANCELLED');assert.deepEqual(opened,[profile.entry]);
});
