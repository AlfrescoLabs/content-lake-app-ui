# Build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY angular.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm install -g @angular/cli@~18.2.0
RUN ng build

# Runtime stage
FROM nginx:alpine
COPY --from=build /app/dist/content-lake-app-ui/browser /usr/share/nginx/html
COPY nginx-app.conf /etc/nginx/conf.d/default.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 80
# Default to same-origin proxy paths. The container's own nginx proxies
# /api/rag, /alfresco/, and /nuxeo/ to the backend services on the Docker
# network, so browser-side absolute hostnames are unnecessary.
ENV ALFRESCO_URL=
ENV NUXEO_URL=/nuxeo
ENV RAG_URL=/api/rag
# Microsoft sign-in stays off unless both are set.
ENV ENTRA_CLIENT_ID=
ENV ENTRA_TENANT_ID=
ENTRYPOINT ["/entrypoint.sh"]
