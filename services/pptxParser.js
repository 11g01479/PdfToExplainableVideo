
import JSZip from 'jszip';

/**
 * PPTXファイルから高精度でテキストとノートを抽出する
 */
export const parsePptxNotes = async (file) => {
  const zip = await JSZip.loadAsync(file);
  const slides = [];
  
  // スライドファイルのリストを取得
  const slideFiles = Object.keys(zip.files)
    .filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'));

  // 数値順に厳密ソート
  slideFiles.sort((a, b) => {
    const aNum = parseInt(a.match(/slide(\d+)\.xml/)?.[1] || "0", 10);
    const bNum = parseInt(b.match(/slide(\d+)\.xml/)?.[1] || "0", 10);
    return aNum - bNum;
  });
  
  const parser = new DOMParser();

  for (const slidePath of slideFiles) {
    const slideNum = slidePath.match(/slide(\d+)\.xml/)?.[1];
    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    
    let title = "";
    let content = [];
    let notes = "";

    // 1. スライド内容のパース
    try {
      const xmlText = await zip.file(slidePath)?.async("string");
      if (xmlText) {
        const doc = parser.parseFromString(xmlText, "text/xml");
        // テキスト要素を再帰的に取得
        const textNodes = Array.from(doc.getElementsByTagNameNS("*", "t"));
        const texts = textNodes.map(t => t.textContent?.trim() || "").filter(t => t.length > 0);
        
        if (texts.length > 0) {
          title = texts[0];
          content = texts.slice(1, 15); // より多くのコンテンツを保持
        }
      }
    } catch (e) {
      console.warn(`Slide ${slideNum} XML parse error:`, e);
    }

    // 2. リレーションシップ（.rels）から正しいノートファイルを特定
    try {
      const relsText = await zip.file(relsPath)?.async("string");
      if (relsText) {
        const relsDoc = parser.parseFromString(relsText, "text/xml");
        const relElements = Array.from(relsDoc.getElementsByTagNameNS("*", "Relationship"));
        
        // Relationship Typeが notesSlide のものを探す
        const noteRel = relElements.find(el => {
          const type = el.getAttribute("Type") || "";
          return type.endsWith("notesSlide");
        });

        if (noteRel) {
          const target = noteRel.getAttribute("Target");
          // Targetは通常 "../notesSlides/notesSlide1.xml" のような相対パス
          const actualNotesPath = "ppt/" + target.replace("../", "");
          
          const notesXmlText = await zip.file(actualNotesPath)?.async("string");
          if (notesXmlText) {
            const notesDoc = parser.parseFromString(notesXmlText, "text/xml");
            const noteTextNodes = Array.from(notesDoc.getElementsByTagNameNS("*", "t"));
            notes = noteTextNodes.map(t => t.textContent || "").join(" ").trim();
          }
        }
      }
    } catch (e) {
      console.debug(`Note relationship for slide ${slideNum} not found or failed.`);
    }

    slides.push({ 
      title: title || `Slide ${slideNum}`, 
      content, 
      notes: notes || "（スピーカーノートが設定されていません）", 
      pageIndex: slides.length
    });
  }

  if (slides.length === 0) {
    throw new Error("スライドを抽出できませんでした。PPTXファイルを確認してください。");
  }

  return { slides };
};
