export function encodeUtf8Base64Url(value: string): string {
  const binary = encodeURIComponent(value).replace(
    /%([0-9A-F]{2})/g,
    (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))
  );
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeUtf8Base64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid Base64 URL encoding.");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  let percentEncoded = "";
  for (let index = 0; index < binary.length; index += 1) {
    percentEncoded += `%${binary.charCodeAt(index).toString(16).padStart(2, "0")}`;
  }
  return decodeURIComponent(percentEncoded);
}
