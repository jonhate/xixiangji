/* 掌中戏 · 演出、声音和两根独立影签 */
(() => {
  'use strict';
  const story = window.SHADOWPLAY_STORY;
  const el = id => document.getElementById(id);
  const app = el('app'), stage = el('stage');
  const actors = {zhang: el('zhang'), ying: el('ying')};
  const names = Object.keys(actors);
  const scores = [...el('score').children];
  const bg = story.map((_, i) => el('bg' + i));
  const clamp = (v, low, high) => Math.min(high, Math.max(low, v));
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const cast = {
    zhang: {x:.54, y:.53, lastMove:-Infinity, angles:[]},
    ying:  {x:.73, y:.53, lastMove:-Infinity, angles:[]}
  };
  const entrances = [[.34,.68],[.35,.68],[.34,.69],[.40,.62]];
  const cueText = {
    move: ['移步入庭', '向左或向右移动一只手，让张生走出第一步。', '左右拖动张生，或按方向键。'],
    bow: ['作揖见礼', '双手在胸前靠拢，停留半秒。', '按 B 或点「作揖见礼」。'],
    approach: ['花下相会', '双手先分开，再向中间合拢，让两道影子相会。', '把张生向右拖，或把莺莺向左拖。也可按方向键。'],
    flourish: ['举袖亮相', '同时举高双手，停留半秒，让两位影人举袖。', '按 L 或点「举袖亮相」。']
  };
  const completedLine = {move:'张生缓步入庭。',bow:'张生拱手，莺莺回礼。',approach:'两道影子在花下相会。',flourish:'双袖舒展，一拜谢幕。'};
  const voice = new Audio(), music = new Audio();
  music.loop = true; music.volume = .18; voice.volume = .9;
  const media = path => window.SHADOWPLAY_PORTABLE?.media?.[path] || path;
  let state = 'idle', scene = -1, beat = -1, pending = null, epoch = 0;
  let timer = 0, fast = false, muted = false, voiceMode = 'offline', currentSpeech = null;
  let spokenBy = '', performed = '', gateOrigin = {}, manualOrigin = null, drag = null;
  let frame = 0, lastFrame = 0, stageWidth = 1;
  const allowed = () => ['speaking','action','performing'].includes(state);
  const stateInfo = () => ({actIndex:scene,beatIndex:beat,state,pending,epoch,caption:el('caption').textContent,voiceMode,progress:el('progressFill').style.width});
  const positions = () => ({zhang:cast.zhang.x,ying:cast.ying.x});
  const span = () => cast.ying.x - cast.zhang.x;
  function place(name, x, y) {
    const c = cast[name];
    if (Number.isFinite(x)) {
      const next = clamp(x,name === 'zhang' ? .14 : .37,name === 'zhang' ? .63 : .87);
      if (Math.abs(next-c.x) > .0018) c.lastMove=performance.now();
      c.x=next;
      actors[name].style.setProperty('--place',(next*100).toFixed(3)+'%');
    }
    if (Number.isFinite(y)) c.y=clamp(y,.04,.96);
  }
  function placeTracked(points) {
    if (!allowed()) return false;
    for (const name of names) if(points[name]) place(name,points[name].x,points[name].y);
    return true;
  }
  function changePose(now) {
    frame=0;
    if(document.hidden || !['speaking','action','performing','ending','transition'].includes(state)) return;
    const dt=Math.min(.09,Math.max(.001,(now-lastFrame)/1000)); lastFrame=now;
    const ease=1-Math.exp(-dt*15);
    for (const name of names) {
      const c=cast[name], sign=name==='zhang'?1:-1, talking=spokenBy===name;
      const walking=!reducedMotion.matches && now-c.lastMove<230;
      const lift=clamp((.53-c.y)*92,-27,39);
      const greeting=performed==='bow', finale=performed==='flourish';
      const step=walking?Math.sin(now*.024+(sign===1?0:1.4)):0;
      const nod=talking&&!reducedMotion.matches?Math.sin(now*.004)*1.9:0;
      const targets=[
        sign*((finale?-37:greeting?-21:talking?-4:0)-lift*.88),
        sign*((finale?29:greeting?10:0)+lift*.55),
        sign*((finale?-19:greeting?-17:3)-lift*.26),
        sign*((finale?17:greeting?10:0)+lift*.24),
        sign*(greeting?12:finale?-5:nod),sign*(greeting?9:finale?-2:0)+step*1.5,step*2.8
      ];
      const props=['--front-shoulder','--rear-shoulder','--front-elbow','--rear-elbow','--neck','--body-bow','--bob'];
      for(let i=0;i<props.length;i++) {
        const old=c.angles[i]||0, value=old+(targets[i]-old)*ease;
        if(Math.abs(value-old)>.015 || c.angles[i]===undefined){
          c.angles[i]=value; actors[name].style.setProperty(props[i],value.toFixed(2)+(i===6?'px':'deg'));
        }
      }
    }
    frame=requestAnimationFrame(changePose);
  }
  function requestPose(){if(!frame&&!document.hidden){lastFrame=performance.now();frame=requestAnimationFrame(changePose);}}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden) requestPose();});
  function stopVoice(){
    voice.onended=voice.onerror=null;voice.pause();
    if(currentSpeech){currentSpeech.onend=currentSpeech.onerror=null;currentSpeech=null;window.speechSynthesis?.cancel();}
  }
  function invalidate(){
    ++epoch;clearTimeout(timer);stopVoice();spokenBy='';performed='';pending=null;manualOrigin=null;drag=null;
    return epoch;
  }
  function later(fn, ms, token=epoch){
    clearTimeout(timer);
    timer=setTimeout(()=>{if(token===epoch)fn();},fast?Math.min(ms,35):ms);
  }
  function setLine(who,line,detail=''){
    el('speaker').textContent=who;el('caption').textContent=line;el('tip').textContent=detail;
    spokenBy=who==='张生'?'zhang':who==='莺莺'?'ying':'';
  }
  function setProgress(){
    const total=story.reduce((sum,act)=>sum+act.beats.length,0);
    const passed=scene<0?0:story.slice(0,scene).reduce((sum,act)=>sum+act.beats.length,0)+Math.max(0,beat);
    const pct=state==='finished'?100:Math.round(passed*100/total);
    el('progressFill').style.width=pct+'%';
    el('progressText').textContent=state==='finished'?'演出完成':scene<0?'静候启幕':story[scene].title+' · '+(scene+1)+'/4';
    el('chapterIndex').textContent=scene<0?'四景 · 一出':'第 '+(scene+1)+' / 4 景';
    scores.forEach((li,i)=>{li.classList.toggle('done',i<scene||state==='finished'); if(i===scene)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
  }
  function setMeter(fraction,label=''){
    if(state!=='action') return;
    const n=clamp(Math.round(fraction*100),0,100), m=el('actionMeter');
    if(m.getAttribute('aria-valuenow')!==String(n)){m.setAttribute('aria-valuenow',n);el('actionFill').style.transform='scaleX('+n/100+')';}
    if(el('actionHelp').textContent!==label)el('actionHelp').textContent=label;
  }
  function updateInput(){
    const live=!!window.SHADOWPLAY_RIG_V6?.getState().active;
    if(state==='action'){
      el('tip').textContent=cueText[pending][2];
      el('gesture').hidden=!live;
      el('actionTitle').textContent=cueText[pending][0];
      if(!live) setMeter(0,'');
    }
  }
  function sync(){
    app.dataset.state=state; app.dataset.scene=Math.max(scene,0);
    const waiting=state==='idle'||state==='finished';
    el('startveil').classList.toggle('off',!waiting);
    el('start').hidden=el('startCamera').hidden=!waiting;
    el('skipLine').hidden=state!=='speaking';
    el('nextBeat').disabled=el('nextScene').disabled=!allowed();
    el('nextBeat').textContent=state==='action'?'略过本动作':'跳过本句';
    el('nextScene').textContent=scene===3?'直接谢幕':'直接换景';
    el('replay').disabled=state==='idle';
    el('move').hidden=!['move','approach'].includes(pending);
    el('move').textContent=pending==='approach'?'两人靠近':'移步入庭';
    el('bow').hidden=pending!=='bow';el('flourish').hidden=pending!=='flourish';
    el('gesture').hidden=true;
    el('chapterTime').textContent={idle:'静候启幕',transition:'换景',speaking:'对白',action:'轮到你操影',performing:'动作已完成',ending:'谢幕',finished:'四景已演毕'}[state];
    setProgress();updateInput();requestPose();
  }
  function playMusic(){
    music.pause();music.src=media('music'+(scene+1)+'.mp3');music.muted=muted;
    if(!muted)music.play().catch(()=>{});
  }
  function speak(line){
    const token=epoch, duration=(line.duration||5)*1000;
    // The subtitle clock also drives blocked playback, muted playback and missing system voices.
    later(()=>next(),duration+250,token);
    if(fast||muted) return;
    const ended=()=>{if(epoch===token)later(()=>next(),280,token);};
    if(voiceMode==='system' && window.speechSynthesis && window.SpeechSynthesisUtterance){
      const phrase=new SpeechSynthesisUtterance(line.text);currentSpeech=phrase;phrase.lang='zh-CN';phrase.rate=1.04;
      phrase.pitch=line.who==='莺莺'?1.12:line.who==='张生'?.92:1;
      phrase.onend=ended;phrase.onerror=()=>{};window.speechSynthesis.speak(phrase);
    } else {
      voice.src=media(line.src);voice.muted=muted;voice.onended=ended;
      voice.play().then(()=>{if(epoch===token&&state==='speaking'&&Number.isFinite(voice.duration))later(()=>next(),(voice.duration-voice.currentTime)*1000+900,token);}).catch(()=>{});
    }
  }
  function next(){
    const token=invalidate();
    if(++beat>=story[scene].beats.length){changeScene(scene+1);return;}
    const line=story[scene].beats[beat];
    if(line.who==='action'){
      state='action';pending=line.action;gateOrigin=positions();
      const data=cueText[pending];setLine('执影人',data[1],data[2]);sync();setMeter(0,'等待手势');return;
    }
    state='speaking';setLine(line.who==='旁白'?'说书人':line.who,line.text);sync();
    if(epoch===token)speak(line);
  }
  function finish(){
    invalidate();state='ending';performed='bow';setLine('说书人','一灯照千年，一手演悲欢。');sync();
    later(()=>{
      state='finished';performed='';music.pause();
      window.SHADOWPLAY_RIG_V6?.stopCamera();
      for(const [name,x] of [['zhang',.54],['ying',.73]]){place(name,x,.53);cast[name].angles=[];actors[name].removeAttribute('style');place(name,x,.53);}
      el('coverKicker').textContent='四景演毕';el('coverTitle').textContent='曲终影未散';el('coverSubtitle').textContent='今夜月下，多谢执影。';
      el('startCamera').textContent='再用手势演一出';el('start').textContent='触屏或键盘重演';
      setLine('谢幕','张生与莺莺，向执影人谢幕。');sync();
    },1600);
  }
  function changeScene(i){
    if(i>=story.length){finish();return;}
    invalidate();scene=i;beat=-1;state='transition';
    const act=story[i];el('curtainMood').textContent=act.chapter+' · '+act.mood;el('curtainTitle').textContent=act.title;el('curtain').classList.add('on');
    el('ying').classList.toggle('hide-in-act1',i===0);
    bg.forEach((img,j)=>img.classList.toggle('active',j===i));
    names.forEach((name,j)=>{place(name,entrances[i][j],.53);cast[name].lastMove=-Infinity;});
    setLine('换景',act.title);playMusic();sync();
    later(()=>{el('curtain').classList.remove('on');next();},i===0?900:850);
  }
  function begin(){el('settings').open=false;window.SHADOWPLAY_RIG_V6?.cancelAutoStart?.();changeScene(0);}
  function action(type){
    if(state!=='action'||!(type===pending||(pending==='approach'&&type==='move'))) return false;
    const done=pending;
    if(done==='move' && Math.abs(cast.zhang.x-gateOrigin.zhang)<.035) place('zhang',gateOrigin.zhang+.075);
    if(done==='approach' && (gateOrigin.ying-gateOrigin.zhang)-span()<.065){place('zhang',cast.zhang.x+.055);place('ying',cast.ying.x-.055);}
    invalidate();state='performing';performed=done;
    setLine('说书人',completedLine[done]);sync();
    later(next,done==='bow'||done==='flourish'?1150:850);
    return true;
  }
  function afterManualMove(){
    if(pending==='move' && Math.abs(cast.zhang.x-gateOrigin.zhang)>=.048) action('move');
    if(pending==='approach' && (gateOrigin.ying-gateOrigin.zhang)-span()>=.075) action('approach');
  }
  function move(delta){
    if(!allowed()||!Number.isFinite(delta))return false;
    if(pending==='approach'){
      const half=Math.abs(delta)*.65;place('zhang',cast.zhang.x+half);place('ying',cast.ying.x-half);
    }else place('zhang',cast.zhang.x+delta);
    afterManualMove();return true;
  }
  function setGesturePosition(x){
    if(!allowed()||!Number.isFinite(x))return false;
    if(!manualOrigin){manualOrigin={x,actor:cast.zhang.x};return false;}
    const old=cast.zhang.x;place('zhang',manualOrigin.actor+(x-manualOrigin.x)*.88);
    if(pending==='move'&&Math.abs(cast.zhang.x-gateOrigin.zhang)>=.048)action('move');
    return Math.abs(old-cast.zhang.x)>.0001;
  }
  function advanceBeat(){if(!allowed())return false;next();return true;}
  function advanceScene(){if(!allowed())return false;changeScene(scene+1);return true;}
  el('start').onclick=()=>{window.SHADOWPLAY_RIG_V6?.stopCamera();begin();};
  el('move').onclick=()=>action(pending);el('bow').onclick=()=>action('bow');el('flourish').onclick=()=>action('flourish');
  el('replay').onclick=begin;el('nextScene').onclick=()=>{el('settings').open=false;advanceScene();};
  el('nextBeat').onclick=()=>{el('settings').open=false;advanceBeat();};el('skipLine').onclick=advanceBeat;
  el('audioToggle').onclick=()=>{
    muted=!muted;music.muted=voice.muted=muted;el('audioToggle').textContent=muted?'开启声音':'静音';
    el('audioToggle').setAttribute('aria-pressed',String(muted));
    if(muted && currentSpeech){currentSpeech.onend=null;window.speechSynthesis.cancel();currentSpeech=null;}
    if(!muted&&scene>=0&&state!=='finished') music.play().catch(()=>{});
  };
  el('voiceToggle').onclick=()=>{
    voiceMode=voiceMode==='offline'?'system':'offline';el('voiceToggle').textContent=voiceMode==='offline'?'配音 · 原声':'配音 · 系统语音';
  };
  const full=el('fullScreen');
  if(!document.documentElement.requestFullscreen||document.fullscreenEnabled===false)full.hidden=true;
  full.onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{}el('settings').open=false;};
  document.addEventListener('fullscreenchange',()=>{full.textContent=document.fullscreenElement?'退出全屏':'进入全屏';});
  document.addEventListener('pointerdown',e=>{if(!el('settings').contains(e.target))el('settings').open=false;});
  stage.addEventListener('pointerdown',e=>{
    if(!allowed()||drag||e.button!==0)return;
    const rect=stage.getBoundingClientRect(), point=(e.clientX-rect.left)/rect.width;
    let who=e.target.closest?.('.actor')?.id;
    if(!who||scene===0)who=scene===0||Math.abs(point-cast.zhang.x)<Math.abs(point-cast.ying.x)?'zhang':'ying';
    drag={id:e.pointerId,name:who,from:e.clientX,x:cast[who].x};
    stageWidth=rect.width;stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const rect=stage.getBoundingClientRect();
    place(drag.name,drag.x+(e.clientX-drag.from)/stageWidth,(e.clientY-rect.top)/rect.height);
    afterManualMove();
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(event,e=>{if(drag?.id===e.pointerId)drag=null;});
  window.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;
    if(e.key==='Escape'){el('settings').open=false;return;}
    if(e.target.closest?.('input,textarea,select,[contenteditable=true]'))return;
    if(e.key===' '&&e.target.closest?.('button,summary'))return;
    const key=e.key.toLowerCase();
    if(key===' '&&['idle','finished'].includes(state)){e.preventDefault();begin();}
    if(allowed()&&['arrowleft','arrowright'].includes(key)){e.preventDefault();move(key==='arrowleft'?-.027:.027);}
    if(!e.repeat&&key==='b') action('bow');
    if(!e.repeat&&key==='l') action('flourish');
    if(!e.repeat&&key==='r') begin();
  });
  names.forEach(name=>place(name,cast[name].x,.53));
  window.SHADOWPLAY_V4={begin,action,move,advanceBeat,advanceScene,setGesturePosition,resetGestureAnchor(){manualOrigin=null;},setFast(v){fast=!!v;},getState:stateInfo,positions,placeTracked,setMeter,updateInput,
    stopAudio(){stopVoice();music.pause();},
    getAudio:()=>({voicePaused:voice.paused,voiceTime:voice.currentTime,voiceDuration:voice.duration,musicPaused:music.paused,musicTime:music.currentTime})};
  sync();
})();
