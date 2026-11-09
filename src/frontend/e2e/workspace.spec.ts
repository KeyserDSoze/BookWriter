import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const packageVersion = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {version:string}).version;

const brief = "Un thriller storico realistico, con intrecci a lungo termine, personaggi complessi e misteri distribuiti su più capitoli.";

async function createBook(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Romanzo di prova");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" }).fill(brief);
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText("Libro creato in IndexedDB.")).toBeVisible();
}

test("workspace responsive e accessibile, anche dopo reload", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  const mobile = testInfo.project.name === "mobile-chromium";
  const nav = page.getByRole("navigation", { name: mobile ? "Navigazione mobile" : "Navigazione principale" });
  await expect(nav).toBeVisible();
  const visibleVersion = mobile
    ? page.locator("main header").getByText("v" + packageVersion, {exact:false})
    : page.locator("aside.sidebar").getByText("v" + packageVersion, {exact:false});
  await expect(visibleVersion).toBeVisible();
  await nav.getByRole("button", { name: "Impostazioni" }).click();
  await expect(page.getByRole("heading", { name: "Endpoint OpenAI-compatible" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);

  await nav.getByRole("button", { name: "Dashboard" }).click();
  await createBook(page);
  await page.reload();
  await expect(page.getByText(brief)).toBeVisible();
  await expect(page.getByText("Da avviare · Brainstorming")).toBeVisible();
});

test("autopilot locale si blocca senza Web Locks prima della generazione, desktop/mobile", async ({ page }) => {
  // Simulate a browser without native cross-tab locking before React loads.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  });
  const aiCalls:string[]=[];
  page.on("request",request=>{
    if (/\/chat\/completions|\/responses(?:\?|$)/.test(request.url()))
      aiCalls.push(request.url());
  });
  await createBook(page);
  expect(await page.evaluate(()=>navigator.locks===undefined)).toBe(true);
  await expect(page.getByText("Da avviare · Brainstorming")).toBeVisible();
  await page.getByRole("button",{name:"Autopilot",exact:true}).click();
  await expect(page.getByText(/Web Locks non disponibile: autopilot bloccato/))
    .toBeVisible();
  await expect(page.getByText("Da avviare · Brainstorming")).toBeVisible();
  const persisted=await page.evaluate(()=>new Promise<{
    status:string;phase:string;runningActivities:number;aiRequests:number
  }>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result;
      const tx=db.transaction(["books","activities"],"readonly");
      const books=tx.objectStore("books").getAll();
      const activities=tx.objectStore("activities").getAll();
      tx.onerror=()=>reject(tx.error);
      tx.oncomplete=()=>{
        const book=books.result[0] as {status:string;phase:string};
        const a=activities.result as Array<{status:string;aiRequested?:boolean}>;
        resolve({status:book.status,phase:book.phase,
          runningActivities:a.filter(x=>x.status==="running").length,
          aiRequests:a.filter(x=>x.aiRequested).length});
        db.close();
      };
    };
  }));
  expect(persisted).toEqual({
    status:"idle",phase:"brainstorm",runningActivities:0,aiRequests:0,
  });
  expect(aiCalls).toEqual([]);
});

test("ZIP di contenuto esportabile e reimportabile senza sovrascrivere", async ({ page }) => {
  await createBook(page);
  const mobile = test.info().project.name === "mobile-chromium";
  if (mobile) {
    const metrics = await page.evaluate(() => {
      const nav = document.querySelector(".mobile-tabs");
      const rect = nav?.getBoundingClientRect();
      return {
        innerWidth: innerWidth, innerHeight: innerHeight, scrollY: scrollY,
        docHeight: document.documentElement.scrollHeight,
        rect: rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } : null,
        position: nav ? getComputedStyle(nav).position : "missing",
        visualHeight: visualViewport?.height,
        visualOffsetTop: visualViewport?.offsetTop,
      };
    });
    console.log("Mobile bottom-nav metrics after book creation:", JSON.stringify(metrics));
  }
  await page.getByRole("button", { name: "Archivio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Backup ZIP", exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Scarica backup ZIP" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/bookwriter-content.*\.zip$/);

  page.on("dialog", dialog => { void dialog.accept(); });
  await page.getByLabel("Archivio BookWriter (.zip)").setInputFiles(await download.path());
  await page.getByRole("button", { name: "Importa ZIP" }).click();
  await expect(page.getByText(/1 libri importati come copie/)).toBeVisible();

  await page.reload();
  const options = page.locator("#book-select option");
  await expect(options).toHaveCount(3);
  await expect(page.locator("#book-select")).toContainText("Romanzo di prova (importato)");
});
