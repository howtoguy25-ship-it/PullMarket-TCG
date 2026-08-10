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

/**
 * Opens Google's sign-in popup and resolves with a one-time authorization
 * code for the server to exchange for tokens. Must be called directly from
 * a user gesture (e.g. a button's onPress) or the popup may be blocked.
 */
export async function signInWithGoogleWeb(clientId: string): Promise<string> {
  await loadGoogleScript();
  if (!window.google?.accounts?.oauth2) throw new Error("Google Sign-In script didn't load");

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
