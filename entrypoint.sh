#!/bin/sh
# Substitute runtime environment variables into the compiled Angular bundle.
# The production environment.prod.ts uses placeholder strings that get baked
# into the JS at build time; this script replaces them at container startup.
find /usr/share/nginx/html -name '*.js' -exec sed -i \
  -e "s|__ALFRESCO_URL__|${ALFRESCO_URL}|g" \
  -e "s|__NUXEO_URL__|${NUXEO_URL}|g" \
  -e "s|__RAG_URL__|${RAG_URL}|g" \
  -e "s|__CONNECTORS_URL__|${CONNECTORS_URL}|g" \
  -e "s|__ENTRA_CLIENT_ID__|${ENTRA_CLIENT_ID}|g" \
  -e "s|__ENTRA_TENANT_ID__|${ENTRA_TENANT_ID}|g" \
  {} \;
exec nginx -g 'daemon off;'
