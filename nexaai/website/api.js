// Shared fetch helper for the NexaAi account website. Talks to the same
// Express API the mobile app uses (see nexaai/server) — set window.NEXAAI_API_URL
// via a <script> tag if the API isn't on the same origin as this site.
const API_URL = window.NEXAAI_API_URL || "";

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
