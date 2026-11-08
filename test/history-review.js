"use strict";

const assert = require("assert");
const init = require("../module");

let GameState;
class RoomState { constructor() { this.room = {}; } }
const registry = {
    RoomState, games: {roborace: {id: "test"}}, handleAppPage() {},
    createRoomManager(_path, Type) { GameState = Type; }
};
init({app: {use() {}}, users: registry, static() { return () => {}; }}, "/history-review-test");

const makeCards = (prefix) => Array.from({length: 5}, (_, index) => ({
    id: `${prefix}-${index}`, type: "move1", label: `Вперёд ${index + 1}`, priority: 500 + index
}));

function makePlayer(prefix) {
    const cards = makeCards(prefix);
    return {hand: cards, selected: cards.map(({id}) => id), registers: [], lockedRegisters: [], autoFilledRegisters: [],
        locked: true, damage: 0, lives: 3, checkpoints: 0, poweredDown: false, powerDownIntent: false,
        powerDownNextRound: false};
}

function recordRegisters(game, round, count, finish = false) {
    game.room.phase = "resolving";
    game.room.round = round;
    for (let register = 1; register <= count; register++) {
        game.room.register = register;
        game.room.revealedRegisters = register;
        game.room.stage = `Регистр ${register}: карты открыты`;
        game.beginHistoryRegister(register);
        game.recordHistoryFrame(1);
        game.room.robots[0].x = round + register;
        game.players.host.damage = register;
        game.room.stage = `Регистр ${register}: движение`;
        game.recordHistoryFrame(1);
        game.completeHistoryRegister();
    }
    if (finish) game.finishHistoryRound();
}

(async () => {
    const game = new GameState("host", {}, {send() {}});
    game.userRegistry = {send() {}};
    game.room.hostId = "host";
    game.room.playerSlots = ["host", "guest"];
    game.room.playerNames = {host: "Host", guest: "Guest"};
    game.players = {host: makePlayer("host"), guest: makePlayer("guest")};
    game.room.robots = [
        {userId: "host", x: 0, y: 0, direction: "north", headingTurns: 0, color: "#f04444", archive: {x: 0, y: 0}},
        {userId: "guest", x: 1, y: 0, direction: "north", headingTurns: 0, color: "#2d82ff", archive: {x: 1, y: 0}}
    ];

    recordRegisters(game, 1, 5, true);
    recordRegisters(game, 2, 5, true);
    recordRegisters(game, 3, 2, false);
    assert.equal(game.historyEntries().length, 12, "history does not retain two completed rounds plus current registers");

    game.room.register = 3;
    game.room.revealedRegisters = 3;
    game.beginHistoryRegister(3);
    game.recordHistoryFrame(1);
    assert.equal(game.historyEntries().length, 12, "unfinished register leaked into the public history list");

    const roundOneOpening = game.historyRegister(1, 1);
    const openingState = game.reconstructHistoryFrame(roundOneOpening, 0);
    assert(openingState.programs.host.cards[0], "opened register is absent from history");
    assert.equal(openingState.programs.host.cards[1], null, "future program card leaked through history");

    game.room.robots[0].x = 99;
    game.players.host.damage = 8;
    game.players.host.lives = 1;
    game.players.host.checkpoints = 3;
    game.room.phase = "programming";
    game.room.paused = true;
    game.userEvent("guest", "select-history-register", [{round: 1, register: 1}]);
    assert.equal(game.room.historyReview.selected, null, "non-host selected a history frame");
    game.userEvent("host", "select-history-register", [{round: 1, register: 1}]);
    assert.deepStrictEqual(game.room.historyReview.selected, {round: 1, register: 1});
    assert.notEqual(game.publicState().robots[0].x, 99, "selected history did not replace the public board");
    assert.equal(game.room.robots[0].x, 99, "history selection mutated the canonical robot");
    assert.deepStrictEqual(game.publicState().playerStats.host,
        {damage: 0, lives: 3, checkpoints: 0, ready: true, poweredDown: false, powerDownNextRound: false, finished: false},
        "selected history did not restore the public player counters");
    assert.deepStrictEqual(game.publicState().historyReview.playerStats.host,
        game.publicState().playerStats.host, "history review exposed live rather than historical player counters");

    game.userEvent("host", "reset-history-review", []);
    assert.equal(game.publicState().robots[0].x, 99, "reset did not restore the canonical board");
    assert.equal(game.publicState().playerStats.host.damage, 8, "reset did not restore actual damage");
    assert.equal(game.publicState().playerStats.host.lives, 1, "reset did not restore actual lives");
    assert.equal(game.publicState().playerStats.host.checkpoints, 3, "reset did not restore actual checkpoints");
    assert.equal(game.publicState().historyReview.actual, true);

    game.selectHistoryRegister(2, 5);
    assert(game.startHistoryPlayback(), "history playback did not start");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(game.room.historyReview.playing, false,
        `history playback did not stop on its final frame: ${JSON.stringify(game.room.historyReview)}`);
    assert.deepStrictEqual(game.room.historyReview.selected, {round: 3, register: 2}, "playback did not advance to the latest completed register");
    assert(game.historyViewFrame, "playback unexpectedly returned to the actual state");

    const snapshot = JSON.parse(JSON.stringify(game.getSnapshot()));
    const restored = new GameState("restorer", {}, {send() {}});
    restored.userRegistry = {send() {}};
    restored.setSnapshot(snapshot);
    assert.equal(restored.historyEntries().length, 12, "room snapshot lost register history");
    assert(restored.historyViewFrame, "room snapshot lost the selected historical frame");
    assert.equal(restored.room.historyReview.playing, false, "playback resumed automatically after restore");

    game.setPaused(false);
    assert.equal(game.historyViewFrame, null, "unpausing did not restore the actual state");
    assert.equal(game.room.historyReview.selected, null, "unpausing kept a historical selection");

    // Completing round 3 turns it into one of the two completed rounds and drops round 1.
    game.room.paused = false;
    recordRegisters(game, 3, 5, true);
    assert.deepStrictEqual([...new Set(game.historyEntries().map(({round}) => round))], [2, 3],
        "completed history was not pruned to the last two rounds");

    console.log("Turn history recording, review, playback and persistence checks passed.");
})().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
