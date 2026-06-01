import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// https://vite.dev/config/
const backendTarget = process.env.VITE_BACKEND_TARGET || "http://localhost:3101";
const livekitSignalingTarget = process.env.VITE_LIVEKIT_SIGNALING_TARGET || "ws://localhost:7888";

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    https: {},
    proxy: {
      "/token": {
        target: backendTarget,
      },
      "/health": {
        target: backendTarget,
      },
      "/recording": {
        target: backendTarget,
      },
      "/recordings": {
        target: backendTarget,
      },
      "/livekit": {
        target: livekitSignalingTarget,
        ws: true,
        rewrite: (path) => path.replace(/^\/livekit/, ""),
      },
    },
  },
});
