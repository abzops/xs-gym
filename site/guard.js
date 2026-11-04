// GitHub Pages cannot send frame-ancestors headers (SECURITY.md §7).
// Refuse to render inside a frame to prevent clickjacking.
if (window.top !== window.self) {
  document.documentElement.style.display = "none";
  try { window.top.location = window.self.location; } catch (_) { /* cross-origin: stay hidden */ }
}
