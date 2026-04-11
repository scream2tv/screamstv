// Screams — input sanitization for chat / tip messages
//
// Zero-dependency escape. Applied at both the REST and WebSocket entry
// points (see src/routes/v1/chat.ts, src/routes/v1/tips.ts, src/ws/handler.ts)
// so that anything we store or broadcast is already safe to render as
// text in any HTML context.

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// Strip:
//   U+0000-U+001F   C0 controls (including CR/LF/TAB — chat is single-line)
//   U+007F          DEL
//   U+200B-U+200F   ZWSP, ZWNJ, ZWJ, LRM, RLM
//   U+202A-U+202E   bidi override characters (used in impersonation attacks)
//   U+2060-U+2064   word joiner / invisible operators
//   U+FEFF          byte-order mark / zero-width no-break space
// Anything else (normal text, emoji, CJK, combining marks) is preserved.
const INVISIBLE_RE = /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

export function sanitizeChat(input: string): string {
  return input
    .replace(INVISIBLE_RE, '')
    .replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]!);
}
