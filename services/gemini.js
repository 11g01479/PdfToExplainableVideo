
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
    if (!base64) throw new Error("音声生成に失敗しました。");
    const bytes = decode(base64);
    return await decodeAudioData(bytes, audioCtx, 24000, 1);
  });
};

/**
 * PDFドキュメントを一括解析する
 */
export const analyzePdfForPpt = async (base64Data, pageCount) => {
  const ai = getAI();
  const prompt = `このPDFドキュメントを全${pageCount}ページ分、ページごとに分析し、各ページのタイトルと「スピーカーノート（丁寧な語り口の解説文）」を作成してください。
出力は必ず以下のJSONフォーマットで回答してください。

{
  "presentationTitle": "ドキュメント全体のタイトル",
  "summary": "内容の簡単な要約",
  "slides": [
    { "pageIndex": 0, "title": "そのページのタイトル", "notes": "ナレーション用の解説文" }
  ]
}`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { mimeType: 'application/pdf', data: base64Data } },
        { text: prompt }
      ]
    },
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
  if (!resultText) throw new Error("AI解析結果が取得できませんでした。");
  return JSON.parse(resultText);
};
