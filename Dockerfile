FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package*.json ./
COPY --chown=node:node apps ./apps
COPY --chown=node:node packages ./packages
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node tests ./tests
COPY --chown=node:node tsconfig.json vite*.ts eslint.config.js ./
RUN --mount=type=secret,id=build_ca \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --fetch-retries=1 --fetch-timeout=30000 && npm run build
ENV NODE_ENV=production
ENV APP_MODE=discord HOST=0.0.0.0 DATA_DIR=/tmp/evomeme
USER node
EXPOSE 3000
CMD ["npm", "run", "api"]
