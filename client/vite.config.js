import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // "localhost" binds IPv6-only here, so http://127.0.0.1:5173 was refused
    // while http://localhost:5173 worked. An unspecified host listens on both,
    // which matches Express. strictPort keeps the origin inside the CORS list.
    host: true,
    port: 5173,
    strictPort: true,
  },
});
