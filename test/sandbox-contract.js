"use strict";

const assert = require("assert");
const init = require("../module");

let GameState;
class RoomState {
    constructor(hostId, hostData, userRegistry) {
        this.userRegistry = userRegistry;
        this.registry = userRegistry;
        this.room = {roomId: hostData.roomId, createTime: Date.now(), authUsers: {}, playerAvatars: {}};
        this.eventHandlers = {
            "change-name": (userId, value) => {
                if (value && value.substr) {
                    this.room.playerNames[userId] = value.substr(0, 60);
                    this.updatePublicState();
                }
            }
        };
    }

    emit() {}
}

const registry = {
    RoomState,
    handleAppPage() {},
    createRoomManager(_path, Type) { GameState = Type; },
    send() {},
    log() {}
};
init({app: {use() {}}, users: registry, static() { return () => {}; }}, "/sandbox-contract-test");

const game = new GameState("host", {roomId: "contract"}, registry);
const longName = "A".repeat(80);
game.userJoin({userId: "host", userName: longName});
assert.equal(game.room.playerNames.host.length, 60, "join name does not follow the engine's 60-character limit");
assert(game.room.spectators.has("host"), "new visitor is not a spectator");

game.userEvent("host", "change-name", ["Механик"]);
assert.equal(game.room.playerNames.host, "Механик", "engine change-name event did not update the game name");
game.room.authUsers.host = {name: "Профиль", gameSettings: {syncName: true}};
assert.equal(game.playerName("host"), "Профиль", "profile-synchronized name is not used by game messages");

game.userJoin({userId: "player", userName: "Игрок"});
game.room.playerSlots[0] = "player";
game.room.spectators.delete("player");
game.userLeft("player");
assert.equal(game.room.playerNames.player, "Игрок", "disconnected seated player lost the reconnect name");

game.userLeft("host");
assert(!game.room.spectators.has("host"), "disconnected spectator remains in spectators");
assert(!Object.hasOwn(game.room.playerNames, "host"), "disconnected spectator still consumes a room slot");
assert.equal(game.getPlayerCount(), 1, "room count includes a disconnected spectator");

const snapshot = JSON.parse(JSON.stringify(game.getSnapshot()));
const restored = new GameState("restorer", {roomId: "contract"}, registry);
restored.setSnapshot(snapshot);
assert.equal(restored.room.playerNames.player, "Игрок", "snapshot lost a seated player's name");
assert.equal(restored.room.onlinePlayers.size, 0, "restored room contains stale online users");
assert(restored.room.spectators instanceof Set, "restored spectators are not a set");

console.log("Sandbox name and participant lifecycle contract passed.");
