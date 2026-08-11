// Web-only "Sign in with Apple" using Apple's own JS SDK in popup mode —
// mirrors the approach in googleAuth.ts (a real popup in direct response to
// the user's click, not a full-page redirect).
declare global {
  interface Window {
    AppleID?: {
      auth: {
        init(config: { clientId: string; scope: string; redirectURI: string; usePopup: true }): void;
        signIn(): Promise<{
          authorization: { id_token: string; code: string };
          user?: { name?: { firstName?: string; lastName?: string }; email?: string };
        }>;
      };
    };
  }
}

let scriptLoadPromise: Promise<void> | null = null;

function loadAppleScript(): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    if (window.AppleID?.auth) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Sign in with Apple script"));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

export interface AppleWebSignInResult {
  identityToken: string;
  fullName?: { givenName?: string; familyName?: string };
}

/** Kicks off loading Apple's JS SDK ahead of time (e.g. on screen mount) so
 * the actual sign-in call can open the popup synchronously within the click
 * handler — same reasoning as preloadGoogleScript in googleAuth.ts. */
export function preloadAppleScript(): void {
  loadAppleScript().catch(() => {
    // Swallow here — signInWithAppleWeb will surface a real error if the
    // user actually tries to sign in and the script still isn't available.
  });
}

function openApplePopup(servicesId: string): Promise<AppleWebSignInResult> {
  window.AppleID!.auth.init({
    clientId: servicesId,
    scope: "name email",
    redirectURI: window.location.origin,
    usePopup: true,
  });

  return window.AppleID!.auth.signIn().then((response) => ({
    identityToken: response.authorization.id_token,
    fullName: response.user?.name ? { givenName: response.user.name.firstName, familyName: response.user.name.lastName } : undefined,
  }));
}

/**
 * Opens Apple's sign-in popup and resolves with the identity token (plus
 * the user's name, only present on their very first authorization).
 *
 * Safari (and increasingly other browsers) only treats a popup as
 * "user-initiated" if it's opened synchronously within the click handler —
 * any `await` in between silently loses that trust, and the popup never
 * opens with no error callback either, leaving a naive implementation stuck
 * loading forever. So: if the script is already loaded (the normal case,
 * since callers should call preloadAppleScript on mount), open the popup
 * synchronously. Only fall back to the async load-then-open path if it
 * truly isn't ready yet, and race everything against a timeout so a
 * blocked/never-appearing popup fails clearly instead of spinning forever.
 */
export function signInWithAppleWeb(servicesId: string): Promise<AppleWebSignInResult> {
  const attempt = window.AppleID?.auth ? openApplePopup(servicesId) : loadAppleScript().then(() => openApplePopup(servicesId));

  const timeout = new Promise<AppleWebSignInResult>((_, reject) => {
    setTimeout(() => reject(new Error("Apple sign-in didn't respond — your browser may have blocked the popup. Check your popup blocker and try again.")), 45000);
  });

  return Promise.race([attempt, timeout]);
}
