import minecraftLinting from "eslint-plugin-minecraft-linting";
import ts from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/scripts/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module"
    },
    plugins: {
      "minecraft-linting": minecraftLinting,
      ts
    },
    rules: {
      "minecraft-linting/avoid-unnecessary-command": "error"
    }
  }
];
