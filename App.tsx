
import React, { useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { analyzePdfForPpt, generateSpeechForText } from './services/geminiService';
import { createPresentation } from './services/pptxService';
import { parsePptxNotes } from './services/pptxParser';
import { AnalysisResult, AppState, Slide } from './types';
import StepCard from './components/StepCard';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`;

const App: React.FC = () => {
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [appState, setAppState] = useState<AppState>({ status: 'idle', progress: 0 });
  const [loadingMsg, setLoadingMsg] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'pdf' | 'pptx' | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const isPdf = file.type === 'application/pdf';
      const isPptx = file.name.endsWith('.pptx');
      
      if (isPdf || isPptx) {
        setTargetFile(file);
        setFileType(isPdf ? 'pdf' : 'pptx');
        setAnalysis(null);
        setVideoUrl(null);
        setAppState({ status: 'idle', progress: 0 });
      } else {
        alert("PDFまたはPPTXファイルを選択してください。");
      }
    }
  };

  const renderPdfToImages = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const images: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      setLoadingMsg(`PDFを解析中... (${i}/${pdf.numPages} ページ)`);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await page.render({ canvasContext: ctx, viewport }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.85));
    }
    return { images, numPages: pdf.numPages };
  };

  const startAnalysis = async () => {
    if (!targetFile) return;
    try {
      setAppState({ status: 'analyzing', progress: 10 });
      setLoadingMsg("AIがドキュメントを読み取っています...");

      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(targetFile);
      });

      if (fileType === 'pdf') {
        const { images, numPages } = await renderPdfToImages(targetFile);
        const result = await analyzePdfForPpt(base64, numPages);
        const finalSlides: Slide[] = [];
        for (let i = 0; i < numPages; i++) {
          const aiSlide = result.slides.find(s => s.pageIndex === i);
          finalSlides.push({
            pageIndex: i,
            title: aiSlide?.title || `ページ ${i + 1}`,
            notes: aiSlide?.notes || "解説を生成できませんでした。",
            imageUrl: images[i]
          });
        }
        setAnalysis({ ...result, slides: finalSlides });
      } else {
        setLoadingMsg("PowerPointの内容を解析中...");
        const pptData = await parsePptxNotes(targetFile);
        const result = await analyzePdfForPpt(base64, pptData.slides.length);
        
        const finalSlides: Slide[] = pptData.slides.map((s, idx) => ({
          pageIndex: idx,
          title: s.title,
          content: s.content,
          notes: s.notes !== "（解説なし）" ? s.notes : (result.slides[idx]?.notes || "解説を生成できませんでした。")
        }));
        
        setAnalysis({
          presentationTitle: targetFile.name.replace('.pptx', ''),
          summary: result.summary,
          slides: finalSlides
        });
      }

      setAppState({ status: 'reviewing', progress: 100 });
    } catch (error: any) {
      setAppState({ status: 'error', progress: 0, error: error.message });
    }
  };

  const handlePptxDirect = async () => {
    if (!targetFile || fileType !== 'pptx') return;
    try {
      setAppState({ status: 'analyzing', progress: 30 });
      setLoadingMsg("スライドのノートを抽出中...");
      
      const pptData = await parsePptxNotes(targetFile);
      const finalSlides: Slide[] = pptData.slides.map((s, idx) => ({
        pageIndex: idx,
        title: s.title,
        content: s.content,
        notes: s.notes
      }));

      setAnalysis({
        presentationTitle: targetFile.name.replace('.pptx', ''),
        summary: "既存のスピーカーノートから直接生成されました。",
        slides: finalSlides
      });

      setAppState({ status: 'reviewing', progress: 100 });
    } catch (error: any) {
      setAppState({ status: 'error', progress: 0, error: error.message });
    }
  };

  const handleNoteChange = (index: number, newNote: string) => {
    if (!analysis) return;
    const updatedSlides = [...analysis.slides];
    updatedSlides[index] = { ...updatedSlides[index], notes: newNote };
    setAnalysis({ ...analysis, slides: updatedSlides });
  };

  const drawFrame = async (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, slide: Slide) => {
    ctx.fillStyle = "#0f172a"; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (slide.imageUrl) {
      const img = new Image();
      img.src = slide.imageUrl;
      await new Promise(r => img.onload = r);
      const ratio = Math.min(canvas.width / img.width, canvas.height / img.height);
      const nw = img.width * ratio;
      const nh = img.height * ratio;
      ctx.drawImage(img, (canvas.width - nw) / 2, (canvas.height - nh) / 2, nw, nh);
    } else {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, '#1e293b');
      gradient.addColorStop(1, '#0f172a');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.fillStyle = 'rgba(56, 189, 248, 0.05)';
      ctx.beginPath();
      ctx.arc(canvas.width, 0, 400, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#38bdf8';
      ctx.font = '900 48px Inter';
      ctx.textAlign = 'left';
      ctx.fillText(slide.title, 80, 120, canvas.width - 160);
      
      ctx.fillStyle = '#334155';
      ctx.fillRect(80, 150, canvas.width - 160, 4);

      if (slide.content && slide.content.length > 0) {
        ctx.fillStyle = '#f1f5f9';
        ctx.font = '500 28px Inter';
        slide.content.forEach((text, i) => {
          const y = 240 + i * 60;
          ctx.fillStyle = '#38bdf8';
          ctx.fillText('•', 80, y);
          ctx.fillStyle = '#f1f5f9';
          ctx.fillText(text, 120, y, canvas.width - 200);
        });
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'italic 24px Inter';
        const wrapText = (text: string, maxWidth: number) => {
          const words = text.split('');
          let line = '';
          const lines = [];
          for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n];
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && n > 0) {
              lines.push(line);
              line = words[n];
            } else {
              line = testLine;
            }
          }
          lines.push(line);
          return lines;
        };
        const lines = wrapText(slide.notes, canvas.width - 160);
        lines.slice(0, 5).forEach((line, i) => {
          ctx.fillText(line, 80, 240 + i * 45);
        });
      }
      
      ctx.fillStyle = '#475569';
      ctx.font = 'bold 20px Inter';
      ctx.textAlign = 'right';
      ctx.fillText(`PAGE ${slide.pageIndex + 1}`, canvas.width - 80, canvas.height - 60);
    }
  };

  const createVideo = async () => {
    if (!analysis) return;
    
    // AudioContextの初期化
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    try {
      // ブラウザの制限を回避するため、操作の直後にresume()を実行
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      setAppState({ status: 'audio_generating', progress: 0 });
      const slidesWithAudio = [...analysis.slides];
      
      // 全ての音声を先に生成
      for (let i = 0; i < slidesWithAudio.length; i++) {
        setLoadingMsg(`AI音声を生成中... (${i + 1}/${slidesWithAudio.length})`);
        try {
          slidesWithAudio[i].audioBuffer = await generateSpeechForText(slidesWithAudio[i].notes, audioCtx);
        } catch (e: any) {
          throw new Error(`スライド ${i+1} の音声生成に失敗しました: ${e.message}`);
        }
        setAppState(prev => ({ ...prev, progress: Math.floor(((i + 1) / slidesWithAudio.length) * 50) }));
      }

      setAppState({ status: 'video_recording', progress: 50 });
      const canvas = canvasRef.current!;
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d')!;
      
      const dest = audioCtx.createMediaStreamDestination();
      const stream = canvas.captureStream(30);
      dest.stream.getAudioTracks().forEach(track => stream.addTrack(track));
      
      const recorder = new MediaRecorder(stream, { 
        mimeType: 'video/webm;codecs=vp9,opus',
        videoBitsPerSecond: 5000000
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      
      const recordingPromise = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      });

      recorder.start();
      await new Promise(r => setTimeout(r, 800)); // 安定化のための待機

      for (let i = 0; i < slidesWithAudio.length; i++) {
        const slide = slidesWithAudio[i];
        setLoadingMsg(`動画を出力中: ${i + 1} / ${slidesWithAudio.length}`);
        
        await drawFrame(ctx, canvas, slide);
        
        const source = audioCtx.createBufferSource();
        source.buffer = slide.audioBuffer!;
        source.connect(dest);
        source.connect(audioCtx.destination);
        
        const duration = slide.audioBuffer!.duration;
        source.start();
        
        // 音声再生中もフレームを維持（アニメーションループで描画を続ける）
        const slideStartTime = Date.now();
        const slideEndTime = slideStartTime + (duration * 1000) + 1000; // ページ間マージン
        
        while (Date.now() < slideEndTime) {
          await new Promise(r => requestAnimationFrame(r));
        }
        
        setAppState(prev => ({ ...prev, progress: 50 + Math.floor(((i + 1) / slidesWithAudio.length) * 50) }));
      }

      recorder.stop();
      const videoBlob = await recordingPromise;
      setVideoUrl(URL.createObjectURL(videoBlob));
      setAppState({ status: 'completed', progress: 100 });
      
    } catch (error: any) {
      console.error(error);
      setAppState({ status: 'error', progress: 0, error: error.message });
    } finally {
      if (audioCtx) {
        // すぐにcloseすると録画に影響する場合があるため少し待つ
        setTimeout(() => audioCtx.close(), 1000);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-20 selection:bg-cyan-500/30">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <header className="text-center mb-16 animate-in fade-in slide-in-from-top duration-700">
          <div className="inline-block px-4 py-1 mb-4 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold uppercase tracking-widest">
            AI Video Production Studio
          </div>
          <h1 className="text-6xl font-black mb-6 bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 tracking-tight">
            Document to AI Movie
          </h1>
          <p className="text-slate-400 text-xl max-w-2xl mx-auto font-medium leading-relaxed">
            資料をアップロードするだけで、AIがスライドを読み取り、ナレーション付き動画へ変換します。
          </p>
        </header>

        <main className="space-y-8">
          <StepCard number={1} title="資料のアップロード (PDF / PPTX)" active={appState.status === 'idle'} completed={!!targetFile && appState.status !== 'idle'}>
            <div className="flex flex-col items-center">
              <label className="w-full flex flex-col items-center py-14 bg-slate-800/10 rounded-[40px] border-2 border-dashed border-slate-700/50 cursor-pointer hover:border-cyan-500/50 hover:bg-slate-800/20 transition-all group relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 mb-6 group-hover:scale-110 transition-all shadow-2xl relative z-10">
                  <svg className="w-12 h-12 text-slate-400 group-hover:text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                </div>
                <span className="text-slate-300 font-bold text-xl relative z-10">{targetFile ? targetFile.name : "ファイルをここにドロップ"}</span>
                <span className="text-slate-500 text-sm mt-2 relative z-10">PPTXの場合はスピーカーノートを自動で読み込みます</span>
                <input type="file" className="hidden" accept=".pdf,.pptx" onChange={handleFileUpload} />
              </label>
              {targetFile && appState.status === 'idle' && (
                <div className="flex flex-wrap justify-center gap-4 mt-10">
                  <button onClick={startAnalysis} className="px-10 py-5 bg-gradient-to-r from-cyan-600 to-blue-700 hover:from-cyan-500 hover:to-blue-600 text-white font-black rounded-[20px] shadow-2xl transition-all transform hover:scale-105 active:scale-95 text-lg flex items-center gap-3">
                    {fileType === 'pptx' ? 'AI解析で解説を最適化' : 'AI解析を開始'}
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                  </button>
                  
                  {fileType === 'pptx' && (
                    <button onClick={handlePptxDirect} className="px-10 py-5 bg-slate-800 hover:bg-slate-700 text-slate-100 font-black rounded-[20px] border border-slate-700 shadow-xl transition-all transform hover:scale-105 active:scale-95 text-lg flex items-center gap-3">
                      既存のノートで動画を作成
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" /></svg>
                    </button>
                  )}
                </div>
              )}
            </div>
          </StepCard>

          <StepCard number={2} title="スクリプト編集 & 動画生成" active={['rendering', 'analyzing', 'reviewing', 'audio_generating', 'video_recording'].includes(appState.status)} completed={appState.status === 'completed'}>
            {['rendering', 'analyzing', 'audio_generating', 'video_recording'].includes(appState.status) ? (
              <div className="flex flex-col items-center py-20 text-center">
                <div className="relative mb-10">
                  <div className="w-24 h-24 border-[6px] border-slate-800 border-t-cyan-500 rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center font-black text-cyan-500 text-sm">
                    {appState.progress}%
                  </div>
                </div>
                <p className="text-3xl font-black mb-6 tracking-tight text-white">{loadingMsg}</p>
                <div className="w-full max-w-lg bg-slate-900 h-4 rounded-full overflow-hidden border border-slate-800">
                  <div className="bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 h-full transition-all duration-700 ease-out shadow-[0_0_20px_rgba(34,211,238,0.5)]" style={{ width: `${appState.progress}%` }}></div>
                </div>
              </div>
            ) : analysis ? (
              <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
                <div className="bg-slate-900/60 p-8 rounded-[32px] border border-slate-800">
                  <div className="flex justify-between items-start mb-4">
                    <h4 className="text-cyan-400 font-black text-2xl tracking-tight">{analysis.presentationTitle}</h4>
                    <span className="px-4 py-1 bg-slate-800 rounded-full text-xs font-bold text-slate-400">Total {analysis.slides.length} Slides</span>
                  </div>
                  <p className="text-slate-400 text-base leading-relaxed">{analysis.summary}</p>
                </div>

                <div className="grid grid-cols-1 gap-8 max-h-[600px] overflow-y-auto pr-6 scrollbar-thin">
                  {analysis.slides.map((slide, idx) => (
                    <div key={idx} className="bg-slate-800/30 p-8 rounded-[32px] border border-slate-800/50 hover:border-cyan-500/20 transition-all flex flex-col md:flex-row gap-8 group">
                      <div className="md:w-1/3 aspect-video bg-black rounded-2xl overflow-hidden border border-slate-800 shadow-2xl group-hover:scale-[1.02] transition-transform">
                        {slide.imageUrl ? (
                          <img src={slide.imageUrl} alt="" className="w-full h-full object-contain" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-gradient-to-br from-slate-800 to-slate-950 text-center">
                            <span className="text-cyan-400 font-bold text-sm mb-2 px-4 line-clamp-2">{slide.title}</span>
                            <span className="text-slate-600 text-[10px] font-black tracking-tighter uppercase">PowerPoint Source</span>
                          </div>
                        )}
                      </div>
                      <div className="md:w-2/3 space-y-4">
                        <div className="flex items-center gap-3">
                           <span className="w-8 h-8 flex items-center justify-center font-black bg-cyan-500 text-slate-950 rounded-lg text-sm">{idx+1}</span>
                           <h5 className="font-bold text-slate-100 text-lg">{slide.title}</h5>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">ナレーションスクリプト (編集可能)</label>
                          <textarea 
                            value={slide.notes}
                            onChange={(e) => handleNoteChange(idx, e.target.value)}
                            className="w-full h-32 bg-slate-950/80 border border-slate-800 rounded-2xl p-4 text-sm text-slate-300 focus:outline-none focus:border-cyan-500/50 focus:border-cyan-500/20 transition-all resize-none leading-relaxed"
                            placeholder="AIが生成した解説です。必要に応じて修正してください..."
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap justify-center gap-6 pt-8 border-t border-slate-800/50">
                  <button onClick={createVideo} className="px-14 py-6 bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-500 hover:to-indigo-600 text-white font-black rounded-[24px] shadow-2xl transition-all transform hover:scale-105 active:scale-95 flex items-center gap-4 text-lg">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" /></svg>
                    動画を今すぐ生成
                  </button>
                  <button onClick={() => createPresentation(analysis)} className="px-14 py-6 bg-slate-100 text-slate-950 hover:bg-white font-black rounded-[24px] shadow-2xl transition-all transform hover:scale-105 active:scale-95 flex items-center gap-4 text-lg">
                    修正内容でPPT保存
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-24 text-center">
                <p className="text-slate-500 italic">資料をアップロードすると、ここに解説スクリプトが表示されます。</p>
              </div>
            )}
          </StepCard>

          <StepCard number={3} title="動画の完成" active={appState.status === 'completed'} completed={appState.status === 'completed'}>
            {videoUrl ? (
              <div className="flex flex-col items-center py-10 animate-in zoom-in-95 duration-500">
                <div className="w-full max-w-4xl aspect-video rounded-[40px] overflow-hidden shadow-2xl border-4 border-slate-800 bg-black mb-14">
                  <video src={videoUrl} controls className="w-full h-full object-contain" />
                </div>
                <div className="flex flex-wrap justify-center gap-8">
                  <a href={videoUrl} download="ai_presentation_video.webm" className="px-16 py-7 bg-green-600 hover:bg-green-500 text-white font-black rounded-[28px] shadow-2xl transition-all transform hover:scale-105 flex items-center gap-4 text-xl">
                    動画を保存
                  </a>
                  <button onClick={() => window.location.reload()} className="px-16 py-7 bg-slate-800 hover:bg-slate-700 text-white font-black rounded-[28px] transition-all border border-slate-700 text-xl">
                    新しく作成
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-24 text-center opacity-30 italic">
                動画生成完了後に、こちらからプレビューと保存が可能です。
              </div>
            )}
          </StepCard>
        </main>
        
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {appState.status === 'error' && (
        <div className="fixed inset-0 bg-black/95 flex items-center justify-center p-6 z-[100] animate-in fade-in duration-300">
          <div className="bg-slate-900 p-12 rounded-[48px] border border-red-500/30 text-center max-w-xl w-full">
            <h2 className="text-3xl font-black mb-6 text-white">エラーが発生しました</h2>
            <p className="text-slate-400 mb-10 text-lg leading-relaxed">{appState.error}</p>
            <button onClick={() => window.location.reload()} className="w-full py-6 bg-red-600 hover:bg-red-500 text-white font-black rounded-[24px] shadow-2xl transition-all text-xl">リロードして再試行</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
