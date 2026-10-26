import { resolveRuntimeUrl } from './runtime-url';

export const environment = {
  production: true,
  // Fall back to same-origin proxy routes when runtime substitution is missing
  // or still points at localhost on a non-local deployment host.
  alfrescoUrl: resolveRuntimeUrl('__ALFRESCO_URL__', ''),
  nuxeoUrl: resolveRuntimeUrl('__NUXEO_URL__', '/nuxeo'),
  ragUrl: resolveRuntimeUrl('__RAG_URL__', '/api/rag'),
  // The plugin host, which serves the connector listing, the folder browse, the selection and sync. Empty
  // turns the Sources screen and its nav entry off, and that is the right default: a deployment without the
  // connector profile has no host, and a screen that cannot work is worse than one that is absent.
  //
  // The deployment sets this to a same-origin path through the proxy, so the browser sends this origin's
  // credential and needs no cross-origin configuration. A loopback URL on a remote host resolves back to the
  // empty fallback, which turns the screen off rather than leaving it failing.
  //
  // Only this one is configured; the sibling paths are derived from it in utils/api-paths.ts.
  connectorsUrl: resolveRuntimeUrl('__CONNECTORS_URL__', ''),
  // Microsoft sign-in for the SharePoint source. Empty, or a placeholder left unsubstituted, turns it off.
  entraClientId: runtimeValue('__ENTRA_CLIENT_ID__'),
  entraTenantId: runtimeValue('__ENTRA_TENANT_ID__')
};

/** A substituted value, or '' while it is still the placeholder. Built so the bundle keeps the placeholder. */
function runtimeValue(value: string): string {
  return value.includes('__') ? '' : value.trim();
}
