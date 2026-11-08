"use strict";

const assert = require("assert");
const {launchBrowser, openUser, startSandbox, stopSandbox} = require("./browser-support");

const port = process.env.HISTORY_BROWSER_PORT || "3046";
const {server, ready} = startSandbox(port);
let browser;

(async () => {
    await ready;
    browser = await launchBrowser();
    const host = (await openUser(browser, {port, room: "history-browser", name: "Host", viewport: {width: 1280, height: 900}})).page;
    const guest = (await openUser(browser, {port, room: "history-browser", name: "Guest", viewport: {width: 1280, height: 900}})).page;
    const viewer = (await openUser(browser, {port, room: "history-browser", name: "Viewer", viewport: {width: 1280, height: 900}})).page;

    await host.getByRole("button", {name: "Присоединиться к игре"}).click();
    await guest.getByRole("button", {name: "Присоединиться к игре"}).click();
    await host.locator(".lobby-member", {hasText: "Guest"}).waitFor();
    await host.getByRole("button", {name: "Начать игру"}).click();
    await host.getByRole("button", {name: "Авто", exact: true}).click();
    await guest.getByRole("button", {name: "Авто", exact: true}).click();
    await host.getByRole("button", {name: "Готов", exact: true}).click();
    await guest.getByRole("button", {name: "Готов", exact: true}).click();

    await host.locator(".stage", {hasText: "Регистр 2 / 5"}).waitFor({timeout: 20000});
    await host.locator(".game-pause-controls button").click();
    await Promise.all([host, guest, viewer].map((page) => page.locator(".history-review-panel").waitFor()));
    assert.equal(await host.locator(".history-review-panel .history-empty").count(), 0, "completed register is missing from history");
    assert.equal(await host.locator(".history-round button", {hasText: "Регистр 1"}).count(), 1);
    assert.equal(await host.locator(".history-round button", {hasText: "Регистр 2"}).count(), 0,
        "unfinished register appeared in history");
    assert(await guest.locator(".history-round button").first().isDisabled(), "non-host can control history");
    assert(await viewer.locator(".history-review-panel").isVisible(), "spectator cannot see the history panel");
    assert.equal(await host.locator(".pause-banner strong").textContent(), "Игра на паузе");
    assert.equal(await host.locator(".pause-banner span").innerText(), "Актуальное состояние");

    const actualRobots = await viewer.locator(".board-overlay .robot").evaluateAll((robots) => robots.map((robot) => ({
        userId: robot.dataset.userId, left: robot.style.left, top: robot.style.top, angle: robot.style.getPropertyValue("--robot-angle")
    })));
    const actualStats = await viewer.locator(".players-panel").innerText();
    await host.locator(".history-round button", {hasText: "Регистр 1"}).click();
    await Promise.all([host, guest, viewer].map((page) => page.locator(".history-round button.active", {hasText: "Регистр 1"}).waitFor()));
    assert.equal(await viewer.locator(".pause-banner span").innerText(), "Просмотр журнала");
    assert.equal(await viewer.locator(".rr-player-registers").count(), 2, "historical public programs are not shown");
    assert.equal(await viewer.locator(".rr-player-registers").first().locator(".public-register.revealed").count(), 1,
        "history reveals cards beyond the selected register");

    await host.locator(".history-reset").click();
    await viewer.locator(".history-review-panel.actual").waitFor();
    assert.deepStrictEqual(await viewer.locator(".board-overlay .robot").evaluateAll((robots) => robots.map((robot) => ({
        userId: robot.dataset.userId, left: robot.style.left, top: robot.style.top, angle: robot.style.getPropertyValue("--robot-angle")
    }))), actualRobots, "reset did not restore the actual board");
    assert.equal(await viewer.locator(".players-panel").innerText(), actualStats, "reset did not restore actual player stats");

    await host.locator(".history-round button", {hasText: "Регистр 1"}).click();
    const laserReplay = viewer.locator(".laser-effects").waitFor({timeout: 20000});
    await host.locator(".history-play").click();
    await viewer.locator(".history-review-panel.playing").waitFor();
    assert.equal(await viewer.locator(".pause-banner span").innerText(), "Воспроизведение журнала");
    await laserReplay;
    await viewer.locator(".history-review-panel.playing").waitFor({state: "detached", timeout: 20000});
    assert(await viewer.locator(".history-review-panel.reviewing").isVisible(), "playback returned to the actual state automatically");

    await viewer.setViewportSize({width: 760, height: 900});
    if (!await viewer.getByRole("dialog", {name:"Игроки и регистры"}).isVisible())
        await viewer.locator(".rr-players-open").click();
    await viewer.locator(".history-review-panel").scrollIntoViewIfNeeded();
    const narrowBox = await viewer.locator(".history-review-panel").boundingBox();
    assert(narrowBox && narrowBox.x >= 0 && narrowBox.x + narrowBox.width <= 760, "history panel escapes a narrow viewport");
    await viewer.setViewportSize({width: 1280, height: 900});

    await host.locator(".game-pause-controls button", {hasText: "Продолжить"}).click();
    await Promise.all([host, guest, viewer].map((page) => page.locator(".history-review-panel").waitFor({state: "detached"})));
    assert.equal(await viewer.locator(".game-screen.is-history-review").count(), 0, "unpausing kept the historical display mode");
    assert.equal(await viewer.locator(".pause-banner").count(), 0, "pause banner remained after continuing the game");

    console.log("Shared turn history review and playback browser flow passed.");
})().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
}).finally(async () => {
    if (browser) await browser.close();
    stopSandbox(server);
});
