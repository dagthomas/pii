# pii.dagthom.as — SvelteKit (adapter-node) in-browser PII redactor.
# The 1.9 GB model is NOT in this image — it is fetched at runtime from Hugging Face
# (VITE_MODEL_URL, baked at build time). The image ships only the app + ort wasm.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Hugging Face repo hosting the ONNX model (worker appends ".data" for the weights file).
ARG VITE_MODEL_URL="https://huggingface.co/dagthomas/nordicpii/resolve/main/nordic-v14-web.onnx"
ENV VITE_MODEL_URL=${VITE_MODEL_URL}
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["node", "build"]
