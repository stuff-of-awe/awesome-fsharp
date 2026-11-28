// SPDX-License-Identifier: MPL-2.0
// From the repository root: bun test ./tests/mise_config.test.js
import { expect, test } from "bun:test";

const config = Bun.TOML.parse(
    await Bun.file(new URL("../mise.toml", import.meta.url)).text(),
);

// Tool names listed in PR #16's cleanup, including entries already absent.
const removedTools = new Set([
    "node", "python", "go", "java", "npm", "yarn", "pip", "make", "gofmt",
    "black", "isort", "ruff", "pytest", "jest", "vitest", "prettier", "eslint",
]);

test("mise does not declare the removed runtimes or tools", () => {
    const toolKeys = Object.keys(config.tools);
    const removedKeys = toolKeys.filter((key) => {
        // Catch both short names and backend-qualified names such as npm:prettier.
        const toolName = key.slice(key.indexOf(":") + 1);
        return removedTools.has(toolName);
    });
    expect(removedKeys).toEqual([]);
});

test("mise retains the supported toolchain", () => {
    expect(Object.keys(config.tools)).toEqual(expect.arrayContaining([
        "rust", "zig", "bun", "deno", "pnpm", "just", "shfmt", "stylua",
        "cmake", "ninja",
    ]));
});

test("mise does not set Node or Python environment defaults", () => {
    // The env table may be empty or omitted, and unrelated settings are allowed.
    const envKeys = Object.keys(config.env ?? {});
    expect(envKeys.filter(
        (key) => key === "NODE_ENV" || key.startsWith("PYTHON"),
    )).toEqual([]);
});

test("the historical aliases do not register alongside Just recipes", () => {
    expect(config).not.toHaveProperty("alias");
    const oldTaskNames = ["task", "build", "test", "lint", "fmt"];
    expect(Object.keys(config.tasks ?? {}).filter(
        (key) => oldTaskNames.includes(key),
    )).toEqual([]);
});
