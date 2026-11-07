# The site as a Hugging Face Space (Docker SDK): the same small Node server
# as local preview, serving the pages and the /api checkout functions.
FROM node:22-alpine
WORKDIR /app
# Spaces run as user 1000, which is "node" in this image.
COPY --chown=node . .
USER node
ENV PORT=7860
EXPOSE 7860
CMD ["node", "dev-server.mjs"]
