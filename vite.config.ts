import { defineConfig } from "vitest/config";

// base relatif : le site fonctionne quel que soit le dossier où il est publié
export default defineConfig({
  base: "./",
  // date de compilation (jour, heure locale), affichée dans la barre et dans « À propos »
  define: { BUILD_DATE: JSON.stringify(new Date().toLocaleString("sv").slice(0, 16)) },
  test: { include: ["tests/**/*.test.ts"] },
});
