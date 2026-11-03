'use strict';
const CFG=Object.freeze({min:65,cruise:140,max:315,accel:82,brake:240,laneWidth:3.4,laneTime:.17,playerWidth:1.75,carWidth:1.8,length:4.4,carGap:3,rowGap:64,rowGapMax:88,opponent:65,nearGap:1.7,rampSpeed:80,jumpMin:200,jumpDuration:1.85,rampFrequency:.3,tankCrushBonus:200,tankDuration:4,flyDuration:2.6,coinReveal:.65,maxPickups:3,coinInterval:15,trafficCurve:.4,trafficCurveSeconds:30,variantMin:5,variantMax:10,variantFast:195,variantSlow:13,hardFactor:1.5,crashDuration:1.35});
const $=id=>document.getElementById(id),canvas=$('scene');let ctx=canvas.getContext('2d'),skyCache=null,skyCacheVanish=.59,skyCacheCam=-2.8;
let width=0,height=0,dpr=1,mode='menu',speed=140,elapsed=0,travel=0,score=0,lane=1,x=-1.7,prevX=x,cars=[],row=0,nextRow=0,combo=0,maxCombo=0,nearCount=0,popTime=0,crashTime=0,lastStamp=null,accumulator=0,runId='',newRecord=false;
let ramps=[],rampSerial=0,jump=null,pendingLanding=0,nextRamp=1400,jumpCount=0,passStreak=0,passWindow=0,flamePulse=0;
const portraitArt={fly:typeof Image==='undefined'?null:new Image(),tank:typeof Image==='undefined'?null:new Image()};if(portraitArt.fly)portraitArt.fly.src='assets/fly-portrait.png';if(portraitArt.tank)portraitArt.tank.src='assets/tank-portrait.png';
let pickups=[],power=null,coinsCollected=0,coinBudget=0,tankKills=0;
let nextVariantAt=5,variantCount=0,variantEvents=[];
let difficulty='normal';
let wrecks=[],debris=[],crashAge=0;
// A fresh seed per run; a seeded PRNG also makes failures reproducible in tests.
let trafficSeed=1,trafficState=1,openingLane=1,openingRepeat=0;
function initTraffic(seed){trafficSeed=(seed>>>0)||1;trafficState=trafficSeed;openingLane=1;openingRepeat=0}
function trafficRandom(){trafficState^=trafficState<<13;trafficState^=trafficState>>>17;trafficState^=trafficState<<5;return (trafficState>>>0)/4294967296}
function freshTrafficSeed(){try{const a=new Uint32Array(1);window.crypto.getRandomValues(a);return a[0]||1}catch{return (Math.random()*4294967296)>>>0||1}}
function rowSpacing(){return CFG.rowGap+trafficRandom()*(CFG.rowGapMax-CFG.rowGap)}
const keys=new Set(),touch={gas:new Set(),brake:new Set()};let records={top:[],last:null,name:'DRIVER',muted:false},storageOK=true;
try{const data=JSON.parse(localStorage.getItem(storageKey()));if(data&&Array.isArray(data.top)){records={...records,...data,top:data.top.filter(r=>Number.isFinite(r.score)&&typeof r.name==='string').slice(0,3)}}}catch{storageOK=false}
function persist(){try{localStorage.setItem(storageKey(),JSON.stringify(records))}catch{storageOK=false;$('storage').textContent='저장 공간을 사용할 수 없어 이번 기록은 유지되지 않습니다.'}}
function rankings(){const host=$('ranking');host.replaceChildren();for(let i=0;i<3;i++){const r=records.top[i],el=document.createElement('div');el.className='rankrow';const n=document.createElement('em'),name=document.createElement('span'),v=document.createElement('b');n.textContent=String(i+1).padStart(2,'0');name.textContent=r?r.name:'—';v.textContent=r?r.score.toLocaleString():'—';el.append(n,name,v);host.append(el)}$('last').textContent=records.last?records.last.score.toLocaleString():'—'}

function storageKey(){return difficulty==='hard'?'redline-endless-hard-v1':'redline-endless-normal-v1'}
function trafficPressure(t=elapsed){return 1+CFG.trafficCurve*Math.pow(Math.max(0,t)/CFG.trafficCurveSeconds,2)}
function closingSpeed(v=motionSpeed(),opponent=CFG.opponent){return (v+opponent)/3.6*(difficulty==='hard'?CFG.hardFactor:1)*trafficPressure()}
function selectMode(next){
 if(mode!=='menu'||!['normal','hard'].includes(next)||next===difficulty)return;
 persist();difficulty=next;const defaults={top:[],last:null,name:records.name,muted:records.muted};records=defaults;
 try{const data=JSON.parse(localStorage.getItem(storageKey()));if(data&&Array.isArray(data.top))records={...defaults,...data,top:data.top.filter(r=>Number.isFinite(r.score)&&typeof r.name==='string').slice(0,3)}}catch{storageOK=false}
 for(const button of document.querySelectorAll('[data-mode]')){button.setAttribute('aria-pressed',String(button.dataset.mode===difficulty))}
 $('modeInfo').textContent=difficulty==='hard'?'상대 차량 접근 속도 ×1.5':'기본 난도';$('rankTitle').textContent=difficulty==='hard'?'HARD TOP 3':'LOCAL TOP 3';$('modeBadge').textContent=difficulty==='hard'?'무한 역주행 / HARD':'무한 역주행';audio.muted=records.muted;audio.label();rankings();
}


function carClosingSpeed(c){return closingSpeed(motionSpeed(),c.opponentSpeed??CFG.opponent)}
function variantIsReadable(c,npcSpeed){
 const arrival=c.z/closingSpeed(motionSpeed(),npcSpeed);if(arrival<1.15)return false;
 const lanes=new Set([Math.round(c.x/CFG.laneWidth+1.5)]);
 for(const other of cars){if(other===c||other.z<0)continue;const t=other.z/carClosingSpeed(other);if(Math.abs(t-arrival)<.22)lanes.add(Math.round(other.x/CFG.laneWidth+1.5))}
 return lanes.size<4;
}
function updateVariants(){
 if(power||elapsed<nextVariantAt)return;
 const kind=trafficRandom()<.5?'fast':'slow',target=kind==='fast'?CFG.variantFast:CFG.variantSlow;
 const candidates=cars.filter(c=>!c.variant&&!c.scored&&c.z>=200&&c.z<=600&&variantIsReadable(c,target));
 if(!candidates.length)return; // Wait for a visible, readable opportunity; never create a car on top of the player.
 const c=candidates[Math.floor(trafficRandom()*candidates.length)];c.variant=kind;c.opponentSpeed=CFG.opponent;c.targetOpponent=target;c.color=kind==='fast'?'#d4a06b':'#7192af';variantCount++;
 variantEvents.push({time:elapsed,kind});if(variantEvents.length>12)variantEvents.shift();nextVariantAt=elapsed+CFG.variantMin+trafficRandom()*(CFG.variantMax-CFG.variantMin);
}
function prepareCarSpeeds(dt){
 // Oncoming cars follow the car ahead in the same lane instead of passing through it.
 const groups=[[],[],[],[]];for(const c of cars){if(c.variant)c.opponentSpeed+=(c.targetOpponent-c.opponentSpeed)*(1-Math.exp(-dt*3));const l=Math.max(0,Math.min(3,Math.round(c.x/CFG.laneWidth+1.5)));groups[l].push(c)}
 for(const group of groups){group.sort((a,b)=>a.z-b.z);let leader=null;for(const c of group){let approach=carClosingSpeed(c);if(leader){const free=Math.max(0,c.z-leader.z-CFG.length-CFG.carGap);approach=Math.min(approach,leader.stepClosing+free/Math.max(dt,.0001))}c.stepClosing=approach;leader=c}}
}

