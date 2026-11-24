import { mkdir } from "node:fs/promises";

const { chromium } = await import("file:///state/runtime/node_modules/playwright/index.mjs");

const profilePath = "/state/gloco-profile";
await mkdir(profilePath, { recursive: true, mode: 0o700 });

const context = await chromium.launchPersistentContext(profilePath, {
  headless: false,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-crash-reporter", "--disable-breakpad"],
  viewport: { width: 1365, height: 850 }
});

const page = context.pages()[0] ?? await context.newPage();
await page.goto("about:blank");
console.log("Private GLOCO login browser is ready; profile is stored under /state.");

await new Promise(() => {});
