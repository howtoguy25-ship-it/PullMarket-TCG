// Web-only "Sign in with Google" using Google Identity Services' popup
// authorization-code flow. We use the code flow (not the One Tap / idToken
// flow) because it opens a real popup in direct response to the user's
// click, which browsers don't block the way they increasingly block
// third-party-cookie-dependent One Tap prompts.
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initCodeClient(config: {
            client_id: string;
            scope: string;
            ux_mode: "popup";
            callback: (response: { code?: string; error?: string }) => void;
          }): { requestCode(): void };
        };
      };
    };
  }
}

let scriptLoadPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Sign-In script"));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

/** Kicks off loading the Google Identity Services script ahead of time (e.g.
 * on screen mount) so the actual sign-in call can run the popup synchronously
 * within the click handler — see the note in signInWithGoogleWeb below. */
export function preloadGoogleScript(): void {
  loadGoogleScript().catch(() => {
    // Swallow here — signInWithGoogleWeb will surface a real error if the
    // user actually tries to sign in and the script still isn't available.
  });
}

function openGooglePopup(clientId: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const codeClient = window.google!.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: "openid email profile",
      ux_mode: "popup",
      callback: (response) => {
        if (response.code) resolve(response.code);
        else reject(new Error(response.error || "Google sign-in was cancelled"));
      },
    });
    codeClient.requestCode();
  });
}

/**
 * Opens Google's sign-in popup and resolves with a one-time authorization
 * code for the server to exchange for tokens. Must be called directly from
 * a user gesture (e.g. a button's onPress) or the popup may be blocked.
 *
 * Safari (and increasingly other browsers) only treats a popup as
 * "user-initiated" if it's opened synchronously within the click handler —
 * any `await` in between silently loses that trust, and the popup never
 * opens with no error callback either, leaving a naive implementation stuck
 * loading forever. So: if the script is already loaded (the normal case,
 * since callers should preload it on mount), open the popup synchronously.
 * Only fall back to the async load-then-open path if it truly isn't ready
 * yet, and race everything against a timeout so a blocked/never-appearing
 * popup fails clearly instead of spinning forever.
 */
export function signInWithGoogleWeb(clientId: string): Promise<string> {
  const attempt = window.google?.accounts?.oauth2 ? openGooglePopup(clientId) : loadGoogleScript().then(() => openGooglePopup(clientId));

  const timeout = new Promise<string>((_, reject) => {
    setTimeout(() => reject(new Error("Google sign-in didn't respond — your browser may have blocked the popup. Check your popup blocker and try again.")), 45000);
  });

  return Promise.race([attempt, timeout]);
}
