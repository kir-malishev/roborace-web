"use strict";

const fs = require("fs");
const path = require("path");
const {spawn} = require("child_process");
const {chromium} = require("playwright-core");

const gameDir = path.resolve(__dirname, "..");
const sandboxDir = path.resolve(process.env.MEME_POLICE_SANDBOX_DIR || path.join(gameDir, "..", "meme-police-sandbox"));
const sandboxEntry = path.join(sandboxDir, "server.js");

function startSandbox(port, {restore = false} = {}) {
    if (!fs.existsSync(sandboxEntry))
        throw new Error(`meme-police-sandbox не найден: ${sandboxEntry}`);
    const server = spawn(process.execPath, [sandboxEntry, "--port", String(port), ...(restore ? [] : ["--no-restore"]), gameDir], {
        cwd: sandboxDir,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let errorOutput = "";
    server.stdout.on("data", (chunk) => output += String(chunk));
    server.stderr.on("data", (chunk) => errorOutput += String(chunk));
    const ready = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`sandbox timeout\n${output}\n${errorOutput}`)), 12000);
        const checkReady = (chunk) => {
            if (!String(chunk).includes(`localhost:${port}`)) return;
            clearTimeout(timeout);
            resolve();
        };
        server.stdout.on("data", checkReady);
        server.once("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        server.once("exit", (code) => {
            clearTimeout(timeout);
            reject(new Error(`sandbox exited: ${code}\n${output}\n${errorOutput}`));
        });
    });
    return {server, ready, output: () => output, errors: () => errorOutput};
}

async function launchBrowser() {
    const options = {headless: true};
    if (process.env.ROBORACE_BROWSER_PATH)
        options.executablePath = process.env.ROBORACE_BROWSER_PATH;
    else
        options.channel = "chrome";
    return chromium.launch(options);
}

async function openUser(browser, {port, room, name, viewport = {width: 1280, height: 900}, timeout = 20000, hasTouch = false}) {
    const context = await browser.newContext({viewport, hasTouch});
    await context.addInitScript(() => localStorage.updatesVersion = "999999");
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    await page.goto(`http://127.0.0.1:${port}/bg/roborace?name=${encodeURIComponent(name)}#${encodeURIComponent(room)}`,
        {waitUntil: "domcontentloaded", timeout: 15000});
    await page.locator(".lobby-shell").waitFor();
    const roomDialog = page.locator(".room-mode-dialog");
    if (await roomDialog.isVisible().catch(() => false))
        await roomDialog.locator(".room-mode-dialog-ok").click();
    return {context, page};
}

function stopSandbox(server) {
    if (server && server.exitCode == null)
        server.kill();
}

async function screenshot(page,options){
    if(!process.env.ROBORACE_SCREENSHOTS)return;
    fs.mkdirSync(path.dirname(options.path),{recursive:true});
    await page.screenshot(options);
}

module.exports = {launchBrowser, openUser, startSandbox, stopSandbox, screenshot};
