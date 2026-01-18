
import JSZip from 'jszip';

export interface ExtractedPptx {
  slides: {
    title: string;
    notes: string;
    content: string[]; // 箇条書きなどのメインテキスト
    index: number;
  }[];
}

export const parsePptxNotes = async (file: File): Promise<ExtractedPptx> => {
  const zip = await JSZip.loadAsync(file);
  const slides: { title: string; notes: string; content: string[]; index: number }[] = [];
  
  const slideFiles = Object.keys(zip.files)
    .filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)![0]);
      const numB = parseInt(b.match(/\d+/)![0]);
      return numA - numB;
    });
  
  for (let i = 1; i <= slideFiles.length; i++) {
    const slideXmlPath = `ppt/slides/slide${i}.xml`;
    const notesXmlPath = `ppt/notesSlides/notesSlide${i}.xml`;
    
    let title = "";
    let content: string[] = [];
    let notes = "";

    // スライド内容の抽出
    try {
      const slideXmlText = await zip.file(slideXmlPath)?.async("string");
      if (slideXmlText) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(slideXmlText, "text/xml");
        
        // 全てのテキスト要素を取得
        const textElements = Array.from(xmlDoc.getElementsByTagName("a:t"));
        const texts = textElements.map(t => t.textContent?.trim() || "").filter(t => t.length > 0);
        
        if (texts.length > 0) {
          title = texts[0]; // 最初のテキストをタイトルと仮定
          content = texts.slice(1, 6); // 以降の数行をコンテンツとして表示
        }
      }
    } catch (e) {
      console.warn(`Slide ${i} text extraction failed`, e);
    }

    // ノートの抽出
    try {
      const notesXmlText = await zip.file(notesXmlPath)?.async("string");
      if (notesXmlText) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(notesXmlText, "text/xml");
        const texts = Array.from(xmlDoc.getElementsByTagName("a:t")).map(t => t.textContent || "");
        notes = texts.join(" ").trim();
      }
    } catch (e) {
      console.warn(`Note ${i} extraction failed`, e);
    }

    slides.push({ 
      title: title || `スライド ${i}`, 
      content, 
      notes: notes || "（解説なし）", 
      index: i - 1 
    });
  }

  return { slides };
};
