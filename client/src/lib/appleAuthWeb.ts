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

/**
 * Opens Apple's sign-in popup and resolves with the identity token (plus
 * the user's name, only present on their very first authorization). Must be
 * called directly from a user gesture or the popup may be blocked.
 */
export async function signInWithAppleWeb(servicesId: string): Promise<AppleWebSignInResult> {
  await loadAppleScript();
  if (!window.AppleID?.auth) throw new Error("Sign in with Apple script didn't load");

  window.AppleID.auth.init({
    clientId: servicesId,
    scope: "name email",
    redirectURI: window.location.origin,
    usePopup: true,
  });

  const response = await window.AppleID.auth.signIn();
  return {
    identityToken: response.authorization.id_token,
    fullName: response.user?.name ? { givenName: response.user.name.firstName, familyName: response.user.name.lastName } : undefined,
  };
}
