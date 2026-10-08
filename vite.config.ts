import { defineConfig } from "vitest/config";

// base relatif : le site fonctionne quel que soit le dossier où il est publié
export default defineConfig({
  base: "./",
  test: { include: ["tests/**/*.test.ts"] },
});
