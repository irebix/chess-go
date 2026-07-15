const COMFY_ORIGIN = "http://127.0.0.1:8188";

export function assertHolopixCandidateUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Holopix 候选地址无效。");
  }
  if (url.origin !== COMFY_ORIGIN || url.pathname !== "/view") {
    throw new Error("只允许在系统浏览器中打开本机 ComfyUI 候选图。");
  }
  if (!url.searchParams.get("filename")) {
    throw new Error("Holopix 候选地址缺少文件名。");
  }
  return url.toString();
}
