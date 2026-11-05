import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// ghostwriting.ws is a custom apex domain: assets live at "/", not /BookWriter/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/",
});
