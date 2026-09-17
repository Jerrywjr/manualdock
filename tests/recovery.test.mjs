import test from 'node:test';
import assert from 'node:assert/strict';
import {RETRY_INTERVAL_MS,classifyRecoveryError,resetRetryableChapters,taskHasRetryableWork} from '../extension/recovery.js';

test('the automatic recovery interval is exactly three minutes',()=>assert.equal(RETRY_INTERVAL_MS,180000));
test('temporary network, loading and authentication failures are distinguished from configuration errors',()=>{
 for(const input of [new TypeError('Failed to fetch'),new Error('net::ERR_INTERNET_DISCONNECTED'),{status:'auth'},new Error('45秒内未确认章节和正文完成切换，未保存旧正文'),new Error('Execution context was destroyed'),new Error('Frame with ID 0 is showing error page')])assert.equal(classifyRecoveryError(input).retryable,true,String(input));
 for(const message of ['两个示例正文相同','Cannot access contents of url. Extension manifest must request permission.','原标签页已关闭，请从已登录的页面重新点击扩展','无法唯一打开所选章节','未确认所选章节的正文加载完成','原标签页已离开手册网站'])assert.equal(classifyRecoveryError(new Error(message)).retryable,false,message);
 assert.equal(classifyRecoveryError({status:'auth'}).reason,'auth');
});
test('automatic reset preserves captured and review pages and only requeues recoverable failures',()=>{
 const task={sourceKind:'web',queue:[{key:'saved',status:'captured'},{key:'duplicate',status:'review',error:'same text'},{key:'offline',status:'failed',error:'offline',recovery:{retryable:true,reason:'network'}},{key:'ambiguous',status:'failed',error:'ambiguous',recovery:{retryable:false,reason:'intervention'}},{key:'auth',status:'waiting_login'}],pages:{saved:{text:'A'},duplicate:{text:'A'}}};
 const pages=JSON.stringify(task.pages);assert.equal(taskHasRetryableWork(task),true);assert.equal(resetRetryableChapters(task),2);
 assert.deepEqual(task.queue.map(c=>c.status),['captured','review','pending','failed','pending']);assert.equal(JSON.stringify(task.pages),pages);
 assert.equal(taskHasRetryableWork(task),false);
});
test('a recoverable preflight failure can resume an empty or pending queue but never an already completed import',()=>{
 const recovery={retryable:true,reason:'network'};
 assert.equal(taskHasRetryableWork({sourceKind:'web',queue:[],recovery}),true);
 assert.equal(taskHasRetryableWork({sourceKind:'web',queue:[{status:'pending'}],recovery}),true);
 assert.equal(taskHasRetryableWork({sourceKind:'web',queue:[{status:'captured'},{status:'review'}],recovery}),false);
 assert.equal(taskHasRetryableWork({sourceKind:'openapi',queue:[],recovery}),false);
});

test('a permanent current preflight failure stops retries even when an earlier chapter failed transiently',()=>{
 const task={sourceKind:'web',recovery:{retryable:false,reason:'intervention'},queue:[{status:'failed',recovery:{retryable:true,reason:'network'}},{status:'pending'}]};
 assert.equal(taskHasRetryableWork(task),false);
});
