"use strict";

const assert = require("assert");
const init = require("../module");

let GameState;
class RoomState { constructor() { this.room = {}; } }
init({app: {use() {}}, users: {
    RoomState, games: {roborace: {id: "test"}}, handleAppPage() {},
    createRoomManager(_path, Type) { GameState = Type; }
}, static() { return () => {}; }}, "/pause-test");

const makePlayer = (id, locked = false) => ({
    hand: [{id: `${id}-card`, type: "move1", label: "Вперёд 1", priority: 500}],
    selected: Array(5).fill(null), registers: [], lockedRegisters: [], autoFilledRegisters: [], locked,
    damage: 0, lives: 3, checkpoints: 0, poweredDown: false, powerDownIntent: false, powerDownNextRound: false
});

(async () => {
    const game = new GameState("host", {}, {send() {}});
    game.userRegistry = {send() {}};
    game.room.phase = "programming";
    game.room.playerSlots = ["host", "guest"];
    game.room.playerNames = {host: "Host", guest: "Guest"};
    game.players = {host: makePlayer("host", true), guest: makePlayer("guest")};
    assert(game.maybeStartProgrammingTimer());

    game.userEvent("guest", "set-paused", [{paused: true}]);
    assert.equal(game.room.paused, false, "a non-host paused the game");

    game.userEvent("host", "set-paused", [{paused: true}]);
    assert.equal(game.room.paused, true);
    assert.equal(game.room.programmingTimer.paused, true);
    const frozen = game.room.programmingTimer.remaining;
    game.userEvent("guest", "toggle-card", ["guest-card"]);
    assert.equal(game.players.guest.selected.filter(Boolean).length, 0, "program changed while paused");

    let resumed = false;
    const pauseGate = game.waitWhilePaused().then(() => { resumed = true; });
    await Promise.resolve();
    assert.equal(resumed, false, "resolution pause gate opened early");
    game.userEvent("host", "set-paused", [{paused: false}]);
    await pauseGate;
    assert.equal(game.room.paused, false);
    assert.equal(game.room.programmingTimer.paused, false);
    assert.equal(game.room.programmingTimer.remaining, frozen);
    assert.equal(resumed, true);
    game.cancelProgrammingTimer();

    const roles = new GameState("host", {}, {send() {}});
    roles.userRegistry = {send() {}};
    for (const id of ["host", "guest", "viewer", "fourth"])
        roles.userJoin({userId: id, userName: id});
    roles.userEvent("host", "join-game", []);
    roles.userEvent("guest", "join-game", []);
    roles.userEvent("host", "start-game", []);
    assert.equal(roles.room.phase, "programming");
    roles.userEvent("viewer", "join-game", []);
    assert(!roles.room.playerSlots.includes("viewer"), "spectator joined without a pause");
    roles.userEvent("guest", "spectators-join", []);
    assert(roles.room.playerSlots.includes("guest"), "player left without a pause");

    roles.userEvent("host", "set-paused", [{paused: true}]);
    roles.userEvent("viewer", "join-game", []);
    assert.equal(roles.room.startAssignments.viewer, 2, "third player did not receive start 3");
    assert.equal(roles.getRobot("viewer").slot, 2);
    assert.equal(roles.players.viewer.hand.length, 9, "new player was not dealt a normal hand");
    assert(!roles.room.spectators.has("viewer"));
    roles.userEvent("guest", "spectators-join", []);
    assert(roles.room.spectators.has("guest"));
    assert(!roles.getRobot("guest"), "departing player's robot remained on the board");
    assert.deepEqual(roles.privateState("guest").hand, [], "departing player retained private cards");
    roles.userEvent("fourth", "join-game", []);
    assert.equal(new Set(roles.room.robots.map((robot) => `${robot.x},${robot.y}`)).size,
        roles.room.robots.length, "joining after a gap stacked robots on one start");
    roles.userEvent("host", "set-paused", [{paused: false}]);
    roles.userEvent("fourth", "spectators-join", []);
    assert(roles.room.playerSlots.includes("fourth"), "player left after the pause ended");
    roles.userEvent("host", "remove-player", ["fourth"]);
    assert(roles.room.spectators.has("fourth"), "host removal did not move the player to spectators");
    assert(roles.room.raceExcludedPlayers.has("fourth"), "host removal did not exclude the player from the race");
    roles.userEvent("host", "set-paused", [{paused: true}]);
    roles.userEvent("fourth", "join-game", []);
    assert(!roles.room.playerSlots.includes("fourth"), "host-removed player rejoined the same race");
    const restored = new GameState("host", {}, {send() {}});
    restored.userRegistry = {send() {}};
    restored.setSnapshot(roles.getSnapshot());
    assert(restored.room.raceExcludedPlayers.has("fourth"), "race exclusion was lost from the room snapshot");
    roles.userEvent("host", "restart-game", []);
    assert(!roles.room.raceExcludedPlayers.has("fourth"), "race exclusion survived a return to the lobby");
    roles.userEvent("fourth", "join-game", []);
    assert(roles.room.playerSlots.includes("fourth"), "removed player cannot join a new race");
    let kicked = null;
    roles.emit = (event, id) => { if (event === "user-kicked") kicked = id; };
    roles.userEvent("host", "remove-player", ["guest"]);
    assert.equal(kicked, "guest", "host could not kick a spectator");
    roles.cancelProgrammingTimer();

    const lobbyRoles = new GameState("host", {}, {send() {}});
    lobbyRoles.userRegistry = {send() {}};
    lobbyRoles.userJoin({userId: "host", userName: "Host"});
    lobbyRoles.userJoin({userId: "guest", userName: "Guest"});
    lobbyRoles.userEvent("host", "join-game", []);
    lobbyRoles.userEvent("guest", "join-game", []);
    lobbyRoles.userEvent("host", "remove-player", ["guest"]);
    assert(!lobbyRoles.room.raceExcludedPlayers.has("guest"), "lobby removal created a race exclusion");
    lobbyRoles.userEvent("guest", "join-game", []);
    assert(lobbyRoles.room.playerSlots.includes("guest"), "lobby player cannot join again, unlike Alias");
    console.log("Host pause and timer freeze checks passed.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
