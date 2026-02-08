import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async ({ mode, command }) => {
  const env = loadEnv(mode, ".", "");
  const plugins = [react()];

  if (command === "serve" && env.VITE_USE_LOCAL_SQLITE !== "false") {
    const { localSqliteBoardPlugin } = await import("./localSqliteBoardPlugin");
    plugins.push(localSqliteBoardPlugin());
  }

  return {
    server: {
      port: 3000,
      host: "0.0.0.0",
    },
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
  };
});
