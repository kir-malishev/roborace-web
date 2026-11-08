"use strict";

const assert = require("assert");
const init = require("../module");

let GameState;
class RoomState { constructor() { this.room = {}; } }
const registry = {RoomState, games: {roborace: {id: "test"}}, handleAppPage() {},
    createRoomManager(_path, Type) { GameState = Type; }};
init({app: {use() {}}, users: registry, static() { return () => {}; }}, "/game-options-test");

const card = (id) => ({id, priority: 100, type: "move1", label: id});
function makeGame(ids = ["host", "other"]) {
    const game = new GameState("host", {}, {send() {}});
    game.userRegistry = {send() {}};
    game.room.phase = "programming";
    game.room.round = 1;
    game.room.playerSlots = ids;
    game.room.playerNames = Object.fromEntries(ids.map((id) => [id, id]));
    game.room.robots = ids.map((userId, slot) => ({userId, slot, x: slot, y: 12, direction: "north",
        archive: {x: slot, y: 12}, eliminated: false, destroyed: false}));
    game.players = Object.fromEntries(ids.map((id) => [id, {hand: Array.from({length: 9}, (_, index) => card(`${id}-${index}`)),
        selected: Array(5).fill(null), registers: [], lockedRegisters: [], locked: false, autoFilledRegisters: [],
        damage: 0, lives: 3, checkpoints: 0, checkpointAvailable: 1, poweredDown: false,
        powerDownIntent: false, powerDownNextRound: false, powerDownDamage: 0, finished: false}]));
    game.room.log = [];
    return game;
}

// Host-only, explicit settings; lowering the cap is immediate but raising it never heals.
{
    const game = makeGame();
    game.userEvent("other", "set-game-option", [{key: "startingLives", setting: 1}]);
    assert.equal(game.room.gameOptions.startingLives, 3);
    game.players.other.lives = 2;
    game.userEvent("host", "set-game-option", [{key: "startingLives", setting: 1}]);
    assert.equal(game.players.host.lives, 1);
    assert.equal(game.players.other.lives, 1);
    game.userEvent("host", "set-game-option", [{key: "startingLives", setting: 5}]);
    assert.equal(game.players.other.lives, 1);
    game.userEvent("host", "set-player-lives", [{userId: "other", lives: 7}]);
    assert.equal(game.players.other.lives, 7, "manual lives must be allowed above the cap");
    game.userEvent("host", "set-player-lives", [{userId: "host", lives: 4}]);
    assert.equal(game.players.host.lives, 4, "host must be able to edit own lives");
    game.userEvent("host", "set-player-lives", [{userId: "host", lives: 0}]);
    assert.equal(game.players.host.lives, 4, "host must not manually set zero lives");
    game.userEvent("host", "set-game-option", [{key: "startingLives", setting: null}]);
    assert.equal(game.players.other.lives, null, "unlimited lives must apply to everyone immediately");
    game.userEvent("host", "set-player-lives", [{userId: "other", lives: 2}]);
    assert.equal(game.players.other.lives, null);
    game.userEvent("host", "set-game-option", [{key: "startingLives", setting: 3}]);
    assert.equal(game.players.other.lives, 3);
}

// Revived players return through the normal reentry phase, not in the current register.
{
    const game = makeGame(["host", "other", "third"]);
    const robot = game.getRobot("other");
    robot.eliminated = true;
    robot.x = null;
    robot.y = null;
    game.players.other.lives = 0;
    game.players.other.locked = true;
    game.userEvent("host", "set-player-lives", [{userId: "other", lives: 2}]);
    assert.equal(robot.eliminated, false);
    assert.equal(robot.destroyed, true);
    assert.equal(game.players.other.locked, true);
    assert.equal(game.prepareReentry(), true);
    assert.equal(game.room.reentryUserId, "other");
}

// Unlimited lives affect everyone at once and queue eliminated robots for reentry.
{
    const game = makeGame(["host", "other", "third"]);
    const robot = game.getRobot("other");
    robot.eliminated = true;
    robot.x = null;
    robot.y = null;
    game.players.other.lives = 0;
    game.userEvent("host", "set-game-option", [{key: "startingLives", setting: null}]);
    assert(Object.values(game.players).every((player) => player.lives === null));
    assert.equal(robot.eliminated, false);
    assert.equal(robot.destroyed, true);
    assert.equal(game.prepareReentry(), true);
    game.room.phase = "finished";
    game.userEvent("host", "set-game-option", [{key: "startingLives", setting: 3}]);
    assert.equal(game.room.phase, "finished", "changing lives reopened a finished game");
}

// No last-player timer: Ready can be explicitly released and cards changed.
{
    const game = makeGame();
    game.userEvent("host", "set-game-option", [{key: "lastPlayerSeconds", setting: null}]);
    game.players.host.selected = game.players.host.hand.slice(0, 5).map((item) => item.id);
    game.userEvent("host", "lock-program", []);
    assert.equal(game.players.host.locked, true);
    assert.equal(game.room.programmingTimer, null);
    game.userEvent("host", "unlock-program", []);
    assert.equal(game.players.host.locked, false);
    game.userEvent("host", "clear-register", [0]);
    assert.equal(game.players.host.selected[0], null);
}

// Simple Перезагрузка replaces the current program, keeps existing cards while unconfirmed,
// then becomes active without exposing the choice before everyone is ready.
{
    const game = makeGame();
    game.room.activePowerDownMode = "simple";
    game.players.host.damage = 2;
    game.players.host.selected[0] = game.players.host.hand[0].id;
    game.userEvent("host", "set-power-down-intent", [{enabled: true}]);
    game.userEvent("host", "assign-register", [{register: 1, cardId: game.players.host.hand[1].id}]);
    assert.equal(game.players.host.selected[1], null);
    assert.equal(game.players.host.selected[0], game.players.host.hand[0].id);
    game.userEvent("host", "lock-program", []);
    assert.equal(game.players.host.locked, true);
    assert.equal(game.players.host.poweredDown, false);
    assert.equal(game.publicPlayerStats().host.powerDownNextRound, false);
    game.confirmPowerDownIntents(["host"]);
    assert.equal(game.players.host.poweredDown, true);
    assert.equal(game.players.host.damage, 0);
    assert.equal(game.players.host.selected.every((item) => item === null), true);
}

// A finisher stops participating; others continue until all remaining robots finish.
{
    const game = makeGame();
    game.userEvent("host", "set-game-option", [{key: "finishAllFlags", setting: true}]);
    game.room.flags = [{x: 0, y: 12, number: 1}];
    game.getRobot("other").x = 2;
    game.touchCheckpoints();
    assert.equal(game.players.host.finished, true);
    assert.equal(game.getRobot("host").withdrawn, true);
    assert.equal(game.room.phase, "programming");
    assert.equal(game.room.finishOrder[0], "host");
    game.getRobot("other").x = 0;
    game.touchCheckpoints();
    assert.equal(game.room.phase, "finished");
    assert.equal(game.room.winnerId, "host");
}

// Turning the flag race off after a finisher while paused must not strand the resolution loop.
{
    const game = makeGame();
    game.room.gameOptions.finishAllFlags = true;
    game.room.finishOrder = ["host"];
    game.room.paused = true;
    game.userEvent("host", "set-game-option", [{key: "finishAllFlags", setting: false}]);
    assert.equal(game.room.phase, "finished");
    assert.equal(game.room.paused, false);
    assert.equal(game.room.winnerId, "host");
}

console.log("Configurable lives, timer, Перезагрузка and finish race passed.");
