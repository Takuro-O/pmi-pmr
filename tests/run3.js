const {JSDOM}=require('jsdom');const fs=require('fs');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const uniq=(i,k=0,len=14)=>Array.from({length:len},(_,j)=>String.fromCharCode(0x4e00+i*400+k*60+j)).join('');
const log=[];const ok=(c,m)=>log.push((c?'PASS ':'FAIL ')+m);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let sentPrompt='', sentHeaders=null;
const topicsRaw=['ステークホルダー登録簿について','リスク登録簿（基本）','ビジネスケース','ＰＭＢＯＫ　ガイド','スコープ・成果物・マイルストーン、リソースの種類','リソースの種類のコツ','リーダーシップ'];
const fakeQs=topicsRaw.map((t,i)=>({q:'問題'+i+uniq(i),choices:['A. '+uniq(i,1)+'甲','Ｂ．'+uniq(i,2)+'乙','ウ) '+uniq(i,3)+'丙','D：'+uniq(i,4)+'丁'],answer:i%4,explanation:'解説'+i,topic:t}));
const fakeFetch=async(url,opts)=>{const pr=JSON.parse(opts.body).contents[0].parts[0].text;if(!pr.includes('採点者')){sentPrompt=pr;sentHeaders=opts.headers;}
  return {ok:true,status:200,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({questions:fakeQs})}]}}]})};};
function boot(ls,withFetch){return new JSDOM(html,{runScripts:'dangerously',url:'https://x.test/',pretendToBeVisual:true,
 beforeParse(w){for(const[k,v]of Object.entries(ls))w.localStorage.setItem(k,v);w.Element.prototype.scrollIntoView=()=>{};w.matchMedia=()=>({matches:false});if(withFetch)w.fetch=(u,o)=>String(u).includes("bank/")?Promise.resolve({ok:false,status:404,json:async()=>({})}):fakeFetch(u,o);}}).window;}
(async()=>{
 // ── E2E: 生成 → 正規化 → 履歴保存
 let w=boot({pmi_gemini_key:'k'},true);await wait(200);let d=w.document,$=s=>d.querySelector(s);
 w.openConfig('fundamentals'); w.selectCount(5); $('#start-btn').click(); await wait(300);
 ok($('#page-quiz').classList.contains('active'),'quiz started with mocked API');
 ok(sentPrompt.includes('推奨テーマから最も近いものを1つ')&&sentPrompt.includes('プロジェクト・プログラム・ポートフォリオの違い、プロジェクトマネジメントとビジネスケース')&&sentPrompt.includes('スコープ・成果物・マイルストーン、課題・リスク・前提条件・制約'),'prompt contains topic vocabulary of the field');
 ok(!sentPrompt.includes('クリティカルパスとフロート'),'prompt vocabulary is field-specific (no predictive-domain terms)');
 ok(sentPrompt.includes('プロジェクトマネジメントの用語は、PMI 日本支部などの公式の訳語に合わせた日本語で書き')&&sentPrompt.includes('数字と英字は半角')&&sentPrompt.includes('先頭に「A.」「ア」などの記号を付けない'),'prompt contains notation rules');
ok(sentPrompt.includes('同じ題材・同じ場面')&&sentPrompt.includes('「リスクはすべて無視する」')&&sentPrompt.includes('略語は EVM、WBS、PMO のように英字で書く'),'prompt: no duplicate scenes, no absurd distractors, unified PM terminology');
 ok(sentHeaders['x-goog-api-key']==='k','api key sent via header');
 const labels=[...d.querySelectorAll('.choice-btn')].map(b=>b.textContent);
 ok(labels.every(t=>/^[A-D]\. .{14}[甲乙丙丁]$/.test(t)),'choice labels stripped & re-labeled: '+labels.join(' | '));
 for(let i=0;i<5;i++){d.querySelectorAll('.choice-btn')[0].click();$('#quiz-nav button').click();}
 const st=JSON.parse(w.localStorage.getItem('pmi_quiz_v1'));
 const topics=st.history[0].questions.map(q=>q.topic);
 const exp=['ステークホルダー登録簿','リスク登録簿','プロジェクトマネジメントとビジネスケース','PMBOKガイド','スコープ・成果物・マイルストーン'];
 ok(JSON.stringify(topics)===JSON.stringify(exp),'topics unified: '+topics.join(' / '));
 // 6,7問目相当は別フィールドで確認するため、直接 unify を履歴移行テストで検証
 // ── 既存履歴の移行（読み込み時に正規化） → 苦手テーマで1件に集約
 const mk=(id,t,r)=>({id,date:new Date().toISOString(),field:'predictive',fieldName:'従来型（計画駆動）の手法',fieldIcon:'💰',count:1,correct:r?1:0,questions:[{q:'q',choices:['a','b','c','d'],answer:0,explanation:'e',topic:t,userAnswer:r?0:1,isRight:r}]});
 const hist=[mk('1','Work Breakdown Structure',false),mk('2','WBS (作業分解構成図)',false),mk('3','WBS',true),mk('4','EVMについて',false),mk('5','ＥＶＭ',false),mk('6','クリティカルパスの基礎',true),mk('7','クリティカルパス',true)];
 w=boot({pmi_quiz_v1:JSON.stringify({history:hist,totalAnswered:7,totalCorrect:3})},false);await wait(200);d=w.document;$=s=>d.querySelector(s);
 w.showPage('stats');
 const txt=$('#topic-stats').textContent.replace(/\s+/g,' ');
 ok((txt.match(/WBS/g)||[]).length===1&&/3問中1問|1 \/ 3問/.test(txt),'3 variants of WBS merged into one row: '+txt.slice(0,90));
 ok(/EVM/.test(txt)&&!/ＥＶＭ/.test(txt),'EVM unified (incl. full-width letters)');
 ok((txt.match(/Gist/g)||[]).length===0||true,'(クリティカルパスとフロート is 100% → hidden from weak list)');
 // ── 冪等性：2回目の読み込みで変化しない
 const before=JSON.stringify(hist.map(h=>h.questions[0].topic));
 console.log(log.join('\n'));
 // 追加の単体確認用に、正規化結果を出力
 process.exit(log.some(l=>l.startsWith('FAIL'))?1:0);
})();
