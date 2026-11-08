"use strict";

const assert = require("assert");
const {launchBrowser, openUser, startSandbox, stopSandbox} = require("./browser-support");

const port = process.env.PROGRAMMING_TIMER_PORT || "3044";
const {server, ready} = startSandbox(port);
let browser;

(async () => {
    await ready;
    browser = await launchBrowser();
    const {page} = await openUser(browser, {port, room: "timer-browser", name: "One", viewport: {width: 1100, height: 800}});

    await page.evaluate(() => ReactDOM.render(React.createElement(ProgrammingTimer, {state: {
        phase: "programming", playerNames: {two: "Игрок 2"}, programmingTimer: {userId: "two", remaining: 30}
    }}), document.getElementById("root")));
    assert.equal(await page.locator(".timer-clock strong").innerText(), "30");
    assert(!await page.locator(".programming-timer").evaluate((element) => element.classList.contains("warning")));

    await page.evaluate(() => ReactDOM.render(React.createElement(ProgrammingTimer, {state: {
        phase: "programming", playerNames: {two: "Игрок 2"}, programmingTimer: {userId: "two", remaining: 10}
    }}), document.getElementById("root")));
    assert(await page.locator(".programming-timer").evaluate((element) => element.classList.contains("warning")),
        "last ten seconds have no warning state");

    await page.evaluate(() => {
        const cards = Array.from({length: 5}, (_, index) => ({id: `card-${index}`, priority: 100 + index,
            type: "move1", label: `Card ${index + 1}`}));
        const state = {phase: "programming", round: 2, userId: "two", playerSlots: ["one", "two"]};
        const privateState = {hand: cards, selected: cards.map(({id}) => id), registerCards: cards,
            lockedRegisters: [], autoFilledRegisters: [2, 3, 4], locked: true, damage: 0,
            poweredDown: false, powerDownIntent: false, canPowerDown: false};
        const automatic = {phase: "programming", playerNames: {two: "Игрок 2"},
            programmingAutoFill: {userId: "two", registers: [2, 3, 4], count: 3}};
        ReactDOM.render(React.createElement("div", null,
            React.createElement(ProgrammingTimer, {state: automatic}),
            React.createElement(Program, {state, privateState, app: {socket: {emit() { throw new Error("locked program emitted an event"); }}}})),
        document.getElementById("root"));
    });
    assert.equal(await page.locator(".register.auto-filled").count(), 3);
    assert.equal(await page.locator(".card.auto-filled-source").count(), 3);
    assert.equal(await page.locator(".card:enabled").count(), 0, "auto-filled cards remain editable");
    assert(await page.getByRole("status").isVisible(),"auto-fill explanation is missing");

    await page.evaluate(() => ReactDOM.render(React.createElement(PlayerPanel, {state: {
        phase: "programming", userId: "one", playerSlots: ["one", "two", "three"],
        playerNames: {one: "Готов", two: "Спит", three: "Выбирает"}, flags: [],
        robots: [{userId: "one", color: "#4d8cff"}, {userId: "two", color: "#47c879"}, {userId: "three", color: "#e05252"}],
        playerStats: {one: {ready: true}, two: {ready: true, poweredDown: true}, three: {ready: false}}
    }}), document.getElementById("root")));
    assert.equal(await page.locator(".player-name-status.ready", {hasText: "Готов"}).count(), 1,
        "ready player is not marked in the player panel");
    assert.equal(await page.locator(".player-name-status.powered-down", {hasText: "Спит"}).count(), 1,
        "powered-down player is not marked with a separate color");
    assert.equal(await page.locator(".player-name-status:not(.ready):not(.powered-down):not(.power-down-next)", {hasText: "Выбирает"}).count(), 1,
        "programming player received a completed status");

    console.log("Programming timer browser states passed.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(async () => {
    if (browser) await browser.close();
    stopSandbox(server);
});
