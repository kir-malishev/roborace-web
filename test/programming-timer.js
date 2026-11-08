"use strict";

const assert = require("assert");
const init = require("../module");

let GameState;
class RoomState { constructor() { this.room = {}; } }
const registry = {RoomState, games: {roborace: {id: "test"}}, handleAppPage() {},
    createRoomManager(_path, Type) { GameState = Type; }};
init({app: {use() {}}, users: registry, static() { return () => {}; }}, "/programming-timer-test");

const card = (id, priority) => ({id, priority, type: "move1", label: `Card ${id}`});
const player = (prefix) => ({
    hand: Array.from({length: 9}, (_, index) => card(`${prefix}-${index}`, 100 + index)),
    selected: Array(5).fill(null), registers: [], lockedRegisters: [], autoFilledRegisters: [], locked: false,
    damage: 0, lives: 3, checkpoints: 0, poweredDown: false, powerDownIntent: false,
    powerDownNextRound: false, powerDownDamage: 0
});

function makeGame() {
    const game = new GameState("one", {}, {send() {}});
    game.userRegistry = {send() {}};
    game.room.phase = "programming";
    game.room.playerSlots = ["one", "two"];
    game.room.playerNames = {one: "One", two: "Two"};
    game.room.log = [];
    game.players = {one: player("one"), two: player("two")};
    game.players.one.selected = game.players.one.hand.slice(0, 5).map(({id}) => id);
    game.players.two.selected[0] = game.players.two.hand[0].id;
    game.players.two.selected[1] = game.players.two.hand[1].id;
    return game;
}

// The countdown starts only after every player except one has pressed Ready.
{
    const game = makeGame();
    game.userEvent("one", "lock-program", []);
    assert(game.room.programmingTimer, "last-player countdown did not start");
    assert.equal(game.room.programmingTimer.userId, "two");
    assert.equal(game.room.programmingTimer.remaining, 30);
    assert(game.room.log.some((line) => line.includes("30 секунд")), "timer start was not announced");

    const generation = game.programmingTimerGeneration;
    const firstTwo = game.players.two.selected.slice(0, 2);
    assert(game.expireProgrammingTimer("two", generation), "timer could not expire");
    assert.equal(game.room.programmingTimer, null);
    assert.equal(game.players.two.locked, true);
    assert(game.players.two.selected.every(Boolean), "empty registers were not filled");
    assert.deepStrictEqual(game.players.two.selected.slice(0, 2), firstTwo, "chosen cards were replaced");
    assert.deepStrictEqual(game.players.two.autoFilledRegisters, [2, 3, 4]);
    assert.equal(new Set(game.players.two.selected).size, 5, "one card was used more than once");
    assert.deepStrictEqual(game.room.programmingAutoFill, {userId: "two", userIds: ["two"], registers: [2, 3, 4],
        fills: [{userId: "two", registers: [2, 3, 4]}], count: 3});
    assert(game.room.log.some((line) => line.includes("пустые регистры заполнены случайными картами с руки")),
        "timeout auto-fill was not written to the log");

    const fixedProgram = [...game.players.two.selected];
    game.userEvent("two", "clear-register", [2]);
    assert.deepStrictEqual(game.players.two.selected, fixedProgram, "timed-out player could still edit the program");
    game.cancelAutoFillResolution();
}

// A completed but unconfirmed program is locked without replacing its cards.
{
    const game = makeGame();
    game.players.one.locked = true;
    game.players.two.selected = game.players.two.hand.slice(0, 5).map(({id}) => id);
    const program = [...game.players.two.selected];
    assert(game.maybeStartProgrammingTimer());
    assert(game.expireProgrammingTimer("two", game.programmingTimerGeneration));
    assert.deepStrictEqual(game.players.two.selected, program);
    assert.deepStrictEqual(game.players.two.autoFilledRegisters, []);
    assert(game.room.log.some((line) => line.includes("готовая программа автоматически зафиксирована")));
    game.cancelAutoFillResolution();
}

// Pressing Ready before the deadline cancels the timer and resolves normally.
{
    const game = makeGame();
    game.userEvent("one", "lock-program", []);
    game.players.two.selected = game.players.two.hand.slice(0, 5).map(({id}) => id);
    let resolved = false;
    game.resolveRound = async () => { resolved = true; };
    game.userEvent("two", "lock-program", []);
    assert.equal(game.room.programmingTimer, null);
    assert.equal(game.players.two.locked, true);
    assert.equal(game.room.programmingAutoFill, null);
    assert.deepStrictEqual(game.players.two.autoFilledRegisters, []);
    assert.equal(resolved, true);
}

console.log("Programming timer regression checks passed.");
