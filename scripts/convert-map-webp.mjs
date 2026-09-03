import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "../frontend/node_modules/playwright/index.mjs";

const input = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "");
if (!process.argv[2] || !process.argv[3]) {
  throw new Error(
    "Aufruf: node scripts/convert-map-webp.mjs quelle.png ziel.webp",
  );
}

const source = await readFile(input);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const encoded = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    return canvas.toDataURL("image/webp", 0.92).split(",", 2)[1];
  }, source.toString("base64"));
  await writeFile(output, Buffer.from(encoded, "base64"));
} finally {
  await browser.close();
}
