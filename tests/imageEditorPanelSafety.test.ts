import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("AI image editor disclosure safety", () => {
  it("uses Huatu-style compressed data URLs without constructing ImageBlob", () => {
    const panelSource = readFileSync(resolve("src/app/AiEditPanel.tsx"), "utf8");
    const previewSource = readFileSync(resolve("src/imageEditor/layerPreview.ts"), "utf8");

    expect(panelSource).not.toContain("ImageBlob");
    expect(previewSource).not.toContain("new ImageBlob");
    expect(panelSource).toContain("readActiveImageEditorLayerPreview");
    expect(panelSource).toContain("<img");
    expect(previewSource).toContain("imagingApi.getPixels");
    expect(previewSource).toContain("imagingApi.encodeImageData");
    expect(previewSource).toContain("data:image/jpeg;base64,");
    expect(previewSource).toContain("targetSize: { height: PREVIEW_TARGET_HEIGHT }");
    expect(panelSource).not.toContain("点击生成后才读取并上传");
    expect(panelSource).not.toContain("输入会先等比适配到 512 × 512 白底");
  });

  it("reuses the AI generation controls and AI outline advanced disclosure", () => {
    const panelSource = readFileSync(resolve("src/app/AiEditPanel.tsx"), "utf8");
    const styles = readFileSync(resolve("src/styles.css"), "utf8");

    expect(panelSource).toContain('className="ai-stepper" aria-label="AI编辑生成数量"');
    expect(panelSource).toContain("const [keepSmartObject, setKeepSmartObject] = useState(false);");
    expect(panelSource).toContain('className="ai-prompt-textarea-shell"');
    expect(panelSource).toContain("className={`centerline-advanced-shell");
    expect(panelSource).toContain('className="ai-prompt-editor image-editor-prompt-editor"');
    expect(panelSource).toContain('minWidth: "100%"');
    expect(panelSource).toContain('maxWidth: "100%"');
    expect(styles).toMatch(/\.image-editor-preview\s*\{[\s\S]*?width:\s*96px;[\s\S]*?height:\s*96px;/);
    expect(styles).toMatch(/\.image-editor-prompt-editor\.ai-prompt-editor\s*\{[\s\S]*?width:\s*100%;[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/);
    expect(styles).toMatch(/\.image-editor-prompt-editor \.ai-prompt-textarea-shell\s*\{[\s\S]*?width:\s*100%;/);
    expect(styles).toMatch(/\.image-editor-prompt-editor\.ai-prompt-editor sp-textarea\s*\{[\s\S]*?min-width:\s*100%;[\s\S]*?max-width:\s*100%;/);
  });
});
