import { shell } from "uxp";
import { assertHolopixCandidateUrl } from "./holopixExternalUrl";

export async function openHolopixCandidateExternally(url: string): Promise<void> {
  const safeUrl = assertHolopixCandidateUrl(url);
  const result = await shell.openExternal(
    safeUrl,
    "在系统浏览器中查看本机 ComfyUI 生成的候选图。"
  );
  if (result) throw new Error(`系统浏览器未能打开候选图：${result}`);
}
