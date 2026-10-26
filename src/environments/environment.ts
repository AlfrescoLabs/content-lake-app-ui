export const environment = {
  production: false,
  // Relative URLs — the Angular dev server proxy (proxy.conf.json) forwards
  // these paths to the deployment stack.  No CORS issues, no port hardcoding.
  alfrescoUrl: '',       // auth endpoint becomes /alfresco/api/...
  nuxeoUrl: '/nuxeo',   // auth endpoint becomes /nuxeo/api/v1/me
  ragUrl: '/api/rag',   // search/chat endpoints become /api/rag/...
  // The plugin host, which serves the connector listing, the folder browse, the selection and sync. Empty
  // turns the Sources screen and its nav entry off, which is the default: a deployment without the connector
  // profile has no host to talk to, and a screen that cannot work is worse than one that is absent.
  //
  // The stack proxy does route these same-origin now, and proxy.conf.json forwards them for `ng serve`, so
  // '/api/connectors' is the value to use against a local stack running the connector profile. The host's own
  // published port also works if the proxy is not in play: 'http://localhost:9096/api/connectors'.
  //
  // Only this one is configured; the sibling paths are derived from it in utils/api-paths.ts.
  connectorsUrl: '',
  // Microsoft sign-in for the SharePoint source: the content-lake-ui app registration's client id and its
  // tenant. Both empty turns the Microsoft card off. See services/microsoft-auth.service.ts.
  entraClientId: '',
  entraTenantId: ''
};
