"use strict";

const assert = require("assert");
const {launchBrowser, openUser, startSandbox, stopSandbox} = require("./browser-support");

const port = process.env.POWER_DOWN_PORT || "3042";
const {server, ready} = startSandbox(port);
let browser;

async function renderProgram(page, overrides = {}) {
    await page.evaluate((input) => {
        const cards = Array.from({length: 5}, (_, index) => ({id: `card-${index}`, priority: 100 + index,
            type: "right", label: "Поворот вправо"}));
        const state = {phase: "programming", playerSlots: ["one"], userId: "one", round: 3, ...input.state};
        const privateState = {hand: cards, selected: cards.map(({id}) => id), registerCards: cards,
            lockedRegisters: [], locked: false, damage: 4, poweredDown: false, powerDownIntent: false,
            canPowerDown: true, ...input.privateState};
        window.__powerDownEvents = [];
        const app = {socket: {emit(event, value) { window.__powerDownEvents.push({event, value}); }}};
        ReactDOM.render(React.createElement(Program, {state, privateState, app}), document.getElementById("root"));
    }, overrides);
}

(async () => {
    await ready;
    browser = await launchBrowser();
    const {page} = await openUser(browser, {port, room: "power-down-browser", name: "One", viewport: {width: 1000, height: 700}});

    await renderProgram(page);
    const token = page.locator(".power-down-token");
    assert(await token.isEnabled(), "damaged robot cannot select Перезагрузка");
    assert(await token.evaluate((element) => element.classList.contains("urgent")), "four-damage warning is missing");
    await token.click();
    assert.deepStrictEqual(await page.evaluate(() => window.__powerDownEvents),
        [{event: "set-power-down-intent", value: {enabled: true}}], "intent event is not explicit");

    await renderProgram(page, {privateState: {powerDownIntent: true}});
    assert(await token.evaluate((element) => element.classList.contains("selected")), "selected token is not marked");
    assert(!await token.evaluate((element) => element.classList.contains("confirmed")), "unconfirmed token looks confirmed");
    assert(await page.locator(".card").first().isEnabled(), "intent unexpectedly blocks program editing");

    await renderProgram(page, {privateState: {powerDownIntent: true, locked: true}});
    assert(await token.isDisabled(), "confirmed token remains editable");
    assert(await token.evaluate((element) => element.classList.contains("confirmed")), "confirmed token has no distinct state");
    assert.equal(await page.locator(".power-down-action > small").innerText(), "Объявлено");

    await renderProgram(page, {privateState: {damage: 0, canPowerDown: false}});
    assert(await token.isDisabled(), "undamaged robot can select Перезагрузка");
    assert(await token.evaluate((element) => element.classList.contains("unavailable")), "unavailable token has no distinct state");
    assert.equal(await page.locator(".power-down-action > small").innerText(), "Нужен урон");

    await page.evaluate(() => {
        window.__powerDownEvents = [];
        const state = {phase: "power-down-choice", powerDownChoice: {answered: 1, total: 2}};
        const privateState = {powerDownChoice: {eligible: true, answered: false, choice: null}};
        const app = {socket: {emit(event, value) { window.__powerDownEvents.push({event, value}); }}};
        ReactDOM.render(React.createElement(PowerDownChoicePanel, {state, privateState, app}), document.getElementById("root"));
    });
    assert.equal(await page.getByText("Ответили: 1 из 2.", {exact: false}).count(), 1, "anonymous choice progress is missing");
    await page.locator(".power-down-choice-actions .power-down-token").click();
    assert.deepStrictEqual(await page.evaluate(() => window.__powerDownEvents),
        [{event: "choose-power-down-continuation", value: {enabled: true}}], "continuation event is not explicit");

    await page.evaluate(() => {
        const state = {phase: "power-down-choice", powerDownChoice: {answered: 1, total: 2}};
        const privateState = {powerDownChoice: {eligible: true, answered: true, choice: true}};
        ReactDOM.render(React.createElement(PowerDownChoicePanel, {state, privateState, app: {socket: {emit() {}}}}),
            document.getElementById("root"));
    });
    const fixedChoice = page.locator(".power-down-choice-actions .power-down-token");
    assert(await fixedChoice.isDisabled(), "fixed continuation choice remains editable");
    assert(await fixedChoice.evaluate((element) => element.classList.contains("confirmed")), "fixed continuation has no confirmation state");
    assert.equal(await page.getByText("Ваш выбор принят", {exact: true}).count(), 1);

    const postChoiceDock = await page.evaluate(() => bottomDockProgrammingState({
        phase: "programming", round: 4, userId: "one", playerSlots: ["one"]
    }, true));
    assert.equal(postChoiceDock.label, "ПРОГРАММИРОВАНИЕ · РАУНД 4",
        "programming is not visibly announced after the Перезагрузка choice phase");

    await page.evaluate(() => {
        const lockedCard = {id: "locked", priority: 420, type: "right", label: "Поворот вправо"};
        const state = {phase: "programming", userId: "viewer", playerSlots: ["one"], playerNames: {one: "One"},
            playerStats: {one: {poweredDown: true}}, programs: {one: {poweredDown: true, lockedRegisters: [4],
                cards: [null, null, null, null, lockedCard]}}};
        ReactDOM.render(React.createElement(PlayerRegisters, {state, userId:"one"}), document.getElementById("root"));
    });
    assert.equal(await page.locator(".rr-player-registers .public-register").count(), 5,
        "the five public slots disappear outside register resolution");
    assert.equal(await page.locator(".public-register.random-locked", {hasText: "420"}).count(), 1,
        "public locked card is not visibly identified");

    console.log("Перезагрузка browser states and explicit events passed");
})().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
}).finally(async () => {
    if (browser) await browser.close();
    stopSandbox(server);
});
