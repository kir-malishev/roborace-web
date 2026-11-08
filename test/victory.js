"use strict";

const assert = require("assert");
const init = require("../module");

let GameState;
class RoomState { constructor() { this.room = {}; } }
init({app: {use() {}}, users: {
    RoomState, games: {roborace: {id: "test"}}, handleAppPage() {},
    createRoomManager(_path, Type) { GameState = Type; }
}, static() { return () => {}; }}, "/victory-test");

function gameWithRobots(lives) {
    const game = new GameState("a", {}, {send() {}});
    game.userRegistry = {send() {}};
    game.room.phase = "resolving";
    game.room.playerSlots = Object.keys(lives);
    game.room.playerNames = Object.fromEntries(Object.keys(lives).map((id) => [id, id.toUpperCase()]));
    game.room.log = [];
    game.players = Object.fromEntries(Object.entries(lives).map(([id, count]) => [id, {
        lives: count, damage: 0, poweredDown: false, powerDownIntent: false, powerDownNextRound: false
    }]));
    game.room.robots = Object.keys(lives).map((id, index) => ({
        userId: id, x: index, y: 1, direction: "north", color: "#fff",
        eliminated: lives[id] <= 0, destroyed: false, archive: {x: index, y: 1}
    }));
    return game;
}

// Losing a life is not enough: every opponent must lose the final life.
{
    const game = gameWithRobots({a: 3, b: 2});
    game.reboot(game.getRobot("b"), "яма");
    assert.equal(game.room.phase, "resolving");
    assert.equal(game.room.winnerId, null);
}

// The sole player with lives remaining wins immediately.
{
    const game = gameWithRobots({a: 3, b: 1, c: 0});
    game.reboot(game.getRobot("b"), "яма");
    assert.equal(game.room.phase, "finished");
    assert.equal(game.room.winnerId, "a");
    assert.equal(game.room.winnerReason, "last-robot-standing");
}

// Laser damage is simultaneous. If every remaining robot loses its last life,
// the first processed hit must not create a false winner.
{
    const game = gameWithRobots({a: 1, b: 1});
    game.players.a.damage = 9;
    game.players.b.damage = 9;
    game.applyLaserHits([{userId: "a", amount: 1}, {userId: "b", amount: 1}]);
    assert.equal(game.room.winnerId, null);
    assert.notEqual(game.room.phase, "finished");
}

// A robot may be destroyed in the same simultaneous phase yet still win when
// it retains another life and every opponent is permanently eliminated.
{
    const game = gameWithRobots({a: 2, b: 1, c: 1});
    game.players.a.damage = 9;
    game.players.b.damage = 9;
    game.players.c.damage = 9;
    game.applyLaserHits([{userId: "a", amount: 1}, {userId: "b", amount: 1}, {userId: "c", amount: 1}]);
    assert.equal(game.room.winnerId, "a");
    assert.equal(game.room.winnerReason, "last-robot-standing");
}

console.log("Last-robot-standing victory checks passed.");
