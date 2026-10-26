/**
 * Content-Security-Policy, shared by the server headers (next.config.ts) and the <meta> tag
 * used by static exports, where the host cannot be configured to send headers.
 * MediaPipe is self-hosted under /mediapipe; the CDN hosts are only a fallback.
 */
export function contentSecurityPolicy({ dev = false, meta = false } = {}) {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''} https://cdn.jsdelivr.net`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // AI assistant providers (the user's own key), and the local companion (GitHub Copilot, MCP).
    "connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com https://api.openai.com https://*.openai.azure.com https://*.cognitiveservices.azure.com http://127.0.0.1:*",
    "worker-src 'self' blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Browsers ignore (and warn about) frame-ancestors in a <meta> tag.
    ...(meta ? [] : ["frame-ancestors 'none'"]),
  ].join('; ');
}
