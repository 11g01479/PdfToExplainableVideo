
import * as pdfjsLib from 'pdfjs-dist';
import { analyzePdfForPpt, generateSpeechForText } from './services/gemini.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`;

// --- State ---
let state = {
  targetFile: null,
  analysis: null,
  status: 'idle', // idle, analyzing, reviewing, audio_generating, video_recording, completed
  progress: 0,
  loadingMsg: ""
};

// --- DOM Elements ---
const els = {
  fileInput: document.getElementById('file-input'),
  fileNameDisplay: document.getElementById('file-name-display'),
  uploadActions: document.getElementById('upload-actions'),
  btnStartAnalysis: document.getElementById('btn-start-analysis'),
  
  step1: document.getElementById('step-1'),
  step2: document.getElementById('step-2'),
  step3: document.getElementById('step-3'),
  stepBadges: [
    document.getElementById('step-1-badge'),
    document.getElementById('step-2-badge'),
    document.getElementById('step-3-badge')
  ],
  
  loadingSection: document.getElementById('analysis-loading'),
  loadingMsg: document.getElementById('loading-message'),
  progressPercent: document.getElementById('progress-percent'),
  progressBar: document.getElementById('progress-bar'),
  
  analysisResult: document.getElementById('analysis-result'),
  docTitle: document.getElementById('doc-title'),
  docSummary: document.getElementById('doc-summary'),
  slidesContainer: document.getElementById('slides-container'),
  btnCreateVideo: document.getElementById('btn-create-video'),
  
  videoResult: document.getElementById('video-result'),
  outputVideo: document.getElementById('output-video'),
  downloadLink: document.getElementById('download-link'),
  
  canvas: document.getElementById('recorder-canvas'),
  errorModal: document.getElementById('error-modal'),
  errorMessage: document.getElementById('error-message')
};

// --- Utils ---
const updateUI = () => {
  els.step1.className = `step-card rounded-3xl p-8 border ${state.status === 'idle' ? 'active bg-slate-800/50' : 'completed bg-slate-900/40 opacity-70'}`;
  els.step2.className = `step-card rounded-3xl p-8 border ${['analyzing', 'reviewing', 'audio_generating', 'video_recording'].includes(state.status) ? 'active bg-slate-800/50' : (state.status === 'completed' ? 'completed bg-slate-900/40 opacity-70' : 'inactive bg-slate-900/30 opacity-50')}`;
  els.step3.className = `step-card rounded-3xl p-8 border ${state.status === 'completed' ? 'active bg-slate-800/50' : 'inactive bg-slate-900/30 opacity-50'}`;

  els.stepBadges.forEach((b, i) => {
    const stepNum = i + 1;
    const isCompleted = (stepNum === 1 && state.status !== 'idle') || (stepNum === 2 && state.status === 'completed');
    const isActive = (stepNum === 1 && state.status === 'idle') || 
                     (stepNum === 2 && ['analyzing', 'reviewing', 'audio_generating', 'video_recording'].includes(state.status)) ||
                     (stepNum === 3 && state.status === 'completed');

    if (isCompleted) {
      b.className = "w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg bg-green-500 text-white";
      b.innerText = "✓";
    } else if (isActive) {
      b.className = "w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg bg-blue-500 text-white";
      b.innerText = stepNum;
    } else {
      b.className = "w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg bg-slate-700 text-slate-400";
      b.innerText = stepNum;
    }
  });

  els.loadingSection.classList.toggle('hidden', !['analyzing', 'audio_generating', 'video_recording'].includes(state.status));
  els.analysisResult.classList.toggle('hidden', state.status !== 'reviewing');
  els.videoResult.classList.toggle('hidden', state.status !== 'completed');

  els.loadingMsg.innerText = state.loadingMsg;
  els.progressPercent.innerText = `${state.progress}%`;
  els.progressBar.style.width = `${state.progress}%`;
};

const showError = (msg) => {
  els.errorMessage.innerText = msg;
  els.errorModal.classList.remove('hidden');
};

const setProgress = (p, msg) => {
  state.progress = p;
  state.loadingMsg = msg;
  updateUI();
};

const renderPdfToImages = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images = [];
  // 動画サイズが720pなので、スケールを2.0から1.5に落としてメモリ消費を削減
  const scale = 1.5; 
  
  for (let i = 1; i <= pdf.numPages; i++) {
    setProgress(Math.floor((i / pdf.numPages) * 30), `資料を画像に変換中... (${i}/${pdf.numPages})`);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.8)); // 圧縮率をわずかに上げてメモリ負荷を軽減
  }
  return { images, numPages: pdf.numPages };
};

const startAnalysis = async () => {
  if (!state.targetFile) return;
  state.status = 'analyzing';
  updateUI();
  
  try {
    const reader = new FileReader();
    const base64 = await new Promise((resolve) => {
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(state.targetFile);
    });

    const { images, numPages } = await renderPdfToImages(state.targetFile);
    setProgress(40, "AIがドキュメントを解析しています...");
    
    const aiResult = await analyzePdfForPpt(base64, numPages);
    
    state.analysis = {
      presentationTitle: aiResult.presentationTitle,
      summary: aiResult.summary,
      slides: aiResult.slides.map((s, idx) => ({
        ...s,
        imageUrl: images[idx] || null
      }))
    };
    
    state.status = 'reviewing';
    renderSlides();
    updateUI();
  } catch (err) {
    console.error(err);
    showError("解析に失敗しました: " + (err.message || "予期せぬエラー"));
  }
};

