/* Palm detector for browsers without a WebGL context. All seven points come directly from the model. */
window.openPalmDetector=async function(){
  const files=window.SHADOWPLAY_PORTABLE?.palm;
  async function resource(name,mime){
    if(!files)return new URL(''+name,document.baseURI).href;
    const bytes=Uint8Array.from(atob(files[name]),c=>c.charCodeAt(0));
    const raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return URL.createObjectURL(new Blob([raw],{type:mime}));
  }
  const simd=WebAssembly.validate(Uint8Array.from([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]));
  const wasm=simd?'ort-wasm-simd.wasm':'ort-wasm.wasm';
  const urls=await Promise.all([resource('ort.min.js','text/javascript'),resource(wasm,'application/wasm'),resource('palm.onnx','application/octet-stream')]);
  try{
    if(!window.ort)await new Promise((ok,bad)=>{const script=document.createElement('script');script.onload=ok;script.onerror=bad;script.src=urls[0];document.head.append(script);});
    const ort=window.ort;
    ort.env.wasm.numThreads=1;ort.env.wasm.simd=simd;ort.env.wasm.wasmPaths={[wasm]:urls[1]};
    const session=await ort.InferenceSession.create(urls[2],{executionProviders:['wasm']});
    const canvas=document.createElement('canvas');canvas.width=canvas.height=192;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const anchors=[];
    for(const [side,repeats] of [[24,2],[12,6]])for(let y=0;y<side;y++)for(let x=0;x<side;x++)for(let k=0;k<repeats;k++)anchors.push([(x+.5)*192/side,(y+.5)*192/side]);
    const floats=new Float32Array(192*192*3);
    return {async detectForVideo(video){
      const scale=192/Math.max(video.videoWidth,video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale,dx=(192-w)/2,dy=(192-h)/2;
      ctx.fillStyle='black';ctx.fillRect(0,0,192,192);ctx.drawImage(video,dx,dy,w,h);
      const image=ctx.getImageData(0,0,192,192).data;
      for(let i=0,j=0;i<image.length;i+=4){floats[j++]=image[i]/255;floats[j++]=image[i+1]/255;floats[j++]=image[i+2]/255;}
      const out=Object.values(await session.run({[session.inputNames[0]]:new ort.Tensor('float32',floats,[1,192,192,3])}));
      const scores=out.find(t=>t.data.length===anchors.length).data,boxes=out.find(t=>t.data.length===anchors.length*18).data;
      const candidates=[];
      for(let i=0;i<scores.length;i++)if(scores[i]>.20)candidates.push(i);
      candidates.sort((a,b)=>scores[b]-scores[a]);
      const hands=[],kept=[];
      for(const i of candidates){
        const j=i*18,[ax,ay]=anchors[i],cx=ax+boxes[j],cy=ay+boxes[j+1],bw=boxes[j+2],bh=boxes[j+3];
        const box=[cx-bw/2,cy-bh/2,cx+bw/2,cy+bh/2];
        if(kept.some(b=>{const intersection=Math.max(0,Math.min(box[2],b[2])-Math.max(box[0],b[0]))*Math.max(0,Math.min(box[3],b[3])-Math.max(box[1],b[1]));return intersection/(bw*bh+(b[2]-b[0])*(b[3]-b[1])-intersection)>.3;}))continue;
        kept.push(box);hands.push(Array.from({length:7},(_,k)=>({x:(ax+boxes[j+4+k*2]-dx)/w,y:(ay+boxes[j+5+k*2]-dy)/h})));if(hands.length===2)break;
      }
      return {landmarks:hands};
    },close(){session.release().catch(()=>{});}};
  }finally{if(files)urls.forEach(u=>URL.revokeObjectURL(u));}
};
