// Lightweight runner that mirrors preprocessing and multi-scale OCR from src/content/ocr.ts
(async function () {
  const imageDir = '../image';
  const images = [
    'judol-1.png','judol-2.png','judol-3.png','judol-4.png','judol-5.png','judol-6.png','judol-7.png'
  ];

  const logEl = document.getElementById('log');
  const imagesEl = document.getElementById('images');
  const summaryEl = document.getElementById('summary');

  function log(msg) { if (logEl) logEl.textContent += msg + '\n'; }

  // recreate small helpers from content/ocr.ts
  function cropImageToCanvas(image, sx, sy, sw, sh, scale=1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function preprocessCanvasForOcr(canvas, blockSize, bias) {
    const width = canvas.width, height = canvas.height;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0,0,width,height);
    const data = img.data;
    for (let i=0;i<data.length;i+=4){
      const r=data[i], g=data[i+1], b=data[i+2];
      const gray = Math.round(0.299*r+0.587*g+0.114*b);
      data[i]=data[i+1]=data[i+2]=gray;
    }
    // contrast stretch
    let min=255,max=0;
    for (let i=0;i<data.length;i+=4){ const v=data[i]; if(v<min)min=v; if(v>max)max=v; }
    const range=Math.max(1,max-min); const scale=255/range;
    for (let i=0;i<data.length;i+=4){ let v=Math.round((data[i]-min)*scale); v=Math.max(0,Math.min(255,v)); data[i]=data[i+1]=data[i+2]=v; }

    const tw = width+1, th = height+1;
    const integral = new Uint32Array(tw*th);
    for (let y=0;y<height;y++){ let rowSum=0; for (let x=0;x<width;x++){ const idx=(y*width+x)*4; rowSum+=data[idx]; integral[(y+1)*tw + (x+1)] = integral[y*tw + (x+1)] + rowSum; } }

    const block = Math.max(5, Math.floor(Math.min(width,height)/20));
    const half = Math.floor(block/2);
    const out = new Uint8ClampedArray(width*height*4);
    for (let y=0;y<height;y++){
      const y1=Math.max(0,y-half), y2=Math.min(height-1,y+half);
      for (let x=0;x<width;x++){
        const x1=Math.max(0,x-half), x2=Math.min(width-1,x+half);
        const count=(x2-x1+1)*(y2-y1+1);
        const sum = integral[(y2+1)*tw + (x2+1)] - integral[(y1)*tw + (x2+1)] - integral[(y2+1)*tw + (x1)] + integral[(y1)*tw + (x1)];
        const mean = Math.round(sum/count);
        const idx=(y*width+x)*4; const v=data[idx]; const t = mean + (bias|0);
        const val = v <= t ? 0 : 255;
        out[idx]=out[idx+1]=out[idx+2]=val; out[idx+3]=255;
      }
    }
    ctx.putImageData(new ImageData(out,width,height),0,0);
    return canvas.toDataURL('image/png');
  }

  function detectTextBBoxes(image){
    const w=image.naturalWidth, h=image.naturalHeight;
    const tmp = document.createElement('canvas'); tmp.width = Math.min(1200,w); tmp.height = Math.min(1200, Math.round((tmp.width*h)/w));
    const ctx = tmp.getContext('2d'); ctx.drawImage(image,0,0,tmp.width,tmp.height);
    let imageData;
    try {
      imageData = ctx.getImageData(0,0,tmp.width,tmp.height);
    } catch (err) {
      const e = new Error('Canvas tainted by cross-origin image data. Serve the files over HTTP with proper CORS headers or run a local static server (e.g., `npx http-server . -p 8080`) and open the runner via http://localhost:8080/test/ocr-test/runner.html');
      (e).cause = err;
      throw e;
    }
    const data = imageData.data; const rowSums = new Uint32Array(tmp.height);
    for (let y=0;y<tmp.height;y++){ let sum=0; for (let x=0;x<tmp.width;x++){ const idx=(y*tmp.width+x)*4; const r=data[idx],g=data[idx+1],b=data[idx+2]; const gray=(r*0.299+g*0.587+b*0.114)|0; if(gray<200) sum++; } rowSums[y]=sum; }
    const threshold = Math.max(5, Math.floor(tmp.width*0.02)); const bands=[]; let inBand=false, start=0;
    for (let y=0;y<tmp.height;y++){ if(!inBand && rowSums[y]>threshold) { inBand=true; start=y; } if(inBand && rowSums[y]<=threshold) { inBand=false; bands.push({start,end:y}); } }
    if(inBand) bands.push({start,end:tmp.height-1});
    const boxes=[];
    for (const band of bands){ let left=tmp.width, right=0; for (let y=band.start;y<=band.end;y++){ for (let x=0;x<tmp.width;x++){ const idx=(y*tmp.width+x)*4; const r=data[idx],g=data[idx+1],b=data[idx+2]; const gray=(r*0.299+g*0.587+b*0.114)|0; if(gray<200){ if(x<left) left=x; if(x>right) right=x; } } } if(right-left>8){ const scaleX = w/tmp.width, scaleY = h/tmp.height; const x=Math.max(0, Math.floor(left*scaleX)-8); const y=Math.max(0, Math.floor(band.start*scaleY)-8); const boxW = Math.min(w-x, Math.ceil((right-left)*scaleX)+16); const boxH = Math.min(h-y, Math.ceil((band.end-band.start)*scaleY)+16); boxes.push({x,y,w:boxW,h:boxH}); } }
    if(boxes.length===0) return [{x:0,y:0,w:h,h:w}]; return boxes;
  }

  // build DOM thumbnails. Try to fetch each image as a blob first to avoid canvas tainting.
  const thumbs = [];
  for (const name of images) {
    const wrapper = document.createElement('div');
    wrapper.className = 'result';
    const img = document.createElement('img');
    const info = document.createElement('div');
    info.innerHTML = `<strong>${name}</strong><div class="out"></div>`;
    wrapper.appendChild(img);
    wrapper.appendChild(info);
    imagesEl.appendChild(wrapper);
    thumbs.push({ name, img, out: info.querySelector('.out') });

    // Attempt to fetch the image as blob (works when served over HTTP with same origin).
    (async () => {
      const url = `${imageDir}/${name}`;
      try {
        const res = await fetch(url);
        if (res.ok) {
          const blob = await res.blob();
          img.src = URL.createObjectURL(blob);
        } else {
          log(`fetch ${url} -> ${res.status}`);
          img.src = url; // fallback: direct src (may taint canvas if cross-origin/file://)
        }
      } catch (err) {
        log(`fetch ${url} error: ${err && err.message ? err.message : err}`);
        img.src = url; // fallback
      }
    })();
  }

  // load keywords (try several likely paths and log failures)
  async function loadKeywords(){
    const attempts = [
      '../../public/keywords/keywords.txt',
      '/public/keywords/keywords.txt',
      '../public/keywords/keywords.txt',
      'public/keywords/keywords.txt',
      '../../keywords/keywords.txt',
      '/keywords/keywords.txt',
      '../keywords/keywords.txt',
      'keywords/keywords.txt'
    ];
    for (const p of attempts) {
      try {
        const res = await fetch(p);
        if (!res.ok) { log(`fetch ${p} -> ${res.status}`); continue; }
        const txt = await res.text();
        const arr = txt.split('\n').map(s=>s.trim()).filter(Boolean);
        log(`Loaded ${arr.length} keywords from ${p}`);
        return arr;
      } catch (err) {
        log(`fetch ${p} error: ${err && err.message ? err.message : err}`);
      }
    }
    log('No keywords file found; continuing with empty list.');
    return [];
  }

  const tesseract = window.Tesseract;

  async function run() {
    const blockSize = parseInt(document.getElementById('blockSize').value,10) || 15;
    const bias = parseInt(document.getElementById('bias').value,10) || -10;
    const scales = document.getElementById('scales').value.split(',').map(s=>parseFloat(s)).filter(Boolean);
    const keywords = await loadKeywords();
    log(`Loaded ${keywords.length} keywords`);
    const results = [];
    // Create worker: try both API shapes (some builds accept language in createWorker)
    let worker;
    try {
      worker = await tesseract.createWorker('eng+ind');
    } catch (err) {
      log('createWorker(lang) failed, falling back to no-arg createWorker');
      worker = await tesseract.createWorker();
    }
    // If worker exposes loadLanguage/initialize, call them; otherwise assume already initialized
    try {
      if (typeof worker.loadLanguage === 'function') await worker.loadLanguage('eng+ind');
      if (typeof worker.initialize === 'function') await worker.initialize('eng+ind');
    } catch (err) {
      log('Worker init warning: ' + (err && err.message ? err.message : err));
    }

    for (const t of thumbs){
      const img = t.img;
      await new Promise(r=>{ if (img.complete) r(); else img.onload = r; });
      log('Processing '+t.name);
      const boxes = detectTextBBoxes(img);
      let aggregate = '';
      const start = performance.now();
      for (const box of boxes){
        let recognized='';
        for (const scale of scales){
          const canvas = cropImageToCanvas(img, box.x, box.y, box.w, box.h, scale);
          const dataUrl = preprocessCanvasForOcr(canvas, blockSize, bias);
          try{
            const res = await Promise.race([worker.recognize(dataUrl), new Promise(res=>setTimeout(()=>res({data:{text:''}}),2500))]);
            const text = (res && res.data && res.data.text) ? res.data.text.trim() : '';
            if(text) { recognized = text; break; }
          }catch(e){ }
        }
        if(recognized) aggregate += (aggregate? '\n':'') + recognized;
      }
      if(!aggregate){ // fallback whole image
        const canvas = cropImageToCanvas(img, 0,0, img.naturalWidth, img.naturalHeight, 1);
        const dataUrl = preprocessCanvasForOcr(canvas, blockSize, bias);
        const res = await worker.recognize(dataUrl); aggregate = (res.data && res.data.text) ? res.data.text.trim() : '';
      }
      const time = performance.now()-start;
      t.out.innerHTML = `<p><em>time:</em> ${time.toFixed(0)} ms</p><pre>${aggregate}</pre>`;
      results.push({ name: t.name, text: aggregate, time: Math.round(time) });
    }
    await worker.terminate();
    summaryEl.innerHTML = `<pre>${JSON.stringify(results,null,2)}</pre>`;
    log('Done');
  }

  document.getElementById('runBtn').addEventListener('click', () => { logEl.textContent = ''; run().catch(e=>log('Error:'+e.message)); });
  document.getElementById('exportBtn').addEventListener('click', () => { const txt = summaryEl.textContent || ''; const blob = new Blob([txt], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ocr-results.json'; a.click(); });

})();