const renderSlides = () => {
  els.docTitle.innerText = state.analysis.presentationTitle;
  els.docSummary.innerText = state.analysis.summary;
  els.slidesContainer.innerHTML = '';

  state.analysis.slides.forEach((slide, idx) => {
    const slideEl = document.createElement('div');
    slideEl.className = "bg-slate-800/30 p-8 rounded-[32px] border border-slate-800/50 hover:border-cyan-500/20 transition-all flex flex-col md:flex-row gap-8 group";
    
    slideEl.innerHTML = `
      <div class="md:w-1/3 aspect-video bg-black rounded-2xl overflow-hidden border border-slate-800 shadow-2xl group-hover:scale-[1.02] transition-transform">
        <img src="${slide.imageUrl}" class="w-full h-full object-contain" loading="lazy" />
      </div>
      <div class="md:w-2/3 space-y-4">
        <div class="flex items-center gap-3">
           <span class="w-8 h-8 flex items-center justify-center font-black bg-cyan-500 text-slate-950 rounded-lg text-sm">${idx+1}</span>
           <h5 class="font-bold text-slate-100 text-lg">${slide.title}</h5>
        </div>
        <div class="space-y-2">
          <label class="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">ナレーションスクリプト</label>
          <textarea 
            class="slide-note-input w-full h-32 bg-slate-950/80 border border-slate-800 rounded-2xl p-4 text-sm text-slate-300 focus:outline-none focus:border-cyan-500/50 transition-all resize-none leading-relaxed"
          >${slide.notes}</textarea>
        </div>
      </div>
    `;

    const textarea = slideEl.querySelector('textarea');
    textarea.addEventListener('input', (e) => {
      state.analysis.slides[idx].notes = e.target.value;
    });

    els.slidesContainer.appendChild(slideEl);
  });
};

const drawFrame = async (ctx, canvas, slide) => {
  ctx.fillStyle = "#0f172a"; 
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  if (slide.imageUrl) {
    const img = new Image();
    img.src = slide.imageUrl;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    const ratio = Math.min(canvas.width / img.width, canvas.height / img.height);
    const nw = img.width * ratio;
    const nh = img.height * ratio;
    ctx.drawImage(img, (canvas.width - nw) / 2, (canvas.height - nh) / 2, nw, nh);
  }
};

const getSupportedMimeType = () => {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
};

const createVideo = async () => {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  
  try {
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    
    state.status = 'audio_generating';
    setProgress(0, "AI音声を合成中...");

    const slides = state.analysis.slides;
    for (let i = 0; i < slides.length; i++) {
      setProgress(Math.floor((i / slides.length) * 50), `音声を合成中... (${i + 1}/${slides.length})`);
      slides[i].audioBuffer = await generateSpeechForText(slides[i].notes, audioCtx);
    }

    state.status = 'video_recording';
    setProgress(50, "動画を出力中...");
    
    const canvas = els.canvas;
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d', { alpha: false }); // パフォーマンス向上のためアルファチャネル無効
    
    const dest = audioCtx.createMediaStreamDestination();
    const stream = canvas.captureStream(30);
    dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    
    const mimeType = getSupportedMimeType();
    if (!mimeType) throw new Error("このブラウザは動画の録画をサポートしていません。");
    
    const recorder = new MediaRecorder(stream, { 
      mimeType, 
      videoBitsPerSecond: 4000000 // 5Mbpsから4Mbpsに下げて安定性を向上
    });
    const chunks = [];
    recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    
    const recordingFinished = new Promise((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.onerror = reject;
    });

    recorder.start();
    // 録画開始直後の空白時間を最小限にする
    await new Promise(r => setTimeout(r, 200));

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      setProgress(50 + Math.floor((i / slides.length) * 50), `レンダリング中: ${i + 1}/${slides.length}`);
      
      await drawFrame(ctx, canvas, slide);
      
      const source = audioCtx.createBufferSource();
      source.buffer = slide.audioBuffer;
      source.connect(dest);
      source.connect(audioCtx.destination);
      
      const duration = slide.audioBuffer.duration;
      source.start();
      
      // 音声の長さに合わせて待機（1秒の余韻を追加）
      const totalWait = (duration * 1000) + 1000;
      await new Promise(r => setTimeout(r, totalWait));
      
      source.disconnect();
    }

    recorder.stop();
    const blob = await recordingFinished;
    const url = URL.createObjectURL(blob);
    els.outputVideo.src = url;
    els.downloadLink.href = url;
    els.downloadLink.download = `ai_pdf_movie_${Date.now()}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
    
    state.status = 'completed';
    updateUI();
  } catch (err) {
    console.error(err);
    showError("動画生成に失敗しました: " + (err.message || "リソース不足かブラウザの制限です。"));
  } finally {
    if (audioCtx.state !== 'closed') audioCtx.close();
  }
};

// --- Events ---
els.fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (file.type === 'application/pdf') {
    state.targetFile = file;
    els.fileNameDisplay.innerText = file.name;
    els.uploadActions.classList.remove('hidden');
    // ステータスをリセット
    state.status = 'idle';
    updateUI();
  } else {
    alert("PDFファイルを選択してください。");
    els.fileInput.value = "";
  }
});

els.btnStartAnalysis.addEventListener('click', startAnalysis);
els.btnCreateVideo.addEventListener('click', createVideo);

// Initial UI
updateUI();
