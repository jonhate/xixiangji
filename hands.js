/* 镜像视频中的左、右手分别执张生、莺莺的影签。 */
(() => {
  'use strict';
  const show=window.SHADOWPLAY_V4, el=id=>document.getElementById(id);
  const video=el('cameraVideo'), panel=el('camera'), button=el('cameraBtn'), cover=el('startCamera');
  const overlay=el('landmarkOverlay'), pen=overlay.getContext('2d');
  const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
  const links=[[0,1,2,3,4],[0,5,6,7,8],[0,9,10,11,12],[0,13,14,15,16],[0,17,18,19,20],[5,9,13,17]];
  const tracks={zhang:null,ying:null};
  let stageKey='', count=-1, gate=null, handCount=0, frames=0, previousRoles=[];
  let phase='off',generation=0,stream=null,model=null,autoStart=false,delegate=null;
  let frameHandle=null, cameraClock=0, videoClock=-1, failureCount=0, lastPresence=-1;
  let visionLibrary=null, portableURLs=new Map();
  const live=()=>phase==='running';
  function report(text){const n=el('cameraNotice');if(n.textContent!==text)n.textContent=text;}
  function lens(text){if(el('cameraStatus').textContent!==text)el('cameraStatus').textContent=text;}
  function cameraUI(){
    const loading=phase==='loading', on=live();
    button.setAttribute('aria-pressed',String(on));el('camLabel').textContent=loading?'取消连接':on?'关闭摄像头':'开启摄像头';
    cover.disabled=loading;cover.textContent=loading?'正在连接…':on?'用手势开演':show.getState().state==='finished'?'再用手势演一出':'用手势开演';
    show.updateInput();
  }
  function clearInput(){
    stageKey='';count=-1;previousRoles=[];tracks.zhang=tracks.ying=null;gate=null;handCount=0;
    show.resetGestureAnchor();show.setMeter(0,'等待手势');
  }
  function describeHand(hand){
    const ids=hand.length===7?[0,1,2,3,4]:[0,5,9,13,17];
    return {
      x:1-ids.reduce((n,i)=>n+hand[i].x,0)/ids.length,
      y:ids.reduce((n,i)=>n+hand[i].y,0)/ids.length,
      size:Math.hypot(hand[ids[1]].x-hand[ids[4]].x,hand[ids[1]].y-hand[ids[4]].y)
    };
  }
  function draw(hands){
    if(!pen)return;
    const w=overlay.width,h=overlay.height;pen.clearRect(0,0,w,h);
    pen.lineWidth=2;pen.lineCap='round';
    for(const points of hands){
      pen.strokeStyle='#ffe5a9';pen.fillStyle='#722b22';
      for(const chain of (points.length===7?[[0,1,2,3,4,0],[0,5,6]]:links)){pen.beginPath();chain.forEach((id,j)=>{const p=points[id];if(j)pen.lineTo(p.x*w,p.y*h);else pen.moveTo(p.x*w,p.y*h);});pen.stroke();}
      for(const p of points){pen.beginPath();pen.arc(p.x*w,p.y*h,2.6,0,Math.PI*2);pen.fill();}
    }
  }
  function assignRoles(coords,scene){
    if(coords.length===2)return ['zhang','ying'];
    if(scene<=0)return ['zhang'];
    if(previousRoles.length===1)return previousRoles.slice();
    if(tracks.zhang&&tracks.ying){
      const p=coords[0];const near=t=>Math.hypot(t.x-p.x,t.y-p.y);
      return [near(tracks.zhang)<=near(tracks.ying)?'zhang':'ying'];
    }
    return [coords[0].x<=.5?'zhang':'ying'];
  }
  function baseGate(s,roles){
    return {epoch:s.epoch,kind:s.pending,roles:roles.join(),hold:0,peakGap:0,stageAtPeak:0,
      start:show.positions(),baseline:roles.map(r=>tracks[r].y),low:roles.map(r=>tracks[r].y)};
  }
  function processLandmarks(input,dt=1/30){
    const hands=(input||[]).filter(hand=>(hand?.length===7||hand?.length>=21)&&hand.slice(0,21).every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y))).slice(0,2);
    draw(hands);frames++;handCount=hands.length;
    if(!hands.length){
      if(count!==0){clearInput();count=0;lens('请将手放进画面');}
      return;
    }
    const s=show.getState(), coords=hands.map(describeHand).sort((a,b)=>a.x-b.x);
    const roles=assignRoles(coords,s.actIndex);
    const key=s.actIndex+'/'+(s.pending?s.epoch:s.state==='transition'?'换景':'演出');
    const gapInTime=dt>2.5 || dt<0;
    const rebase=stageKey!==key||count!==coords.length||previousRoles.join()!==roles.join()||gapInTime;
    const actorPos=show.positions();
    const alpha=1-Math.exp(-clamp(dt||.033,.012,.40)*17);
    roles.forEach((name,i)=>{
      const p=coords[i],t=tracks[name];
      if(rebase||!t) tracks[name]={x:p.x,y:p.y,origin:p.x,actor:actorPos[name],size:p.size};
      else {t.x+=(p.x-t.x)*alpha;t.y+=(p.y-t.y)*alpha;t.size=p.size;}
    });
    count=handCount;stageKey=key;previousRoles=roles;
    if(rebase||!gate||gate.epoch!==s.epoch)gate=baseGate(s,roles);
    const dest={};
    for(const name of roles){const t=tracks[name];dest[name]={x:t.actor+(t.x-t.origin)*.95,y:t.y};}
    if(s.actIndex===0 && roles.length===2){
      const t=Math.abs(tracks.zhang.x-tracks.zhang.origin)>=Math.abs(tracks.ying.x-tracks.ying.origin)?tracks.zhang:tracks.ying;
      dest.zhang={x:tracks.zhang.actor+(t.x-t.origin)*.95,y:t.y};delete dest.ying;
    }
    if(s.actIndex>0&&dest.zhang&&dest.ying&&dest.ying.x-dest.zhang.x<.13){
      const middle=(dest.zhang.x+dest.ying.x)/2;dest.zhang.x=middle-.065;dest.ying.x=middle+.065;
    }
    show.placeTracked(dest);
    if(!s.pending){
      lens(handCount===2?'双手已执签':'已执签 · '+(roles[0]==='zhang'?'张生':'莺莺'));return;
    }
    const paired=roles.length===2, left=tracks.zhang,right=tracks.ying;
    let progress=0,help='',done=false;
    if(s.pending==='move'){
      const travel=Math.abs(show.positions().zhang-gate.start.zhang);
      progress=travel/.058;help='横向移掌';done=progress>=1;
    }else if(!paired){
      gate.hold=0;help='需要两只手';
    }else{
      const gap=Math.max(0,right.x-left.x), both=show.positions();
      const stageGap=both.ying-both.zhang, elapsed=rebase?0:clamp(dt,0,.34);
      if(s.pending==='approach'){
        if(gap>=gate.peakGap){gate.peakGap=gap;gate.stageAtPeak=stageGap;}
        const close=gate.peakGap-gap;
        progress=Math.min(close/.12,Math.max(0,gate.stageAtPeak-stageGap)/.067);
        gate.hold=progress>=1?gate.hold+elapsed:0;
        done=gate.hold>=.09;help=gate.peakGap<.20?'先把双手分开':'向中间合拢';
      }else{
        const aspect=video.videoWidth?video.videoHeight/video.videoWidth:.75;
        const near=Math.hypot(gap,(left.y-right.y)*aspect)<clamp(.17+(left.size+right.size)*.28,.19,.255);
        gate.low=roles.map((r,i)=>Math.max(gate.low[i],tracks[r].y));
        const raised=roles.every((r,i)=>tracks[r].y<.43 || (gate.low[i]-tracks[r].y>.15&&tracks[r].y<.60));
        const shape=s.pending==='bow'?near:raised;
        gate.hold=shape?gate.hold+elapsed:0;
        progress=gate.hold/.48;done=progress>=1;
        help=shape?'稳住半秒':s.pending==='bow'?'双手靠拢':'两手举高';
      }
    }
    show.setMeter(clamp(progress,0,1),help);
    lens(handCount+' 只手 · '+help);
    if(done && show.action(s.pending))lens('动作已完成');
  }
  function decode(s){
    const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;
  }
  function asset(name,type){
    const packed=window.SHADOWPLAY_PORTABLE?.vision;
    if(!packed)return new URL(''+name,document.baseURI).href;
    if(!portableURLs.has(name))portableURLs.set(name,URL.createObjectURL(new Blob([decode(packed[name])],{type})));
    return portableURLs.get(name);
  }
  async function openModel(selection){
    // Both standard WASM and non-SIMD builds ship with the same pinned JS runtime.
    if(!visionLibrary)visionLibrary=import(asset('vision_bundle.mjs','text/javascript')).catch(e=>{visionLibrary=null;throw e;});
    const {FilesetResolver,HandLandmarker}=await visionLibrary;
    const stem=await FilesetResolver.isSimdSupported()?'vision_wasm_internal':'vision_wasm_nosimd_internal';
    const files={wasmLoaderPath:asset(stem+'.js','text/javascript'),wasmBinaryPath:asset(stem+'.wasm','application/wasm')};
    return HandLandmarker.createFromOptions(files,{
      baseOptions:{modelAssetPath:asset('hand_landmarker.task','application/octet-stream'),delegate:selection},runningMode:'VIDEO',numHands:2,
      minHandDetectionConfidence:.45,minHandPresenceConfidence:.45,minTrackingConfidence:.48
    });
  }
  const stopTracks=s=>s?.getTracks().forEach(t=>t.stop());
  const closeModel=m=>{try{m?.close();}catch{}};
  function guarded(promise,ms,id,onLate,label){
    return new Promise((resolve,reject)=>{
      let expired=false;
      const timeout=setTimeout(()=>{expired=true;reject(new Error(label));},ms);
      Promise.resolve(promise).then(value=>{
        clearTimeout(timeout);
        if(expired||generation!==id){onLate(value);reject(new Error('已取消连接'));}else resolve(value);
      },error=>{clearTimeout(timeout);reject(error);});
    });
  }
  function stopCamera(message=''){
    generation++;phase='off';autoStart=false;
    if(frameHandle!==null){if(video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(frameHandle);else cancelAnimationFrame(frameHandle);}
    frameHandle=null;
    if(stream)for(const t of stream.getTracks())t.onended=null;
    stopTracks(stream);stream=null;video.pause();video.srcObject=null;
    closeModel(model);model=null;delegate=null;
    clearInput();draw([]);panel.hidden=true;frames=0;lastPresence=-1;
    button.disabled=false;report(message);cameraUI();
  }
  function schedule(){
    if(live())frameHandle=video.requestVideoFrameCallback?video.requestVideoFrameCallback(tick):requestAnimationFrame(tick);
  }
  async function tick(now){
    const id=generation;
    frameHandle=null;if(!live())return;
    if(video.readyState>=2 && video.currentTime!==videoClock && now-cameraClock>=38){
      const dt=cameraClock?(now-cameraClock)/1000:.04;
      cameraClock=now;videoClock=video.currentTime;
      try{
        const result=await model.detectForVideo(video,now);
        if(id!==generation)return;
        processLandmarks(result.landmarks,dt);failureCount=0;
        const n=handCount>0?1:0;
        if(lastPresence!==n){lastPresence=n;report(n?'':'摄像头已就绪。请让整只手进入小窗。');}
      }catch{
        if(id!==generation)return;
        if(++failureCount>=3){
          if(delegate==='GPU'){recoverCPU();return;}
          stopCamera('追踪已中断。可重新开启摄像头，或用台下按钮接着演。');return;
        }
      }
    }
    schedule();
  }
  async function recoverCPU(){
    const id=generation;phase='loading';cameraUI();report('正在切换到兼容识别模式…');
    closeModel(model);model=null;
    try{
      const replacement=await guarded(window.openPalmDetector(),30000,id,closeModel,'兼容模式启动超时');
      if(id!==generation){closeModel(replacement);return;}
      model=replacement;delegate='CPU';clearInput();phase='running';failureCount=0;lastPresence=-1;cameraUI();schedule();
    }catch{if(id===generation)stopCamera('追踪中断。可重开摄像头，或用台下按钮接着演。');}
  }
  const messages={
    NotAllowedError:'浏览器未授予摄像头权限。可在地址栏允许后重试，或直接用触屏开演。',
    NotFoundError:'没有找到摄像头。连接设备后可重试，也可用触屏或键盘开演。',
    NotReadableError:'摄像头被其他程序占用。释放后可重试，或用触屏继续。',
    SecurityError:'此窗口限制摄像头。请在浏览器单独打开本页或使用触屏。'
  };
  async function startCamera(beginWhenReady=false){
    if(live()){if(beginWhenReady)show.begin();return true;}
    if(phase==='loading'){autoStart=autoStart||beginWhenReady;return false;}
    const id=++generation;phase='loading';autoStart=beginWhenReady;cameraUI();report('请允许使用摄像头。画面只在当前设备处理。');
    try{
      if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('请用 HTTPS 网页或本机浏览器打开，并允许摄像头。');
      const local=await guarded(navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:24,max:30}}}),20000,id,stopTracks,'等待摄像头授权超时，可重试。');
      if(id!==generation){stopTracks(local);return false;}
      stream=local;
      for(const t of stream.getVideoTracks())t.onended=()=>{if(id===generation)stopCamera('摄像头已断开。可重新连接，或用按钮继续当前一景。');};
      video.srcObject=stream;
      await guarded(video.play(),9000,id,()=>{},'摄像头画面未就绪，可重试。');
      if(id!==generation)return false;
      el('lensFrame').style.aspectRatio=(video.videoWidth||4)+' / '+(video.videoHeight||3);
      overlay.height=180;overlay.width=Math.round(180*(video.videoWidth||4)/(video.videoHeight||3));
      panel.hidden=false;lens('正在准备影签');report('正在加载随作品提供的手势模型…');
      let nextModel;
      try{
        const probe=document.createElement('canvas');const gl=probe.getContext('webgl2')||probe.getContext('webgl');if(!gl)throw Error('no WebGL');gl.getExtension('WEBGL_lose_context')?.loseContext();
        nextModel=await guarded(openModel('GPU'),25000,id,closeModel,'图形模式启动超时');delegate='GPU';
      }catch{
        if(id!==generation)return false;
        report('正在启用兼容识别模式…');
        nextModel=await guarded(window.openPalmDetector(),35000,id,closeModel,'手势模型启动超时。请重试，或用触屏开演。');delegate='CPU';
      }
      if(id!==generation){closeModel(nextModel);return false;}
      model=nextModel;phase='running';cameraClock=0;videoClock=-1;failureCount=0;lastPresence=-1;
      cameraUI();report('');lens('请举起手');if(autoStart)show.begin();autoStart=false;schedule();return true;
    }catch(error){
      if(id===generation)stopCamera(messages[error?.name]||('摄像头未就绪。'+(error?.message||'请重试，或用按钮继续。').slice(0,85)));
      return false;
    }
  }
  button.addEventListener('click',()=>phase==='off'?startCamera():stopCamera());
  cover.addEventListener('click',()=>startCamera(true));
  window.addEventListener('pagehide',()=>{stopCamera();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&live())clearInput();});
  const api={startCamera,stopCamera,processLandmarks,cancelAutoStart(){autoStart=false;},
    getState:()=>({active:live(),loading:phase==='loading',modelReady:!!model,handCount,frames,delegate,gate:show.getState().pending,quality:phase==='running'?(handCount?'ok':'none'):phase})};
  window.SHADOWPLAY_RIG_V6=api;
  window.SHADOWPLAY_V6={...show,rig:api};
  cameraUI();
})();