function mult(v){return v>=280?5:v>=210?3:v>=115?2:1}
function resetInput(){keys.clear();touch.gas.clear();touch.brake.clear()}
function holding(type){return touch[type].size>0||(type==='gas'?(keys.has('ArrowUp')||keys.has('w')):(keys.has('ArrowDown')||keys.has('s')))}
function show(){const playing=mode==='playing'||mode==='paused'||mode==='crash';document.body.classList.toggle('playing',playing);$('menu').hidden=mode!=='menu';$('records').hidden=mode!=='menu';$('footer').hidden=mode!=='menu';$('hud').hidden=!playing;$('pause').hidden=mode!=='playing'&&mode!=='paused';$('modal').hidden=mode!=='paused'&&mode!=='over';$('nameLabel').hidden=mode!=='over';$('home').hidden=mode==='paused';if(mode==='paused'){$('resultLabel').textContent='PAUSED';$('resultTitle').textContent='일시정지';$('final').textContent='Ⅱ';$('resultMeta').textContent='재개 버튼 또는 Enter / Space';$('again').firstChild.textContent='계속하기 ';$('storage').textContent=''} }
function start(){variantCount=0;variantEvents=[];power=null;pickups=[];coinsCollected=coinBudget=tankKills=0;wrecks=[];debris=[];crashAge=0;audio.init();resetInput();speed=CFG.cruise;elapsed=score=travel=combo=maxCombo=nearCount=row=0;lane=1;x=prevX=-1.7;cars=[];initTraffic(freshTrafficSeed());setupPickups();ramps=[];rampSerial=0;for(const z of [155,550,950])rampCandidate(z);nextRamp=1400;jump=null;pendingLanding=jumpCount=passStreak=passWindow=flamePulse=0;nextRow=100;popTime=0;$('pop').textContent='';runId=Date.now().toString(36)+Math.random().toString(36).slice(2,7);nextRow=85;for(let i=0;i<9;i++){spawn(nextRow);nextRow+=rowSpacing()}nextVariantAt=CFG.variantMin+trafficRandom()*(CFG.variantMax-CFG.variantMin);mode='playing';lastStamp=null;accumulator=0;show()}
function spawn(z){
 // Randomize the traffic, while preserving a connected, reachable one-lane opening.
 if(row>0){let choices=[openingLane-1,openingLane,openingLane+1].filter(l=>l>=0&&l<4);if(openingRepeat>=1)choices=choices.filter(l=>l!==openingLane);const next=choices[Math.floor(trafficRandom()*choices.length)];openingRepeat=next===openingLane?openingRepeat+1:0;openingLane=next}
 const blocked=[0,1,2,3].filter(l=>l!==openingLane);
 if(trafficRandom()<.32)blocked.splice(Math.floor(trafficRandom()*blocked.length),1);
 for(const l of blocked){let spawnZ=z+trafficRandom()*10;const laneX=(l-1.5)*CFG.laneWidth;for(let tries=0;tries<=cars.length;tries++){const occupied=cars.find(c=>Math.abs(c.x-laneX)<.1&&Math.abs(c.z-spawnZ)<CFG.length+CFG.carGap);if(!occupied)break;spawnZ=occupied.z+CFG.length+CFG.carGap+.001}cars.push({x:(l-1.5)*CFG.laneWidth,z:spawnZ,type:Math.floor(trafficRandom()*3),color:['#bdc8d4','#4e647e','#b3a08c','#273545','#677e83'][Math.floor(trafficRandom()*5)],risk:0,riskSpeed:0,minGap:99,scored:false})}row++
}
function move(dir){if(mode==='playing'&&power?.phase!=='reveal'){lane=Math.max(0,Math.min(3,lane+dir))}}
function pause(){if(mode!=='playing')return;mode='paused';resetInput();audio.quiet();show()}
function resume(){if(mode!=='paused')return;mode='playing';resetInput();lastStamp=null;audio.init();show()}
function finish(crashed){mode='over';resetInput();audio.quiet();const entry={id:runId,name:records.name||'DRIVER',score:Math.round(score),order:Date.now()};newRecord=!records.top.length||entry.score>records.top[0].score;records.last=entry;records.top=[...records.top,entry].sort((a,b)=>b.score-a.score||a.order-b.order).slice(0,3);persist();rankings();$('nickname').value=entry.name;$('resultLabel').textContent=newRecord?'NEW PERSONAL BEST':crashed?'COLLISION / RUN OVER':'RUN OVER';$('resultTitle').textContent=crashed?'충돌!':'주행 완료!';$('final').textContent=entry.score.toLocaleString();$('resultMeta').textContent=`근접 회피 ${nearCount}회 · 최고 콤보 ${maxCombo} · 점프 ${jumpCount}회 · 탱크 격파 ${tankKills}대 · ${elapsed.toFixed(2)}초`;$('again').firstChild.textContent='다시하기 ';$('storage').textContent=storageOK?'이 브라우저에 기록을 저장했습니다.':'로컬 저장 불가 · 이번 기록은 유지되지 않습니다.';show()}

function jumpHeight(){if(!jump)return 0;const t=jump.time;if(t<.3)return 2.4*t/.3;const u=Math.min(1,(t-.3)/(CFG.jumpDuration-.3));return (1-u)*2.4+Math.sin(Math.PI*u)*4.4}
function beginJump(r){r.used=true;jump={time:0,speed,source:r.id};jumpCount++;$('pop').textContent='RAMP JUMP!';popTime=1;audio.tone(480,.3,.2)}
function rampCandidate(z){if(trafficRandom()<CFG.rampFrequency)ramps.push({x:(Math.floor(trafficRandom()*4)-1.5)*CFG.laneWidth,z:z+trafficRandom()*55,id:rampSerial++,used:false})}
function land(){
 pendingLanding=300*mult(jump.speed);jump=null;
 // The player owns the landing lane; no steering override, input lock, or traffic removal.
 // Award the landing only after the normal collision checks for this step.
}


