// 合否の目安（PASS_RATE=70%）：69%と70%の境目で、結果メッセージと色が切り替わる
const {JSDOM}=require('jsdom');const fs=require('fs');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const log=[];const ok=(c,m)=>log.push((c?'PASS ':'FAIL ')+m);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const qs=n=>Array.from({length:n},(_,i)=>({q:'Q'+i,choices:['a','b','c','d'],answer:1,explanation:'e'+i,topic:'t'}));
// n問すべて解答済みで、right問が正解の途中保存データ
const prog=(n,right)=>JSON.stringify({fieldId:'fundamentals',count:n,isReview:false,savedAt:Date.now(),current:n-1,questions:qs(n),
  answers:Array.from({length:n},(_,i)=>({chosen:i<right?1:0,correct:1,isRight:i<right}))});
function boot(ls){return new JSDOM(html,{runScripts:'dangerously',url:'https://x.test/',pretendToBeVisual:true,
 beforeParse(w){for(const[k,v]of Object.entries(ls))w.localStorage.setItem(k,v);w.scrollTo=()=>{};w.Element.prototype.scrollIntoView=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});}}).window;}
async function result(n,right){
  const w=boot({pmi_quiz_progress_v1:prog(n,right)});await wait(150);
  w.document.querySelector('#resume-banner button').click();await wait(50);
  w.finishQuiz();await wait(50);
  const d=w.document;return{msg:d.getElementById('result-msg').textContent,circle:d.getElementById('result-circle').innerHTML,pct:d.getElementById('result-circle').textContent.trim()};
}
(async()=>{
  let r=await result(10,7);
  ok(r.pct==='70%'&&r.msg==='目標達成（70%以上）'&&r.circle.includes('--c-ok-text'),'70% passes: '+r.pct+' '+r.msg);
  r=await result(13,9);
  ok(r.pct==='69%'&&r.msg==='あと少し（目標70%）'&&r.circle.includes('--c-ng-text'),'69% does not pass: '+r.pct+' '+r.msg);
  r=await result(10,6);
  ok(r.msg==='あと少し（目標70%）','60% no longer passes: '+r.msg);
  // ホームの正答率の色：70%は緑、60%は赤
  const rec=(id,field,n,right)=>({id,date:new Date().toISOString(),field,fieldName:field,fieldIcon:'x',count:n,correct:right,
    questions:qs(n).map((q,i)=>({...q,userAnswer:i<right?1:0,isRight:i<right}))});
  const hist={history:[rec('a','fundamentals',10,7),rec('b','predictive',10,6)],totalAnswered:20,totalCorrect:13};
  const w=boot({pmi_quiz_v1:JSON.stringify(hist)});await wait(150);
  const cards=[...w.document.querySelectorAll('#category-list .category-card')];
  const colorOf=id=>{const c=cards.find(x=>x.textContent.includes(id==='fundamentals'?'基礎の用語':'従来型'));return c&&c.innerHTML.match(/color:\s*(var\(--c-[a-z]+\))[^"]*">\d+%/)?.[1];};
  ok(colorOf('fundamentals')==='var(--c-success)','home: 70% is green ('+colorOf('fundamentals')+')');
  ok(colorOf('predictive')==='var(--c-danger)','home: 60% is red ('+colorOf('predictive')+')');
  console.log(log.join('\n'));process.exit(log.some(l=>l.startsWith('FAIL'))?1:0);
})();
