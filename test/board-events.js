"use strict";

const assert = require("assert");
const init = require("../module");

let GameState;
class RoomState { constructor() { this.room = {}; } }
const registry = {
    RoomState,
    games: {roborace: {id: "test"}},
    handleAppPage() {},
    createRoomManager(_path, Type) { GameState = Type; }
};
init({app: {use() {}}, users: registry, static() { return () => {}; }}, "/board-events-test");

function makeGame() {
    const game = new GameState("one", {}, {send() {}});
    game.userRegistry = {send() {}};
    game.room.playerSlots = ["one"];
    game.room.playerNames = {one: "One"};
    game.room.robots = [{userId: "one", slot: 0, x: 1, y: 1, direction: "north",
        color: "#4389ff", archive: {x: 0, y: 12}, eliminated: false, destroyed: false}];
    game.players = {one: {hand: [], selected: Array(5).fill(null), registers: Array(5).fill(null),
        lockedRegisters: [], locked: false, damage: 0, lives: 3, checkpoints: 0,
        checkpointAvailable: 1, poweredDown: false, powerDownIntent: false,
        powerDownNextRound: false, powerDownDamage: 0}};
    game.room.flags = [];
    game.room.log = [];
    game.room.boardEvents = [];
    game.destructionCounter = 0;
    game.boardEventCounter = 0;
    const features = {conveyors: {}, express: new Set(), walls: new Set(), pits: new Set(),
        repairs: new Set(), gears: {}, pushers: [], lasers: [], conveyorTurns: {}};
    Object.defineProperty(game, "features", {value: features});
    return {game, features, robot: game.room.robots[0], player: game.players.one};
}

// A curved conveyor moves the robot to its destination, turns it with the belt,
// and publishes one event at the destination cell.
{
    const {game, features, robot} = makeGame();
    features.conveyors["1,1"] = "east";
    features.conveyors["2,1"] = "south";
    game.moveConveyors(false);
    assert.deepStrictEqual([robot.x, robot.y, robot.direction], [2, 1, "east"]);
    assert.equal(robot.headingTurns, 1, "conveyor turn did not preserve a continuous heading angle");
    assert.equal(game.room.boardEvents.length, 1);
    assert.deepStrictEqual({...game.room.boardEvents[0], id: 1, color: "#4389ff"}, {
        id: 1, type: "conveyor", userId: "one", color: "#4389ff",
        direction: "east", turn: 1, express: false, x: 2, y: 1
    });
}

// Express belts, pushers and gears expose the actual direction/turn that was applied.
{
    const {game, features, robot} = makeGame();
    features.conveyors["1,1"] = "south";
    features.conveyors["1,2"] = "south";
    features.express.add("1,1");
    game.moveConveyors(true);
    assert.equal(game.room.boardEvents[0].express, true);
    assert.equal(game.room.boardEvents[0].direction, "south");

    features.pushers = [{x: 1, y: 2, direction: "east", active: [3]}];
    game.room.register = 2;
    game.activatePushers();
    assert.equal(game.room.boardEvents.length, 0, "pusher fired outside its register");
    game.room.register = 3;
    game.activatePushers();
    assert.deepStrictEqual([robot.x, robot.y], [2, 2]);
    assert.equal(game.room.boardEvents[0].type, "pusher");
    assert.equal(game.room.boardEvents[0].direction, "east");

    features.gears["2,2"] = -1;
    game.activateGears();
    assert.equal(robot.direction, "west");
    assert.equal(robot.headingTurns, -1, "gear turn did not preserve its counter-clockwise direction");
    assert.equal(game.room.boardEvents[0].type, "gear");
    assert.equal(game.room.boardEvents[0].turn, -1);
}

// Flags create a checkpoint event, update the archive and repair exactly one damage.
{
    const {game, features, robot, player} = makeGame();
    robot.x = 4;
    robot.y = 5;
    game.room.flags = [{x: 4, y: 5, number: 1}];
    player.damage = 3;
    game.touchCheckpoints();
    assert.equal(player.checkpoints, 1);
    assert.deepStrictEqual(robot.archive, {x: 4, y: 5});
    assert.equal(game.room.boardEvents[0].type, "flag");
    assert.equal(game.room.boardEvents[0].flagNumber, 1);

    const repaired = game.cleanupRound();
    assert.equal(repaired, 1);
    assert.equal(player.damage, 2);
    assert.equal(game.room.boardEvents[0].type, "heal");
    assert.equal(game.room.boardEvents[0].amount, 1);

    // The same repair animation is emitted for a normal wrench space.
    game.room.flags = [];
    features.repairs.add("4,5");
    game.cleanupRound();
    assert.equal(player.damage, 1);
    assert.equal(game.room.boardEvents[0].type, "heal");
}

// Every flag repairs even when visited out of order and not captured.
{
    const {game, robot, player} = makeGame();
    game.room.flags = [{x: 2, y: 2, number: 1}, {x: 4, y: 5, number: 2}, {x: 6, y: 7, number: 3}];
    for (const flag of game.room.flags) {
        robot.x = flag.x;
        robot.y = flag.y;
        player.damage = 3;
        player.checkpointAvailable = 99;
        game.touchCheckpoints();
        assert.equal(player.checkpoints, 0, "out-of-order flag was captured");
        assert.deepStrictEqual(robot.archive, {x: flag.x, y: flag.y});
        assert.equal(game.cleanupRound(), 1, `flag ${flag.number} did not repair`);
        assert.equal(player.damage, 2, `flag ${flag.number} repaired more than once`);
    }
}

// A flag placed on a wrench tile is still one checkpoint and one repair site.
{
    const {game, features, robot, player} = makeGame();
    robot.x = 4;
    robot.y = 5;
    features.repairs.add("4,5");
    game.room.flags = [{x: 4, y: 5, number: 1}];
    player.damage = 3;
    game.touchCheckpoints();
    assert.equal(player.checkpoints, 1, "repair tile prevented flag capture");
    assert.deepStrictEqual(robot.archive, {x: 4, y: 5});
    assert.equal(game.cleanupRound(), 1, "overlapping flag and repair tile did not repair");
    assert.equal(player.damage, 2, "overlapping flag and repair tile repaired twice");
    assert.equal(game.room.boardEvents.filter((event) => event.type === "heal").length, 1);
}

// A pit preserves the death cell, so the effect is drawn on the pit rather than
// at a stale archive/start position.
{
    const {game, features, robot} = makeGame();
    features.pits.add("1,2");
    assert(game.move(robot, "south", "test"));
    assert.equal(robot.destroyed, true);
    assert.deepStrictEqual({x: robot.death.x, y: robot.death.y, reason: robot.death.reason},
        {x: 1, y: 2, reason: "яма"});
    assert.equal(robot.x, null);
    assert.equal(robot.y, null);
}

console.log("Board event regression checks passed.");
