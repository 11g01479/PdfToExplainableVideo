
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { AnalysisResult, ModelName } from "../types";

const getAIClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

// Base64デコード (手動実装: システム指示に準拠)
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// PCMデータをAudioBufferに変換 (堅牢性を向上)
async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  // data.bufferが他のビューと共有されている可能性があるため、byteOffsetとbyteLengthを指定
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // 16bit PCM (-32768 to 32767) を float (-1.0 to 1.0) に変換
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// 指数バックオフ付きリトライ関数
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    console.warn(`API呼び出し失敗。リトライ中... 残り${retries}回`, error);
    await new Promise(resolve => setTimeout(resolve, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

export const generateSpeechForText = async (text: string, audioCtx: AudioContext): Promise<AudioBuffer> => {
  const ai = getAIClient();
  
  // テキストが空、または短すぎる場合のガード
  const safeText = text.trim().length > 0 ? text.trim() : "（説明なし）";

  return await withRetry(async () => {
    const response = await ai.models.generateContent({
      model: ModelName.TTS,
      contents: [{ parts: [{ text: `落ち着いたトーンで丁寧に読み上げてください： ${safeText}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      console.error("API Response Parts:", response.candidates?.[0]?.content?.parts);
      throw new Error("音声データの生成に失敗しました（データが空です）");
    }

    const audioBytes = decode(base64Audio);
    return await decodeAudioData(audioBytes, audioCtx, 24000, 1);
  });
};

export const analyzePdfForPpt = async (base64Pdf: string, pageCount: number): Promise<AnalysisResult> => {
  const ai = getAIClient();
  
  const prompt = `このドキュメントをページごとに分析してください。
【総ページ数】: ${pageCount}ページ

1. 全 ${pageCount} ページを1枚ずつのスライドとして構成してください。
2. 各ページに対して、「スライドタイトル」と、ナレーション用の「スピーカーノート」を作成してください。
3. 全てのページ（0 から ${pageCount - 1}）を漏れなく含めてください。

以下のJSONフォーマットで回答してください：
{
  "presentationTitle": "タイトル",
  "summary": "全体の要約",
  "slides": [
    {
      "pageIndex": 0,
      "title": "タイトル",
      "notes": "丁寧な解説文"
    }
  ]
}`;

  const response = await ai.models.generateContent({
    model: ModelName.TEXT,
    contents: {
      parts: [
        { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
        { text: prompt }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          presentationTitle: { type: Type.STRING },
          summary: { type: Type.STRING },
          slides: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                pageIndex: { type: Type.INTEGER },
                title: { type: Type.STRING },
                notes: { type: Type.STRING }
              },
              required: ["pageIndex", "title", "notes"]
            }
          }
        },
        required: ["presentationTitle", "summary", "slides"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("AIから有効な解析結果が得られませんでした。");

  const result: AnalysisResult = JSON.parse(text);
  result.slides.sort((a, b) => a.pageIndex - b.pageIndex);
  return result;
};