function motionSpeed(){return speed*(power?.kind==='fly'&&power.phase==='active'?2:1)}
function playerHeight(){if(power?.kind==='fly'&&power.phase==='active'){const age=CFG.flyDuration-power.left;const up=Math.min(1,age/.32),down=Math.min(1,power.left/.48);return (4.4+Math.sin(age*6)*.13)*Math.sin(Math.PI/2*up)*Math.sin(Math.PI/2*down)}return jumpHeight()}
function setupPickups(){coinBudget=2+Math.floor(trafficRandom()*2);coinsCollected=0;const first=trafficRandom()<.5?'tank':'fly';pickups=Array.from({length:coinBudget},(_,id)=>({id,x:(Math.floor(trafficRandom()*4)-1.5)*CFG.laneWidth,z:(id+1)*(CFG.max/3.6)*CFG.coinInterval,kind:id%2===0?first:first==='tank'?'fly':'tank'}))}
function collectPower(c){
 if(coinsCollected>=Math.min(coinBudget,CFG.maxPickups)||power)return false;
 coinsCollected++;
 const source=project(c.x,1.15,c.z);power={launchSpeed:speed,kind:c.kind,phase:'reveal',reveal:0,left:c.kind==='tank'?CFG.tankDuration:CFG.flyDuration,source:{x:source.x,y:source.y,r:Math.max(15,source.s*.7)}};jump=null;pendingLanding=0;audio.quiet();audio.tone(880,.25,.2);$('pop').textContent='';popTime=0;return true;
}
function updatePickups(dt){
 const distance=motionSpeed()/3.6*dt;
 for(const c of pickups){const before=c.z;c.z-=distance;if(!power&&!jump&&before>=-2&&c.z<=2.5&&Math.abs(c.x-x)<1.25){if(collectPower(c)){c.collected=true}break}}
 pickups=pickups.filter(c=>!c.collected&&c.z>-12);
 // Each run has only 2–3 opportunities; missed coins are not replenished.
 if(coinsCollected>=coinBudget)pickups=[];
}
function drawPortrait(kind){
 const art=portraitArt[kind];if(art&&art.complete&&art.naturalWidth){ctx.drawImage(art,-1,-1,2,2);return}
 // Relief-style illustrations: a friendly military mascot and a censored tech-founder caricature.
 const army=kind==='tank';ctx.fillStyle=army?'#476948':'#263344';ctx.beginPath();ctx.ellipse(0,.6,.57,.45,0,0,Math.PI*2);ctx.fill();
 ctx.fillStyle='#f3c994';ctx.beginPath();ctx.ellipse(-.08,-.08,.37,.46,0,0,Math.PI*2);ctx.fill();
 ctx.fillStyle=army?'#344b32':'#534337';ctx.beginPath();ctx.moveTo(-.46,-.13);ctx.lineTo(-.43,-.49);ctx.quadraticCurveTo(-.08,-.8,.29,-.43);ctx.lineTo(.31,-.1);ctx.lineTo(.19,-.33);ctx.lineTo(.03,-.39);ctx.lineTo(-.14,-.34);ctx.closePath();ctx.fill();
 if(army){ctx.fillStyle='#66844e';ctx.beginPath();ctx.ellipse(-.08,-.43,.47,.2,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#b4bb76';ctx.fillRect(-.15,-.56,.14,.12);ctx.fillStyle='#243729';ctx.fillRect(-.48,-.34,.82,.07)}
 if(army){ctx.strokeStyle='#584638';ctx.lineWidth=.035;for(const ex of [-.22,.05]){ctx.beginPath();ctx.arc(ex,-.08,.06,Math.PI,Math.PI*2);ctx.stroke()}}else{ctx.fillStyle='#11151b';ctx.fillRect(-.44,-.18,.77,.17)}
 ctx.strokeStyle='#9d6246';ctx.lineWidth=.035;ctx.beginPath();ctx.arc(-.08,.05,.17,.15,Math.PI-.15);ctx.stroke();
 ctx.fillStyle='#fff2dc';if(!army){poly([{x:-.38,y:.34},{x:-.13,y:.47},{x:-.24,y:.67}],'#edf0ed');poly([{x:.2,y:.34},{x:-.05,y:.47},{x:.08,y:.67}],'#edf0ed')}
 // Raised right thumb, clearly separate from the face.
 ctx.fillStyle='#f3c994';ctx.beginPath();ctx.moveTo(.25,.65);ctx.lineTo(.26,.28);ctx.lineTo(.38,.1);ctx.lineTo(.38,-.12);ctx.quadraticCurveTo(.4,-.25,.49,-.17);ctx.lineTo(.53,.18);ctx.lineTo(.69,.18);ctx.quadraticCurveTo(.78,.2,.74,.36);ctx.lineTo(.67,.62);ctx.closePath();ctx.fill();ctx.strokeStyle='#bc8a56';ctx.lineWidth=.025;ctx.stroke();
 ctx.fillStyle=army?'#637e4d':'#3a526c';ctx.fillRect(.21,.59,.5,.16);
}
function drawCoin(cx,cy,r,kind,spin=0,alpha=1){
 ctx.save();ctx.globalAlpha=alpha;ctx.translate(cx,cy);ctx.rotate(Math.sin(spin*.4)*.06);ctx.scale(Math.max(.12,Math.abs(Math.cos(spin))),1);
 const g=ctx.createRadialGradient(-r*.35,-r*.4,r*.05,0,0,r);g.addColorStop(0,'#fff4bd');g.addColorStop(.55,'#f6cc62');g.addColorStop(1,'#ad6d23');ctx.fillStyle=g;ctx.strokeStyle='#ffe8a0';ctx.lineWidth=Math.max(1,r*.035);ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.strokeStyle='#9d6a28';ctx.lineWidth=r*.025;ctx.beginPath();ctx.arc(0,0,r*.85,0,Math.PI*2);ctx.stroke();
 ctx.save();ctx.beginPath();ctx.arc(0,0,r*.78,0,Math.PI*2);ctx.clip();ctx.scale(r*.85,r*.85);drawPortrait(kind);ctx.restore();
 ctx.fillStyle='#edc46c';ctx.beginPath();ctx.roundRect(-r*.46,r*.61,r*.92,r*.24,r*.06);ctx.fill();ctx.fillStyle='#61401c';ctx.textAlign='center';ctx.font=`900 ${r*.17}px Arial`;ctx.fillText(kind==='tank'?'TANK':'FLY ×2',0,r*.8);ctx.restore();
}
function drawPickup(c){const bob=Math.sin(travel*.09+c.id)*.15,p=project(c.x,1.25+bob,c.z),ground=project(c.x,.04,c.z);ctx.fillStyle='#f4d37825';ctx.beginPath();ctx.ellipse(ground.x,ground.y,.7*p.s,.18*p.s,0,0,Math.PI*2);ctx.fill();drawCoin(p.x,p.y,Math.max(6,p.s*.68),c.kind,Math.sin(travel*.025+c.id)*.5);if(c.z<110){ctx.fillStyle='#ffe7a4';ctx.font=`700 ${Math.max(10,p.s*.24)}px Arial`;ctx.textAlign='center';ctx.fillText(c.kind==='tank'?'TANK':'FLY ×2',p.x,p.y-p.s*.95)}}
function drawPowerReveal(){if(!power||power.phase!=='reveal')return;const t=Math.min(1,power.reveal/CFG.coinReveal),ease=v=>1-Math.pow(1-v,3),center={x:width*.5,y:height*.43},player=project(x,1,0);let a,b,u,ra,rb;if(t<.26){a=power.source;b=center;u=ease(t/.26);ra=power.source.r;rb=Math.min(width*.27,height*.19)}else if(t<.74){a=b=center;u=0;ra=rb=Math.min(width*.27,height*.19)}else{a=center;b=player;u=ease((t-.74)/.26);ra=Math.min(width*.27,height*.19);rb=18}ctx.fillStyle=`rgba(3,9,17,${Math.sin(t*Math.PI)*.42})`;ctx.fillRect(0,0,width,height);drawCoin(a.x+(b.x-a.x)*u,a.y+(b.y-a.y)*u,ra+(rb-ra)*u,power.kind,t*12,t>.9?(1-t)*10:1);if(t>.2&&t<.8){ctx.fillStyle='#fff0be';ctx.textAlign='center';ctx.font=`800 ${Math.min(30,width*.06)}px Arial`;ctx.fillText(power.kind==='tank'?'TANK MODE':'FLIGHT MODE',width*.5,height*.74);ctx.font='12px Arial';ctx.fillStyle='#d9e5ef';ctx.fillText(power.kind==='tank'?'4초 동안 차량 돌파 · 타이머 정지':'2배 속도로 2.6초 비행 · 타이머 정지',width*.5,height*.79)}}
function drawTank(c){const X=c.x,Z=c.z;world([[X-1.5,.03,Z-2.7],[X+1.5,.03,Z-2.7],[X+1.5,.03,Z+2.8],[X-1.5,.03,Z+2.8]],'#02080c90');for(const side of [-1,1]){world([[X+side*1.05,.18,Z-2.4],[X+side*1.48,.18,Z-2.4],[X+side*1.48,.72,Z+2.4],[X+side*1.05,.72,Z+2.4]],'#18251f');for(let i=0;i<12;i++){const z=Z-2.3+i*.4;line(project(X+side*1.06,.75,z),project(X+side*1.45,.75,z),'#879077',Math.max(1,project(X,0,z).s*.035))}}
 world([[X-1.18,.7,Z-2.2],[X+1.18,.7,Z-2.2],[X+1.1,1.15,Z+2.3],[X-1.1,1.15,Z+2.3]],'#6d8055');world([[X-1.18,.35,Z-2.2],[X+1.18,.35,Z-2.2],[X+1.18,.85,Z-2.1],[X-1.18,.85,Z-2.1]],'#41573e');world([[X-.8,1.05,Z-1],[X+.8,1.05,Z-1],[X+.65,1.8,Z+1.2],[X-.65,1.8,Z+1.2]],'#8d9b69');world([[X-.12,1.62,Z+.6],[X+.12,1.62,Z+.6],[X+.1,1.62,Z+4.2],[X-.1,1.62,Z+4.2]],'#b2bd8e');for(const side of [-1,1]){const a=project(X+side*.9,.65,Z-2.22);ctx.fillStyle='#ff7561';ctx.fillRect(a.x-.1*a.s,a.y,.2*a.s,.06*a.s)}
}
function drawFlyingCar(c){const X=c.x,Z=c.z,lift=playerHeight(),p=project(X,0,Z),s=p.s;world([[X-1.3,.03,Z-2.5],[X+1.3,.03,Z-2.5],[X+1.3,.03,Z+2.5],[X-1.3,.03,Z+2.5]],'#02081055');ctx.save();ctx.translate(0,-lift*s);world([[X-1.1,.4,Z-2.3],[X+1.1,.4,Z-2.3],[X+1,.85,Z+2.3],[X-1,.85,Z+2.3]],'#aabcc8');world([[X-1.1,.4,Z-2.3],[X+1.1,.4,Z-2.3],[X+.88,1.1,Z-1.6],[X-.88,1.1,Z-1.6]],'#dce4e7');world([[X-.88,1.1,Z-1.6],[X+.88,1.1,Z-1.6],[X+.65,1.45,Z+.8],[X-.65,1.45,Z+.8]],'#294558');world([[X-.65,1.45,Z+.8],[X+.65,1.45,Z+.8],[X+.95,.9,Z+2.3],[X-.95,.9,Z+2.3]],'#e1e6e6');for(const side of [-1,1]){world([[X+side*.95,.55,Z-.9],[X+side*1.75,.42,Z-1.4],[X+side*1.4,.45,Z+.8],[X+side*.95,.55,Z+1.1]],'#829daa');const a=project(X+side*.8,.3,Z-1.8);ctx.fillStyle='#a5eeff';ctx.shadowColor='#65dfff';ctx.shadowBlur=12;ctx.beginPath();ctx.ellipse(a.x,a.y,s*.17,s*.06,0,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0}line(project(X-.9,.65,Z-2.32),project(X+.9,.65,Z-2.32),'#ff6370',Math.max(2,s*.045));ctx.restore()}

function scatterImpact(wx,z,force=1){
 for(let i=0;i<20;i++){const a=i*2.39996;debris.push({x:wx,z,y:.7,vx:Math.cos(a)*(2+i%5)*force,vy:(2+i%7)*force,vz:Math.sin(a)*7,age:0,life:.5+(i%7)*.11,spark:i%3!==0})}
 if(debris.length>100)debris.splice(0,debris.length-100);
}

function crushWithTank(c){
 if(c.crushed||c.scored)return 0;
 const multiplier=mult(speed),bonus=CFG.tankCrushBonus*multiplier,value=100*multiplier+bonus;
 throwCar(c,'tank');c.crushed=true;c.scored=true;score+=value;tankKills++;combo=0;passStreak++;passWindow=3.2;flamePulse=1;
 $('pop').textContent=`격파! +${value.toLocaleString()}\n격파 보너스 +${bonus.toLocaleString()}`;popTime=.85;audio.impact(.16);audio.tone(220,.12,.1);return value;
}

function throwCar(c,source='trailer'){
 if(wrecks.length>=12)wrecks.shift();const side=c.x>=0?1:-1;
 wrecks.push({...c,isWreck:true,height:.2,vx:side*(source==='trailer'?6:4),vy:8.5,vz:-8,angle:0,spin:side*3.6,age:0,life:2.1,source});scatterImpact(c.x,c.z,.8);
 if(source==='trailer'&&Math.abs(c.z)<180)audio.impact(.12*Math.max(.15,1-Math.abs(c.z)/220));
}
function updateEffects(dt){
 for(const w of wrecks){w.age+=dt;w.x+=w.vx*dt;w.z+=w.vz*dt;w.height+=w.vy*dt;w.vy-=12*dt;w.angle+=w.spin*dt;if(w.height<.12){w.height=.12;w.vy=Math.abs(w.vy)*.27;w.spin*=.94}}
 wrecks=wrecks.filter(w=>w.age<w.life&&w.z>-12);
 for(const d of debris){d.age+=dt;d.x+=d.vx*dt;d.z+=d.vz*dt;d.y+=d.vy*dt;d.vy-=15*dt;if(d.y<.04){d.y=.04;d.vy=Math.abs(d.vy)*.2;d.vx*=.9}}
 debris=debris.filter(d=>d.age<d.life);
}
function startCrash(c){if(mode!=='playing')return;mode='crash';crashTime=CFG.crashDuration;crashAge=0;pendingLanding=0;resetInput();if(c){throwCar(c,'player');cars=cars.filter(v=>v!==c)}scatterImpact(x,1.8,1.1);audio.hit();show()}
function drawDebris(){for(const d of debris){const p=project(d.x,d.y,d.z);ctx.globalAlpha=Math.max(0,1-d.age/d.life);if(d.spark){ctx.strokeStyle='#ffd193';ctx.lineWidth=Math.max(1,p.s*.025);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-d.vx*p.s*.035,p.y+d.vy*p.s*.035);ctx.stroke()}else{ctx.fillStyle='#687886';ctx.fillRect(p.x,p.y,Math.max(1,p.s*.08),Math.max(1,p.s*.05))}}ctx.globalAlpha=1}

function updateRamps(dt){
 if(jump){jump.time+=dt;if(jump.time>=CFG.jumpDuration)land()}
 for(const r of ramps){const before=r.z;r.z-=(motionSpeed()-CFG.rampSpeed)/3.6*dt;
 // The truck travels with the player: its open rear deck faces the camera.
 cars=cars.filter(c=>{const predicted=c.z-(c.stepClosing??carClosingSpeed(c))*dt;const contact=Math.abs(c.x-r.x)<2.15&&Math.max(c.z,predicted)>r.z-2.2&&Math.min(c.z,predicted)<r.z+16.2;if(contact){throwCar(c);return false}return true});
 if(power?.kind==='tank'&&power.phase==='active'&&Math.abs(x-r.x)<1.7&&r.z<3&&r.z>-18){r.destroyed=true;scatterImpact(r.x,r.z,.7)}
 if(!r.destroyed&&!power&&!r.used&&!jump&&before>=-2&&r.z<=2&&Math.abs(x-r.x)<.9){if(speed>=CFG.jumpMin&&holding('gas')&&!holding('brake'))beginJump(r);else if(r.z<=.8){startCrash(null);return}}
 }
 ramps=ramps.filter(r=>!r.destroyed&&r.z>-32);
 nextRamp-=(motionSpeed()-CFG.rampSpeed)/3.6*dt;while(nextRamp<1000){rampCandidate(nextRamp);nextRamp+=450}
}

function update(dt){if(mode==='crash'){crashAge+=dt;crashTime-=dt;speed=Math.max(0,speed-dt*280);travel+=speed/3.6*dt*.2;updateEffects(dt*.65);if(crashTime<=0)finish(true);return}if(mode!=='playing'){if(mode==='menu')travel+=dt*18;return}if(power?.phase==='reveal'){power.reveal+=dt;if(power.reveal>=CFG.coinReveal){power.phase='active';audio.tone(power.kind==='tank'?110:660,.3,.2)}return}const freeTime=power?Math.min(dt,power.left):0;elapsed+=Math.max(0,dt-freeTime);if(power){power.left-=dt;if(power.left<=0){power=null;$('pop').textContent='';popTime=0}}updateEffects(dt);passWindow=Math.max(0,passWindow-dt);flamePulse=Math.max(0,flamePulse-dt*1.7);if(!passWindow)passStreak=0;prevX=x;const target=(lane-1.5)*CFG.laneWidth;const delta=Math.min(1,dt/CFG.laneTime*2.6);x+=(target-x)*delta;const braking=holding('brake'),gas=holding('gas');if(power?.kind==='fly'){speed=power.launchSpeed||speed}else if(braking)speed=Math.max(CFG.min,speed-CFG.brake*dt);else if(gas)speed=Math.min(CFG.max,speed+CFG.accel*dt);else speed+=(CFG.cruise-speed)*Math.min(1,dt*1.2);const relative=closingSpeed(),dist=motionSpeed()/3.6*dt;travel+=dist;updatePickups(dt);if(power?.phase==='reveal')return;updateVariants();prepareCarSpeeds(dt);updateRamps(dt);if(mode!=='playing')return;
for(const c of cars){const before=c.z,approach=c.stepClosing??carClosingSpeed(c);c.z-=approach*dt;const gap=Math.abs(c.x-x)-(CFG.playerWidth+CFG.carWidth)/2;const ttc=c.z/Math.max(.001,approach);const sweptX=Math.min(Math.abs(c.x-prevX),Math.abs(c.x-x),(c.x-prevX)*(c.x-x)<0?0:Infinity);if(!jump&&power?.kind!=='fly'&&before>=-CFG.length&&c.z<=CFG.length&&sweptX<((power?.kind==='tank'?2.7:CFG.playerWidth)+CFG.carWidth)/2-.19){if(power?.kind==='tank'){crushWithTank(c);continue}startCrash(c);return}if(!power&&!jump&&c.z>0&&ttc<.7&&gap<.15){const risk=1-ttc/.8;if(risk>c.risk){c.risk=risk;c.riskSpeed=speed}}if(!power&&!jump&&Math.abs(c.z)<5.5&&gap>=-.19&&gap<CFG.nearGap&&gap<c.minGap){c.minGap=gap;if(!c.risk){c.riskSpeed=speed}c.risk=Math.max(c.risk,.35+(1-Math.max(0,gap)/CFG.nearGap)*.55)}if(c.z<-CFG.length&&!c.scored){c.scored=true;const near=!power&&!jump&&c.risk>.3;combo=near?combo+1:0;maxCombo=Math.max(combo,maxCombo);if(near)nearCount++;const bonus=near?Math.round(100+200*c.risk):0;const value=Math.round((100+bonus)*mult(jump?jump.speed:near?c.riskSpeed:speed)*(1+Math.min(combo-1,5)*.08*(near?1:0)));score+=value;passStreak++;passWindow=3.2;flamePulse=Math.min(1.8,.65+passStreak*.075+(near?.35:0));audio.pass(near);if(near){$('pop').textContent=`${c.risk>.75?'CLOSE CALL':'NEAR MISS'} +${value.toLocaleString()}\n${combo>1?combo+' COMBO':''}`;popTime=1.05}}}
if(pendingLanding){score+=pendingLanding;$('pop').textContent=`CLEAN LANDING +${pendingLanding}`;popTime=1.3;audio.tone(125,.18,.25);pendingLanding=0}cars=cars.filter(c=>!c.crushed&&c.z>-24);nextRow-=relative*dt;while(nextRow<620){spawn(nextRow);nextRow+=rowSpacing()}popTime=Math.max(0,popTime-dt);if(!popTime)$('pop').textContent='';audio.update(motionSpeed(),braking)}
// All geometry uses one world-space perspective. Vehicle dimensions also drive collision.
let horizon=0,focal=0,camX=-2.8,visualX=-1.7,visualZ=5,sceneLift=0,vanish=.59,renderDt=1/60;
function project(wx,wy,z){const depth=Math.max(2,z+15),s=focal/depth;return{x:width*vanish+(wx-camX)*s,y:horizon+(4.8+sceneLift-wy)*s,s}}
function poly(points,fill){ctx.fillStyle=fill;ctx.beginPath();for(let i=0;i<points.length;i++){const p=points[i];if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y)}ctx.closePath();ctx.fill()}
function world(points,fill){const clipped=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],insideA=a[2]>=-13,insideB=b[2]>=-13;if(insideA)clipped.push(a);if(insideA!==insideB){const t=(-13-a[2])/(b[2]-a[2]);clipped.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,-13])}}if(clipped.length>=3)poly(clipped.map(p=>project(...p)),fill)}
function line(a,b,color,w=1){ctx.strokeStyle=color;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
function stripe(wx,z,w,len,color){world([[wx-w/2,.012,z],[wx+w/2,.012,z],[wx+w/2,.012,z+len],[wx-w/2,.012,z+len]],color)}
function rand(n){return Math.abs(Math.sin(n*127.1+311.7)*43758.5453)%1}
function building(wx,z,w,h,seed){const p=project(wx,0,z),top=project(wx,h,z),s=p.s;ctx.fillStyle=z>240?'#172638':'#101d2e';ctx.fillRect(p.x-w*s/2,top.y,w*s,h*s);poly([{x:p.x+w*s/2,y:top.y},{x:p.x+w*s*.75,y:top.y-1.5*s},{x:p.x+w*s*.75,y:p.y-1.5*s},{x:p.x+w*s/2,y:p.y}],'#0b1728');for(let a=0;a<Math.min(25,h/2);a++)for(let b=0;b<w/1.8;b++){if(rand(seed+a*17+b*2)>.55){ctx.fillStyle=rand(seed+a+b)>.8?'#aebcb768':'#7796b73b';ctx.fillRect(p.x-w*s*.4+b*1.7*s,top.y+2*s+a*2*s,.65*s,.45*s)}}if(seed%5===0){ctx.fillStyle='#ed625c';ctx.fillRect(p.x,top.y-2*s,1.2*s,1.2*s)}}
function car(c,player=false){const z=c.z,p=project(c.x,0,z),s=p.s,w=(player?1.92:CFG.carWidth)/2,L=(player?4.5:CFG.length)/2,roof=c.type===2?1.7:1.2,color=player?'#b51e30':(c.color||'#4e647e');
ctx.save();const lift=player?jumpHeight():(c.isWreck?c.height:0);if(player){const tilt=mode==='crash'?Math.sin(crashAge*2)*.46:mode==='playing'||mode==='paused'?(x-prevX)*-1.7:0;ctx.translate(p.x,p.y);ctx.rotate(tilt);ctx.translate(-p.x,-p.y)}
world([[c.x-w*(1.2-lift*.035),.02,z-L-.5],[c.x+w*(1.2-lift*.035),.02,z-L-.5],[c.x+w*1.2,.02,z+L+.5],[c.x-w*1.2,.02,z+L+.5]],'#02060b70');
if(c.isWreck){ctx.globalAlpha=Math.min(1,(c.life-c.age)/.4);ctx.translate(p.x,p.y-lift*s);ctx.rotate(c.angle);ctx.translate(-p.x,-p.y)}else if(player){ctx.translate(0,-lift*s)}
for(const side of [-1,1]){const light=player?'#ff263a':'#d8e9ff';const zz=player?z-L:z-L;const a=project(c.x+side*w*.7,.02,zz);const g=ctx.createLinearGradient(a.x,a.y,a.x,a.y+4*s);g.addColorStop(0,player?'#e5314050':'#d6e8ff35');g.addColorStop(1,'#b4d6f000');poly([{x:a.x-.14*s,y:a.y},{x:a.x+.14*s,y:a.y},{x:a.x+.4*s,y:a.y+5*s},{x:a.x-.4*s,y:a.y+5*s}],g)}
for(const side of [-1,1])for(const dz of [-1.35,1.3])world([[c.x+side*w,.18,z+dz-.43],[c.x+side*(w+.12),.18,z+dz-.43],[c.x+side*(w+.12),.65,z+dz+.43],[c.x+side*w,.65,z+dz+.43]],'#03070d');
const bodyGrad=ctx.createLinearGradient(p.x-w*s,p.y-1.5*s,p.x+w*s,p.y);bodyGrad.addColorStop(0,player?'#ec6070':color);bodyGrad.addColorStop(.4,color);bodyGrad.addColorStop(1,player?'#661426':'#243041');
world([[c.x-w,.42,z-L],[c.x+w,.42,z-L],[c.x+w,.82,z+L],[c.x-w,.82,z+L]],bodyGrad);
world([[c.x-w,.35,z-L],[c.x+w,.35,z-L],[c.x+w,.86,z-L+.25],[c.x-w,.86,z-L+.25]],player?'#861726':color);
world([[c.x-w,.83,z-L+.2],[c.x+w,.83,z-L+.2],[c.x+w*.74,roof,z-.5],[c.x-w*.74,roof,z-.5]],player?'#c13243':'#263e54');
if(player){const rearGlass=ctx.createLinearGradient(p.x,p.y-1.3*s,p.x,p.y-.8*s);rearGlass.addColorStop(0,'#637c96');rearGlass.addColorStop(.25,'#263f59');rearGlass.addColorStop(1,'#0a1828');world([[c.x-w*.82,.91,z-L+.56],[c.x+w*.82,.91,z-L+.56],[c.x+w*.66,roof+.012,z-.53],[c.x-w*.66,roof+.012,z-.53]],rearGlass);for(let k=0;k<4;k++)line(project(c.x-w*.67,.94+k*.045,z-1.5+k*.2),project(c.x+w*.67,.94+k*.045,z-1.5+k*.2),'#a6b7c322',Math.max(.5,s*.008))}
const glass=ctx.createLinearGradient(p.x,p.y-roof*s,p.x,p.y);glass.addColorStop(0,'#8098b1');glass.addColorStop(.3,'#263b53');glass.addColorStop(1,'#071421');world([[c.x-w*.73,roof,z-.45],[c.x+w*.73,roof,z-.45],[c.x+w*.68,roof+.05,z+.9],[c.x-w*.68,roof+.05,z+.9]],glass);
world([[c.x-w*.68,roof+.05,z+.9],[c.x+w*.68,roof+.05,z+.9],[c.x+w*.88,.9,z+1.8],[c.x-w*.88,.9,z+1.8]],color);
const front=project(c.x,.52,z-L);ctx.fillStyle=player?'#0c0e18':'#07101b';ctx.fillRect(front.x-w*s*.72,front.y-.08*s,w*s*1.44,.16*s);for(const side of [-1,1]){const a=project(c.x+side*w*.69,.72,z-L-.02);ctx.fillStyle=player?'#ff5a65':'#e4f3ff';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=player?5:8;ctx.fillRect(a.x-.21*s,a.y-.035*s,.42*s,.07*s);ctx.shadowBlur=0;if(player){ctx.fillStyle='#f7a8a9';ctx.fillRect(a.x-.18*s,a.y-.025*s,.3*s,.018*s)}}
for(const side of [-1,1])line(project(c.x+side*w*.87,.87,z-L+.3),project(c.x+side*w*.82,.94,z+1.7),player?'#ff8a964d':'#dce9ff40',Math.max(.5,s*.012));if(player){world([[c.x-w*.98,.9,z-L+.25],[c.x+w*.98,.9,z-L+.25],[c.x+w*.98,.94,z-L+.4],[c.x-w*.98,.94,z-L+.4]],'#d74b5c');line(project(c.x-w*.8,.4,z-L-.03),project(c.x+w*.8,.4,z-L-.03),'#ff87912e',Math.max(1,s*.018));const a=project(c.x,.44,z-L-.03);ctx.fillStyle='#a5afba';ctx.fillRect(a.x-.18*s,a.y,.36*s,.09*s);for(const side of [-1,1]){const e=project(c.x+side*.65,.29,z-L);ctx.fillStyle='#04080d';ctx.fillRect(e.x-.1*s,e.y,.2*s,.09*s)}}if(player&&(mode==='playing'||mode==='paused')&&(flamePulse>0||passStreak>=3&&passWindow>0)){drawExhaust(c,s,L)}if(player&&speed>180){for(const side of [-1,1]){const mist=ctx.createLinearGradient(p.x,p.y,p.x,p.y+3*s);mist.addColorStop(0,'#9db9d222');mist.addColorStop(1,'#9db9d200');world([[c.x+side*w,.08,z-L],[c.x+side*(w+.22),.08,z-L],[c.x+side*(w+.45),.04,z-L-2.5],[c.x+side*(w+.1),.04,z-L-2.5]],mist)}}ctx.restore()}


function drawExhaust(c,s,L){
 const level=Math.min(1,(passStreak+combo*2)/12),pulse=flamePulse+.12,clock=elapsed*40;
 const length=(.5+level*2+pulse*.7)*(1+Math.sin(clock)*.12);
 for(const side of [-1,1]){const xx=c.x+side*.65,zz=c.z-L-.07;
  const tip=project(xx,.28,zz-length),base=project(xx,.3,zz);
  const glow=ctx.createRadialGradient(base.x,base.y,0,base.x,base.y,Math.max(1,s*(.45+level*.2)));glow.addColorStop(0,'#ffae4a65');glow.addColorStop(1,'#ff402000');ctx.fillStyle=glow;ctx.fillRect(base.x-s,base.y-s,s*2,s*2);
  const width=.12+level*.12,outer=ctx.createLinearGradient(base.x,base.y,tip.x,tip.y);outer.addColorStop(0,level>.65?'#e9f1ff':'#fff3b0');outer.addColorStop(.3,level>.65?'#76b9ff':'#ffc14b');outer.addColorStop(.7,'#ff632bd0');outer.addColorStop(1,'#ff342000');
  world([[xx-width,.29,zz],[xx+width,.29,zz],[xx+width*.6,.25,zz-length*.48],[xx+Math.sin(clock+side)*width*.5,.2,zz-length],[xx-width*.7,.26,zz-length*.6]],outer);
  world([[xx-width*.45,.3,zz],[xx+width*.45,.3,zz],[xx,.26,zz-length*.65]],'#fff6dbd9');
 }
}

function drawRamp(r){
 const X=r.x,Z=r.z,W=1.28,L=14;
 world([[X-W-.2,.03,Z-1],[X+W+.2,.03,Z-1],[X+W+.2,.03,Z+L+3],[X-W-.2,.03,Z+L+3]],'#03081180');
 for(const side of [-1,1]){
  world([[X+side*W,.5,Z+1],[X+side*(W+.12),.5,Z+1],[X+side*(W+.12),.8,Z+L],[X+side*W,.8,Z+L]],'#245b99');
  for(const dz of [3,5,10,12]){const p=project(X+side*(W+.05),.45,Z+dz);ctx.fillStyle='#050912';ctx.beginPath();ctx.ellipse(p.x,p.y,p.s*.22,p.s*.43,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#68788b';ctx.beginPath();ctx.ellipse(p.x,p.y,p.s*.1,p.s*.23,0,0,Math.PI*2);ctx.fill()}
 }
 // Twin perforated loading tracks climb from the rear lip to a raised forward deck.
 for(const side of [-1,1]){
  const a=X+side*.8;
  world([[a-.37,.12,Z],[a+.37,.12,Z],[a+.37,2.5,Z+10],[a-.37,2.5,Z+10]],'#a7b3bd');
  world([[a-.37,2.5,Z+10],[a+.37,2.5,Z+10],[a+.37,2.5,Z+L],[a-.37,2.5,Z+L]],'#8d9cae');
  for(let i=1;i<22;i++){const z=i*.45,h=.12+z*.238;world([[a-.31,h+.015,Z+z],[a+.31,h+.015,Z+z],[a+.31,h+.065,Z+z+.16],[a-.31,h+.065,Z+z+.16]],i%2?'#3b536a':'#d2d8de')}
  for(const dz of [2,8,13]){line(project(X+side*W,.6,Z+dz),project(X+side*W,3.6,Z+dz),'#6b8098',Math.max(1,project(X,0,Z+dz).s*.09))}
  line(project(a-.4,.16,Z),project(a-.4,2.55,Z+10),'#dae4ed',Math.max(1,project(X,0,Z+5).s*.025));
 }
 for(const dz of [2,5,8,11,14])line(project(X-W,.65,Z+dz),project(X+W,.65,Z+dz),'#356aa5',Math.max(1,project(X,0,Z+dz).s*.1));
 // Rear chevrons and tail lamps make this truck's direction unambiguous.
 world([[X-W,.2,Z],[X+W,.2,Z],[X+W,.55,Z],[X-W,.55,Z]],'#294d7e');
 for(const side of [-1,1]){const p=project(X+side*1.1,.4,Z-.02);ctx.fillStyle='#ff4e59';ctx.fillRect(p.x-p.s*.09,p.y,p.s*.18,p.s*.08)}
 const p=project(X,3.7,Z+8);if(r.z>10&&!r.used){ctx.textAlign='center';ctx.font=`700 ${Math.max(10,Math.min(21,p.s*.38))}px Arial`;ctx.fillStyle=speed>=CFG.jumpMin?'#f6c57d':'#c6d4e5';ctx.fillText('JUMP ↑ 200+',p.x,p.y);const a=project(X,.04,Z-9),b=project(X,.04,Z-5),c=project(X,.04,Z-1);for(const v of [a,b,c]){poly([{x:v.x-v.s*.4,y:v.y},{x:v.x,y:v.y-v.s*.35},{x:v.x+v.s*.4,y:v.y},{x:v.x,y:v.y-v.s*.15}],'#e9b86a8a')}}
}

function render(){ctx.setTransform(dpr,0,0,dpr,0,0);ctx.save();if(mode==='crash'){const shake=Math.max(0,1-crashAge)*7;ctx.translate(Math.sin(crashAge*98)*shake,Math.cos(crashAge*83)*shake)}sceneLift+=((playerHeight()*.65)-sceneLift)*(1-Math.exp(-renderDt*8));horizon=height*.26;focal=Math.min(width*.95,height*1.28)*(1+Math.min(350,motionSpeed()-140)/1800);camX+=((mode==='menu'?-2.8:x*.3)-camX)*(1-Math.exp(-renderDt*5));visualX=mode==='menu'?-1.7:x;visualZ+=((mode==='menu'?5:0)-visualZ)*(1-Math.exp(-renderDt*5));vanish+=((mode==='menu'?.67:.5)-vanish)*(1-Math.exp(-renderDt*5));if(!skyCache){skyCache=document.createElement('canvas');skyCache.width=width*dpr;skyCache.height=height*dpr;const mainCtx=ctx;ctx=skyCache.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);skyCacheVanish=vanish;skyCacheCam=camX;const sky=ctx.createLinearGradient(0,0,0,horizon+80);sky.addColorStop(0,'#070e1d');sky.addColorStop(.65,'#15273f');sky.addColorStop(1,'#536379');ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);const moon=ctx.createRadialGradient(width*.77,height*.19,2,width*.77,height*.19,height*.24);moon.addColorStop(0,'#b3c7d12b');moon.addColorStop(1,'#b3c7d100');ctx.fillStyle=moon;ctx.fillRect(0,0,width,height*.5);
for(let layer=0;layer<3;layer++)for(let i=0;i<35;i++){const wx=(i-17)*17+(layer%2)*8;building(wx,260+layer*210,7+rand(i+layer)*10,10+rand(i*9+layer)*38,i+layer*36)}
ctx=mainCtx;}ctx.drawImage(skyCache,0,0,width,height);ctx.fillStyle='#111d2c';ctx.fillRect(0,horizon+20,width,height);world([[-7.5,0,-15],[7.5,0,-15],[7.5,0,1200],[-7.5,0,1200]],'#192638');const road=ctx.createLinearGradient(0,horizon,0,height);road.addColorStop(0,'#435367');road.addColorStop(.22,'#26384b');road.addColorStop(1,'#121c2a');world([[-6.8,0,-15],[6.8,0,-15],[6.8,0,1500],[-6.8,0,1500]],road);
for(let i=0;i<550;i++){const z=i*5-(travel%5);const shade=i%3===0?'#a8bed00b':'#02081713';stripe((rand(i*3)-.5)*13,z,.015+rand(i)*.09,.5+rand(i+4)*2,shade)}
for(let side of [-1,1]){stripe(side*6.55,-15,.11,1200,'#c8d6dfb0');world([[side*7,0,-15],[side*7,1.05,-15],[side*7,1.05,1000],[side*7,0,1000]],'#26384b');world([[side*7,1.03,-15],[side*7.2,1.03,-15],[side*7.2,1.03,1000],[side*7,1.03,1000]],'#8293a4');for(let rail of [.4,.8])line(project(side*7,rail,-14),project(side*7,rail,900),'#6c7e9360',1.5)}
for(let i=0;i<75;i++){const z=i*12-(travel%12);for(let l=-1;l<=1;l++)stripe(l*3.4,z,.1,5,'#b3c1d180')}
for(let i=20;i>=0;i--){const z=i*32-(travel%32);if(z<-10)continue;for(let side of [-1,1]){const base=project(side*8,0,z),top=project(side*8,8,z),arm=project(side*5.8,8.5,z);line(base,top,'#63788d',Math.max(.6,top.s*.07));line(top,arm,'#63788d',Math.max(.5,top.s*.06));ctx.fillStyle='#e1edff';ctx.shadowColor='#c7dcff';ctx.shadowBlur=Math.min(16,top.s*.8);ctx.fillRect(arm.x-.3*arm.s,arm.y,.6*arm.s,.06*arm.s);ctx.shadowBlur=0;const glow=ctx.createLinearGradient(base.x,base.y,base.x,base.y+height*.35);glow.addColorStop(0,'#bfd4eb13');glow.addColorStop(1,'#bfd4eb00');world([[side*4.7,.015,z-10],[side*6.2,.015,z-10],[side*6.2,.015,z+5],[side*4.7,.015,z+5]],glow);const post=project(side*7,1,z);ctx.fillStyle=i%4===0?'#e9645a':'#ccdae6';ctx.fillRect(post.x,post.y,.06*post.s,.18*post.s)}}
for(let side of [-1,1])for(let i=30;i>=0;i--){const z=i*16-(travel%16);if(z<0)continue;world([[side*9,0,z],[side*9,2.7,z],[side*9,2.7,z+15.5],[side*9,0,z+15.5]],i%2?'#1d2e42':'#23364a');line(project(side*9,2.7,z),project(side*9,2.7,z+15.5),'#6b82944d',1);line(project(side*9,0,z),project(side*9,2.8,z),'#4e6478',Math.max(.5,project(0,0,z).s*.06))}
// Overhead gantries and sound barriers anchor the road in the city.
for(let n=2;n>=0;n--){const z=180+n*240-(travel%240);for(let side of [-1,1]){line(project(side*7.4,0,z),project(side*7.4,11,z),'#52667b',Math.max(1,project(0,0,z).s*.15))}world([[-7.4,10.5,z],[7.4,10.5,z],[7.4,11,z],[-7.4,11,z]],'#4a5b6e');world([[-3.6,9.3,z-.1],[3.6,9.3,z-.1],[3.6,10.7,z-.1],[-3.6,10.7,z-.1]],'#173f4b');const p=project(0,10.1,z-.2);ctx.fillStyle='#d9e4e5';ctx.font=`600 ${Math.max(4,p.s*.38)}px Arial`;ctx.textAlign='center';ctx.fillText('도심순환  /  CITY EXPRESSWAY',p.x,p.y);ctx.font=`${Math.max(4,p.s*.38)}px Arial`;ctx.fillText('↓     ↓     ↓     ↓',p.x,p.y+p.s*.52)}
const preview=mode==='menu'?Array.from({length:18},(_,i)=>({x:([0,2,3,1,3,0][i%6]-1.5)*3.4,z:50+i*24-(travel%24),color:['#cad5dc','#3a4e68','#a29a91'][i%3],type:i%3})):cars;for(const c of [...preview,...(mode==='menu'?[]:pickups.filter(c=>c.z<500).map(c=>({...c,isPickup:true}))),...(mode==='menu'?[]:wrecks),...(mode==='menu'?[]:ramps.map(r=>({...r,isRamp:true}))),{x:visualX,z:visualZ,type:0,isPlayer:true}].sort((a,b)=>(jump||power?.kind==='fly')&&(a.isPlayer||b.isPlayer)?(a.isPlayer?1:-1):b.z-a.z))if(c.z>(c.isRamp?-25:-10)){if(c.isPickup)drawPickup(c);else if(c.isRamp)drawRamp(c);else if(c.isPlayer&&power?.phase==='active'&&power.kind==='tank')drawTank(c);else if(c.isPlayer&&power?.phase==='active'&&power.kind==='fly')drawFlyingCar(c);else car(c,!!c.isPlayer)}
drawDebris();if(mode==='crash'){const p=project(x,.8,1);for(let i=0;i<8;i++){ctx.fillStyle=`rgba(95,105,116,${Math.max(0,.13-crashAge*.04)})`;ctx.beginPath();ctx.arc(p.x+Math.sin(i*4.2)*p.s*(.15+crashAge*.7),p.y-crashAge*p.s*(.7+i*.08),p.s*(.1+crashAge*.22),0,Math.PI*2);ctx.fill()}}
const vig=ctx.createRadialGradient(width*.58,height*.5,height*.3,width*.58,height*.5,width*.8);vig.addColorStop(0,'#02071200');vig.addColorStop(1,'#020712b0');ctx.fillStyle=vig;ctx.fillRect(0,0,width,height);if(mode==='crash'){ctx.fillStyle=`rgba(244,46,62,${Math.max(0,.24-crashAge*.7)})`;ctx.fillRect(0,0,width,height)}
ctx.restore();document.body.classList.toggle('revealing',power?.phase==='reveal'&&mode!=='over');drawPowerReveal();const powerHUD=$('powerStatus');powerHUD.hidden=!power;if(power)powerHUD.textContent=power.phase==='reveal'?'ITEM GET · 타이머 정지':`${power.kind==='tank'?'TANK':'FLY ×2'}  ${Math.max(0,power.left).toFixed(1)}초 · 타이머 정지`;const streak=$('streak');streak.hidden=passStreak<2||passWindow<=0;streak.textContent=`${passStreak} 연속 추월${combo>1?' · NEAR ×'+combo:''}`;streak.classList.toggle('hot',passStreak>=6||combo>=3);$('trafficPressure').textContent=`상대 접근 ×${((difficulty==='hard'?CFG.hardFactor:1)*trafficPressure()).toFixed(2)}`;$('score').textContent=Math.round(score).toLocaleString();$('time').textContent=`${Math.floor(elapsed/60)}:${(elapsed%60).toFixed(1).padStart(4,'0')}`;$('speed').textContent=Math.round(motionSpeed());$('mult').textContent='×'+mult(speed);$('meter').style.width=(speed/CFG.max*100)+'%';$('combo').textContent=power?'아이템 사용 중 · 주행 시간 제외':jump?'점프 중 · ← →로 이동 가능':combo>1?`${combo} COMBO`:'근접 회피로 추가 점수';$('gear').textContent=power?power.kind==='fly'?'FLY ×2':'TANK':jump?'AIRBORNE':holding('brake')?'BRAKING':speed>=280?'REDLINE':holding('gas')?'ACCELERATING':'CRUISE'}
const audio={context:null,muted:records.muted,init(){if(!this.context){try{const A=window.AudioContext||window.webkitAudioContext;this.context=new A();const ac=this.context;this.master=ac.createGain();this.master.connect(ac.destination);this.engine=ac.createOscillator();this.engine.type='sawtooth';this.engineGain=ac.createGain();const filter=ac.createBiquadFilter();filter.type='lowpass';filter.frequency.value=330;this.engine.connect(filter);filter.connect(this.engineGain);this.engineGain.connect(this.master);this.engine.start();const buffer=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;this.wind=ac.createBufferSource();this.wind.buffer=buffer;this.wind.loop=true;const wf=ac.createBiquadFilter();wf.type='lowpass';wf.frequency.value=950;this.windGain=ac.createGain();this.wind.connect(wf);wf.connect(this.windGain);this.windGain.connect(this.master);this.wind.start()}catch{return}}this.context.resume();this.master.gain.value=this.muted?0:.35;this.quiet();this.label()},label(){$('mute').textContent=this.muted?'SOUND OFF':'SOUND ON'},quiet(){if(this.context){this.engineGain.gain.setTargetAtTime(0,this.context.currentTime,.04);this.windGain.gain.setTargetAtTime(0,this.context.currentTime,.04)}},update(v,b){if(!this.context)return;const t=this.context.currentTime;this.engine.frequency.setTargetAtTime(35+v*.35,t,.08);this.engineGain.gain.setTargetAtTime(b?.025:.045,t,.1);this.windGain.gain.setTargetAtTime(v/CFG.max*.15,t,.1)},tone(freq,duration,volume=.15){if(!this.context)return;const ac=this.context,o=ac.createOscillator(),g=ac.createGain(),t=ac.currentTime;o.type='sine';o.frequency.setValueAtTime(freq,t);o.frequency.exponentialRampToValueAtTime(freq*.55,t+duration);g.gain.setValueAtTime(volume,t);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.connect(g);g.connect(this.master);o.start();o.stop(t+duration)},pass(near){this.tone(near?860:120,near?.16:.09,near?.17:.07);if(near&&combo>1)this.tone(1120,.2,.06)},impact(volume=.25){if(!this.context)return;const ac=this.context,t=ac.currentTime,n=ac.createBufferSource(),g=ac.createGain(),f=ac.createBiquadFilter();n.buffer=this.wind.buffer;f.type='highpass';f.frequency.value=500;g.gain.setValueAtTime(volume,t);g.gain.exponentialRampToValueAtTime(.001,t+.55);n.connect(f);f.connect(g);g.connect(this.master);n.start();n.stop(t+.6)},hit(){this.quiet();this.tone(65,.5,.7);this.impact(.7)}};
for(const button of document.querySelectorAll('[data-mode]'))button.onclick=()=>selectMode(button.dataset.mode);
audio.label();$('mute').onclick=()=>{audio.muted=!audio.muted;records.muted=audio.muted;persist();audio.init();audio.label()};$('start').onclick=start;$('again').onclick=()=>mode==='paused'?resume():start();$('home').onclick=()=>{mode='menu';resetInput();show();rankings()};$('pause').onclick=pause;$('nickname').addEventListener('input',()=>{const name=$('nickname').value.trim().slice(0,10)||'DRIVER';records.name=name;if(records.last?.id===runId)records.last.name=name;for(const r of records.top)if(r.id===runId)r.name=name;persist();rankings()});
window.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement)return;const k=e.key.length===1?e.key.toLowerCase():e.key;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','Enter','Escape','a','d','w','s'].includes(k))e.preventDefault();if(!e.repeat){if(k==='Enter'||k===' '){if(mode==='menu'||mode==='over')start();else if(mode==='paused')resume()}if(k==='Escape'){if(mode==='playing')pause();else if(mode==='paused')resume()}if(k==='ArrowLeft'||k==='a')move(-1);if(k==='ArrowRight'||k==='d')move(1)}keys.add(k)});window.addEventListener('keyup',e=>keys.delete(e.key.length===1?e.key.toLowerCase():e.key));window.addEventListener('blur',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause()});
for(const button of document.querySelectorAll('[data-lane]'))button.addEventListener('pointerdown',e=>{e.preventDefault();move(Number(button.dataset.lane))});for(const button of document.querySelectorAll('[data-hold]')){const type=button.dataset.hold;button.addEventListener('pointerdown',e=>{e.preventDefault();if(mode==='playing'){touch[type].add(e.pointerId);button.setPointerCapture(e.pointerId)}});for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,e=>touch[type].delete(e.pointerId))}
function resize(){skyCache=null;width=innerWidth;height=innerHeight;dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr)}window.addEventListener('resize',resize);resize();rankings();show();function frame(stamp){const dt=lastStamp===null?0:Math.max(0,(stamp-lastStamp)/1000);lastStamp=stamp;renderDt=Math.min(dt,.25);accumulator+=Math.min(dt,2);while(accumulator>=1/120){update(1/120);accumulator-=1/120}render();requestAnimationFrame(frame)}requestAnimationFrame(frame);
// Read-only diagnostics for smoke tests and tuning, no gameplay bypass.
window.redline={config:CFG,snapshot:()=>({mode,speed,motionSpeed:motionSpeed(),power:power?{...power}:null,coinsCollected,coinBudget,tankKills,pickups:pickups.map(c=>({...c})),elapsed,score,lane,x,trafficSeed,difficulty,nextVariantAt,variantCount,variantEvents:variantEvents.map(v=>({...v})),trafficPressure:trafficPressure(),wrecks:wrecks.map(w=>({...w})),debrisCount:debris.length,cars:cars.map(c=>({...c})),combo,nearCount,ramps:ramps.map(r=>({...r})),jump:jump?{...jump,height:jumpHeight()}:null,jumpCount,passStreak,flamePulse})};
