// Shared fetch helper for the NexaAi account website. Talks to the same
// Express API the mobile app uses (see nexaai/server) — set window.NEXAAI_API_URL
// via a <script> tag if the API isn't on the same origin as this site.
const API_URL = window.NEXAAI_API_URL || "";

// The mobile app links out here (client/src/lib/webLinks.ts) for the
// capabilities that only live on web — Owner panel, Developer/API keys,
// full MCP tool schemas, etc. It hands off the current session as a
// one-time `?token=` query param so the user lands already signed in
// instead of hitting this site's own login wall (this page's localStorage
// is separate from the app's SecureStore/localStorage — there's no other
// way for it to already know who's signed in). Consumed once, then
// stripped from the URL so it never lingers in history or gets shared.
(function consumeTokenHandoff() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (!token) return;
  localStorage.setItem("nexaai_token", token);
  params.delete("token");
  const rest = params.toString();
  window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
})();

function getToken() {
  return localStorage.getItem("nexaai_token");
}
function setToken(token) {
  localStorage.setItem("nexaai_token", token);
}
function clearToken() {
  localStorage.removeItem("nexaai_token");
}

async function api(path, options = {}) {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const body = isJson ? await response.json() : null;
  if (!response.ok) {
    const err = new Error((body && (body.message || body.error)) || `Request failed (${response.status})`);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

function requireLoginOrRedirect() {
  if (!getToken()) window.location.href = "./index.html";
}
