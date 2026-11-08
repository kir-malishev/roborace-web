"use strict";

const assert = require("assert");
const {launchBrowser, openUser, startSandbox, stopSandbox} = require("./browser-support");

const port = process.env.PAUSE_BROWSER_PORT || "3045";
const {server, ready} = startSandbox(port);
let browser;

(async () => {
    await ready;
    browser = await launchBrowser();
    const host = (await openUser(browser, {port, room: "pause-browser", name: "Host", viewport: {width: 1200, height: 900}})).page;
    const guest = (await openUser(browser, {port, room: "pause-browser", name: "Guest", viewport: {width: 1200, height: 900}})).page;
    const viewer = (await openUser(browser, {port, room: "pause-browser", name: "Viewer", viewport: {width: 1200, height: 900}})).page;
    const kicked = (await openUser(browser, {port, room: "pause-browser", name: "Kicked", viewport: {width: 1200, height: 900}})).page;
    await host.getByRole("button", {name: "Присоединиться к игре"}).click();
    await guest.getByRole("button", {name: "Присоединиться к игре"}).click();
    await host.locator(".lobby-member", {hasText: "Guest"}).waitFor();
    await host.getByRole("button", {name: "Начать игру"}).click();
    await host.locator(".program").waitFor();
    await guest.locator(".program").waitFor();
    await host.locator(".rr-game-spectator", {hasText: "Viewer"}).waitFor();
    assert.equal(await viewer.locator(".rr-game-role-actions").count(), 0,
        "spectator can change role without a pause");

    const guestControls = host.locator(".player-row", {hasText: "Guest"});
    assert.equal(await guestControls.locator('[aria-label="Перевести в зрители"]').count(), 1,
        "host cannot move a player to spectators during the game");

    assert.equal(await host.locator(".game-pause-controls").count(), 1, "host pause panel is missing");
    assert.equal(await guest.locator(".game-pause-controls").count(), 0, "guest can see host controls");
    await host.locator(".game-pause-controls .pause").click();
    await host.locator(".pause-banner").waitFor();
    await guest.locator(".pause-banner").waitFor();
    await viewer.getByRole("button", {name: "Войти в игру"}).click();
    await viewer.locator(".program").waitFor();
    await host.waitForFunction(() => document.querySelector(".log")?.textContent?.includes("стартовой клетке 3"));
    assert.equal(await host.locator(".player-row").count(), 3, "third player did not appear in the race");
    await guest.getByRole("button", {name: "Стать зрителем"}).click();
    await host.locator(".rr-game-spectator", {hasText: "Guest"}).waitFor();
    assert.equal(await host.locator(".player-row").count(), 2, "departing robot remained in the roster");
    await guest.getByRole("button", {name: "Войти в игру"}).click();
    await guest.locator(".program").waitFor();
    await viewer.getByRole("button", {name: "Стать зрителем"}).click();
    await host.locator(".rr-game-spectator", {hasText: "Viewer"}).waitFor();
    const kickedSpectator = host.locator(".rr-game-spectator", {hasText: "Kicked"});
    await kickedSpectator.getByRole("button", {name: "Удалить зрителя"}).click();
    await host.locator(".popup_modals .btn_pmry").click();
    await kickedSpectator.waitFor({state: "detached"});
    assert(await host.locator(".game-pause-controls button", {hasText: "Продолжить"}).count());
    assert(await guest.locator(".card").first().isDisabled(), "program cards remain interactive during pause");

    await host.locator(".game-pause-controls .resume").click();
    await host.locator(".pause-banner").waitFor({state: "detached"});
    await guest.locator(".pause-banner").waitFor({state: "detached"});
    assert.equal(await viewer.locator(".rr-game-role-actions").count(), 0,
        "role controls stayed available after resume");
    assert(!await guest.locator(".card").first().isDisabled(), "program cards did not unlock after resume");

    await guestControls.locator('[aria-label="Передать хоста"]').click();
    await host.locator(".popup_modals .btn_pmry").click();
    await guest.locator(".game-pause-controls").waitFor();
    const formerHost = guest.locator(".player-row", {hasText: "Host"});
    await formerHost.locator('[aria-label="Перевести в зрители"]').click();
    await guest.locator(".popup_modals .btn_pmry").click();
    await formerHost.waitFor({state: "detached"});
    await guest.locator(".winner", {hasText: "Guest"}).waitFor();
    assert.equal(await guest.locator(".log", {hasText: "переведён хостом в зрители"}).count(), 1,
        "moving a player to spectators was not recorded in the log");
    console.log("Host pause browser controls passed.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(async () => {
    if (browser) await browser.close();
    stopSandbox(server);
});
