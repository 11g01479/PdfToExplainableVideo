
import { GoogleGenAI } from "@google/genai";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

function decode(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

async function decodeAudioData(data, ctx, sampleRate, numChannels) {
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let ch = 0; ch < numChannels; ch++) {
    const chData = buffer.getChannelData(ch);
    for (let i = 0; i < frameCount; i++) chData[i] = dataInt16[i * numChannels + ch] / 32768.0;
  }
  return buffer;
}

async function withRetry(fn, retries = 3, delay = 1000) {
  try { return await fn(); } catch (err) {
    if (retries <= 0) throw err;
    console.warn(`Retrying API call... (${retries} left)`);
    await new Promise(r => setTimeout(r, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

export const generateSpeechForText = async (text, audioCtx) => {
  const ai = getAI();
  const safeText = (text || "").trim() || "解説はありません。";
  return await withRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text: `落ち着いたトーンで丁寧に読み上げてください： ${safeText}` }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
      }
    });
    const base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64) throw new Error("音声データの取得に失敗しました。");
    const bytes = decode(base64);
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

  try {
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
      throw new Error("AIからの応答が空です。APIキーの設定や制限を確認してください。");
    }
    
    try {
      return JSON.parse(resultText);
    } catch (parseError) {
      console.error("JSON Parse Error:", resultText);
      throw new Error("AIの応答を解析できませんでした（JSON形式エラー）。");
    }
  } catch (apiError) {
    console.error("Gemini API Error:", apiError);
    throw new Error(`AI解析中にエラーが発生しました: ${apiError.message}`);
  }
};
