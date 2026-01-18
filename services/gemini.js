
import { GoogleGenAI } from "@google/genai";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

// Base64デコード処理
function decode(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

// PCM 16bitデータをAudioBufferに変換する処理を改善
async function decodeAudioData(data, ctx, sampleRate, numChannels) {
  // 16bit(2bytes)のアライメントを確認
  const buffer = data.buffer;
  const byteOffset = data.byteOffset;
  const byteLength = data.byteLength;
  
  // バッファをコピーして新しいArrayBufferとして扱う（アライメントエラー防止）
  const actualData = new Int16Array(buffer.slice(byteOffset, byteOffset + byteLength));
  
  const frameCount = actualData.length / numChannels;
  const audioBuffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const chData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < frameCount; i++) {
      // 16bit PCM (-32768 to 32767) を float (-1.0 to 1.0) に正規化
      chData[i] = actualData[i * numChannels + ch] / 32768.0;
    }
  }
  return audioBuffer;
}

async function withRetry(fn, retries = 3, delay = 1500) {
  try { return await fn(); } catch (err) {
    if (retries <= 0) throw err;
    console.warn(`音声合成リトライ中... 残り${retries}回: ${err.message}`);
    await new Promise(r => setTimeout(r, delay));
    return withRetry(fn, retries - 1, delay * 1.5);
  }
}

/**
 * テキストから音声を生成する
 */
export const generateSpeechForText = async (text, audioCtx) => {
  const ai = getAI();
  const safeText = (text || "").trim() || "解説はありません。";
  
  return await withRetry(async () => {
    // AudioContextが停止している場合は再開
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text: `落ち着いたトーンで丁寧に読み上げてください： ${safeText}` }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { 
          voiceConfig: { 
            prebuiltVoiceConfig: { voiceName: 'Kore' } 
          } 
        }
      }
    });

    // レスポンスの検証
    if (response.candidates?.[0]?.finishReason === 'SAFETY') {
      throw new Error("安全性の制限により音声が生成されませんでした。内容を修正してください。");
    }

    const base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64) {
      console.error("Gemini TTS Error Response:", response);
      throw new Error("音声データの取得に失敗しました。APIからのレスポンスが空です。");
    }

    const bytes = decode(base64);
    // Gemini TTSの標準サンプリングレートは24000Hz
    return await decodeAudioData(bytes, audioCtx, 24000, 1);
  });
};

/**
 * PDFドキュメントを一括解析する
 */
export const analyzePdfForPpt = async (base64Data, pageCount) => {
  const ai = getAI();
  const prompt = `このPDFドキュメント（全${pageCount}ページ）を分析し、各ページの内容に基づいたタイトルと、ナレーション用の丁寧な解説文（スピーカーノート）を生成してください。
全てのページを必ず含め、以下のJSONフォーマットで回答してください。

{
  "presentationTitle": "タイトル",
  "summary": "要約",
  "slides": [
    { "pageIndex": 0, "title": "見出し", "notes": "解説文" }
  ]
}`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{
      parts: [
        { inlineData: { mimeType: 'application/pdf', data: base64Data } },
        { text: prompt }
      ]
    }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          presentationTitle: { type: "STRING" },
          summary: { type: "STRING" },
          slides: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                pageIndex: { type: "INTEGER" },
                title: { type: "STRING" },
                notes: { type: "STRING" }
              },
              required: ["pageIndex", "title", "notes"]
            }
          }
        },
        required: ["presentationTitle", "summary", "slides"]
      }
    }
  });

  const resultText = response.text;
  if (!resultText) {
    throw new Error("AIからの解析結果が空です。APIの設定を確認してください。");
  }
  
  return JSON.parse(resultText);
};
