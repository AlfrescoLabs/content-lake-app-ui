import { Injectable } from '@angular/core';
import {
  AccountInfo, BrowserCacheLocation, InteractionRequiredAuthError, IPublicClientApplication, PublicClientApplication
} from '@azure/msal-browser';
import { environment } from '../../environments/environment';

/** Who signed in with Microsoft, and the token for this application's own API. */
export interface MicrosoftSignIn {
  username: string;
  name: string;
  accessToken: string;
}

/** Builds the MSAL client. Replaced in specs, so no test talks to Entra ID. */
export type MsalFactory = (clientId: string, tenantId: string) => IPublicClientApplication;

export const defaultMsalFactory: MsalFactory = (clientId, tenantId) => new PublicClientApplication({
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    // The origin, not a route: the registration lists origins only, and the popup lands on the app's root.
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin
  },
  // Per tab, like the Alfresco ticket: the session ends with the tab that earned it.
  cache: { cacheLocation: BrowserCacheLocation.SessionStorage }
});

/**
 * Microsoft sign-in for the SharePoint source, through the `content-lake-ui` app registration.
 *
 * The token is for this application's own API (`api://<client-id>/access_as_user`), never for Microsoft
 * Graph. rag-service checks the audience, so a Graph token is rejected there by design. Sending one would
 * also be the wrong thing to do: the caller's identity has to come from a token minted for us alone.
 *
 * Off when `environment.entraClientId` or `environment.entraTenantId` is empty, which is the default.
 */
@Injectable({ providedIn: 'root' })
export class MicrosoftAuthService {

  /** Overridable in specs before first use. */
  static factory: MsalFactory = defaultMsalFactory;

  private client: IPublicClientApplication | null = null;
  private initialized: Promise<IPublicClientApplication> | null = null;

  get enabled(): boolean {
    return !!environment.entraClientId && !!environment.entraTenantId;
  }

  /** The one scope requested. Exposed so specs and the sign-in card name the same thing. */
  get scope(): string {
    return `api://${environment.entraClientId}/access_as_user`;
  }

  /** Opens the Microsoft sign-in popup. */
  async signIn(): Promise<MicrosoftSignIn> {
    const msal = await this.msal();
    const result = await msal.loginPopup({ scopes: [this.scope], prompt: 'select_account' });
    msal.setActiveAccount(result.account);
    return toSignIn(result.account, result.accessToken);
  }

  /**
   * The signed-in account restored from this tab's MSAL cache, with a fresh token, or null.
   * Null also when the token cannot be renewed without the user, so a stale sign-in is not kept.
   */
  async restore(): Promise<MicrosoftSignIn | null> {
    if (!this.enabled) return null;
    const msal = await this.msal();
    const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null;
    if (!account) return null;
    msal.setActiveAccount(account);
    const token = await this.accessToken();
    return token ? toSignIn(account, token) : null;
  }

  /**
   * A current token for the signed-in account. MSAL answers from its cache and renews close to expiry.
   * Null when no account is signed in or renewal needs the user again.
   */
  async accessToken(): Promise<string | null> {
    if (!this.enabled) return null;
    const msal = await this.msal();
    const account = msal.getActiveAccount();
    if (!account) return null;
    try {
      return (await msal.acquireTokenSilent({ scopes: [this.scope], account })).accessToken;
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) return null;
      throw err;
    }
  }

  /**
   * Forgets the account in this tab. Local only: it does not sign the user out of Microsoft everywhere,
   * which a demo on a shared machine would find surprising, and it needs no second popup.
   */
  async signOut(): Promise<void> {
    if (!this.client) return;
    const msal = await this.msal();
    msal.setActiveAccount(null);
    await msal.clearCache();
  }

  private msal(): Promise<IPublicClientApplication> {
    if (!this.enabled) return Promise.reject(new Error('Microsoft sign-in is not configured.'));
    if (!this.initialized) {
      this.client = MicrosoftAuthService.factory(environment.entraClientId, environment.entraTenantId);
      const client = this.client;
      this.initialized = client.initialize().then(() => client);
    }
    return this.initialized;
  }
}

function toSignIn(account: AccountInfo, accessToken: string): MicrosoftSignIn {
  return { username: account.username, name: account.name || account.username, accessToken };
}

/**
 * Whether this window is the sign-in popup returning from Microsoft with the answer in its URL.
 *
 * The app must not start in that window. Its router would rewrite the URL to `/login` and drop the answer
 * before the opener reads it, and the sign-in would hang until it timed out.
 */
export function isMsalPopupResponse(): boolean {
  if (typeof window === 'undefined' || !window.opener || window.opener === window) return false;
  const answer = `${window.location.hash}${window.location.search}`;
  return /[#?&]state=/.test(answer) && /[#?&](code|error)=/.test(answer);
}
