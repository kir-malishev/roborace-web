"use strict";

const assert = require("assert");
const init = require("../module");

let GameState;
class RoomState { constructor() { this.room = {}; } }
const registry = {RoomState, games: {roborace: {id: "test"}}, handleAppPage() {},
    createRoomManager(_path, Type) { GameState = Type; }};
init({app: {use() {}}, users: registry, static() { return () => {}; }}, "/power-down-test");

const card = (id, priority = 100) => ({id, priority, type: "move", distance: 1, label: `Card ${id}`});
const freshPlayer = (extra = {}) => ({
    hand: [], selected: Array(5).fill(null), registers: [], lockedRegisters: [], locked: false,
    damage: 0, lives: 3, checkpoints: 0, poweredDown: false, powerDownIntent: false,
    powerDownNextRound: false, powerDownContinuation: null, powerDownDamage: 0,
    powerDownReentryChoiceRequired: false, ...extra
});

function makeGame(ids = ["one"]) {
    const messages = [];
    const game = new GameState("host", {}, {send(...args) { messages.push(args); }});
    game.userRegistry = {send(...args) { messages.push(args); }};
    game.room.playerSlots = [...ids];
    game.room.playerNames = Object.fromEntries(ids.map((id) => [id, id.toUpperCase()]));
    game.room.robots = ids.map((userId, slot) => ({userId, slot, x: slot, y: 12, direction: "north",
        color: "#fff", archive: {x: slot, y: 12}, eliminated: false, destroyed: false}));
    game.players = Object.fromEntries(ids.map((id) => [id, freshPlayer()]));
    game.deck = Array.from({length: 40}, (_, index) => card(`deck-${index}`, index + 1));
    game.discard = [];
    game.room.log = [];
    return {game, messages};
}

// Intent is legal only for a damaged robot and never blocks programming.
{
    const {game} = makeGame();
    const player = game.players.one;
    player.hand = Array.from({length: 5}, (_, index) => card(`hand-${index}`));
    game.room.phase = "programming";
    game.userEvent("one", "set-power-down-intent", [{enabled: true}]);
    assert.equal(player.powerDownIntent, false, "undamaged robot announced Перезагрузка");
    player.damage = 4;
    game.userEvent("one", "set-power-down-intent", [{enabled: true}]);
    game.userEvent("one", "assign-register", [{register: 0, cardId: "hand-0"}]);
    assert.equal(player.powerDownIntent, true, "damaged robot could not announce Перезагрузка");
    assert.equal(player.selected[0], "hand-0", "Перезагрузка intent blocked register programming");
    game.userEvent("one", "set-power-down-intent", [{enabled: true}]);
    assert.equal(player.powerDownIntent, true, "idempotent intent event toggled its state");
}

// The choice stays private until programming finishes and then targets the next round.
{
    const {game} = makeGame();
    const player = game.players.one;
    player.damage = 3;
    player.powerDownIntent = true;
    assert.equal(player.powerDownNextRound, false);
    assert(!game.room.log.some((entry) => entry.includes("объявляет Перезагрузка")));
    game.confirmPowerDownIntents(["one"]);
    assert.equal(player.powerDownNextRound, true);
    assert(game.room.log.some((entry) => entry.includes("объявляет Перезагрузка")));
}

// Activation clears damage/program cards, skips the deal, and marks the robot ready.
{
    const {game} = makeGame(["one", "two"]);
    const player = game.players.one;
    player.damage = 6;
    player.registers = Array.from({length: 5}, (_, index) => card(`old-${index}`));
    player.powerDownNextRound = true;
    game.startRound();
    assert.equal(player.poweredDown, true);
    assert.equal(player.damage, 0);
    assert.equal(player.hand.length, 0);
    assert(player.selected.every((value) => value === null));
    assert.equal(player.locked, true);
    assert.equal(game.players.two.poweredDown, false);
    assert(game.players.two.hand.length > 0, "running robot did not receive cards");
}

// Continuation decisions are concurrent and stay hidden until everyone answers.
{
    const {game} = makeGame(["one", "two"]);
    game.players.one.poweredDown = true;
    game.players.two.poweredDown = true;
    game.prepareReentry = () => true;
    assert.equal(game.preparePowerDownChoice(), true);
    const logLength = game.room.log.length;
    game.choosePowerDownContinuation("one", true);
    assert.deepStrictEqual(game.room.powerDownChoice, {answered: 1, total: 2});
    assert.equal(game.room.log.length, logLength, "first continuation choice leaked into the log");
    assert.equal(game.privateState("one").powerDownChoice.choice, true);
    assert.equal(game.privateState("two").powerDownChoice.choice, null);
    game.choosePowerDownContinuation("one", false);
    assert.deepStrictEqual(game.room.powerDownChoice, {answered: 1, total: 2}, "a fixed answer changed after resubmission");
    assert.equal(game.privateState("one").powerDownChoice.choice, true, "an explicit duplicate event toggled the answer");
    game.choosePowerDownContinuation("two", false);
    assert.equal(game.players.one.powerDownNextRound, true);
    assert.equal(game.players.two.powerDownNextRound, false);
    assert.equal(game.room.log.length, logLength + 2, "choices were not revealed together after the last answer");
}

// Damage received while powered down immediately fills newly locked registers.
{
    const {game} = makeGame();
    const player = game.players.one;
    const robot = game.getRobot("one");
    player.poweredDown = true;
    player.damage = 4;
    game.damageRobot(robot, 2, "test");
    assert.deepStrictEqual(player.lockedRegisters, [3, 4]);
    assert(player.registers[3] && player.registers[4], "locked registers did not receive random cards");
    assert.equal(player.selected[3], player.registers[3].id);
    player.damage = 4;
    game.syncPoweredDownRegisters(player);
    assert.deepStrictEqual(player.lockedRegisters, []);
    assert(player.registers.every((value) => value === null), "repaired registers kept their cards");
}

// Randomly programmed locked cards are public immediately, before their register is revealed.
{
    const {game} = makeGame();
    const player = game.players.one;
    player.poweredDown = true;
    player.damage = 5;
    game.syncPoweredDownRegisters(player);
    game.room.phase = "resolving";
    game.room.revealedRegisters = 0;
    const program = game.publicState().programs.one;
    assert.equal(program.cards[4].id, player.registers[4].id);
    assert(program.cards.slice(0, 4).every((value) => value === null));
    game.room.phase = "power-down-choice";
    assert.equal(game.publicState().programs.one.cards[4].id, player.registers[4].id,
        "locked card stopped being public during the continuation choice");
    game.room.phase = "programming";
    assert.equal(game.publicState().programs.one.cards[4].id, player.registers[4].id,
        "locked card stopped being public during the next programming phase");
}

// The public room state never exposes an unconfirmed intent.
{
    const {game} = makeGame(["one", "two"]);
    game.players.one.damage = 2;
    game.players.one.powerDownIntent = true;
    game.players.one.hand = Array.from({length: 5}, (_, index) => card(`private-${index}`));
    game.players.one.selected = game.players.one.hand.map(({id}) => id);
    game.room.phase = "programming";
    const publicState = game.publicState();
    assert.equal(publicState.playerStats.one.powerDownNextRound, false);
    assert.equal(Object.prototype.hasOwnProperty.call(publicState.playerStats.one, "powerDownIntent"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(publicState, "powerDownChoices"), false);
    assert(publicState.programs.one.cards.every((value) => value === null), "programming cards leaked through public state");
}

// Every damage threshold from five through nine exposes exactly the newly locked registers.
for (let damage = 5; damage <= 9; damage++) {
    const {game} = makeGame();
    const player = game.players.one;
    player.poweredDown = true;
    player.damage = damage;
    game.syncPoweredDownRegisters(player);
    const expected = Array.from({length: damage - 4}, (_, index) => 9 - damage + index);
    assert.deepStrictEqual(player.lockedRegisters, expected, `wrong locked registers at ${damage} damage`);
    assert.equal(player.registers.filter(Boolean).length, damage - 4, `wrong number of face-up cards at ${damage} damage`);
}

// Перезагрузка suppresses only self-programming; factory movement still affects the robot.
{
    const {game} = makeGame();
    const player = game.players.one;
    const robot = game.getRobot("one");
    player.poweredDown = true;
    robot.x = 1;
    robot.y = 0;
    Object.defineProperty(game, "features", {value: {conveyors:{"1,0":"south","1,1":"south"},
        express:new Set(), walls:new Set(), pits:new Set(), repairs:new Set(), gears:{},lasers:[],pushers:[]}});
    game.moveConveyors(false);
    assert.deepStrictEqual([robot.x, robot.y], [1, 1], "powered-down robot ignored its conveyor");
}

// Pushers, gears, collisions, flags, repairs and pits continue to affect a powered-down robot.
{
    const {game} = makeGame(["one", "two"]);
    const sleeper = game.getRobot("one");
    const runner = game.getRobot("two");
    game.players.one.poweredDown = true;
    const features = {conveyors: {}, express: new Set(), walls: new Set(), pits: new Set(), repairs: new Set(),
        gears: {"2,1": 1}, pushers: [{x: 1, y: 1, direction: "east", active: [2]}], lasers: [], conveyorTurns: {}};
    Object.defineProperty(game, "features", {value: features});
    Object.assign(sleeper, {x: 1, y: 1, direction: "north", archive: {x: 0, y: 12}});
    Object.assign(runner, {x: 0, y: 1, direction: "east"});
    assert(game.move(runner, "east", "test collision"), "running robot could not push a powered-down robot");
    assert.deepStrictEqual([sleeper.x, sleeper.y], [2, 1]);
    game.activateGears();
    assert.equal(sleeper.direction, "east", "powered-down robot ignored a gear");
    features.pushers = [{x: 2, y: 1, direction: "south", active: [2]}];
    game.room.register = 1;
    game.activatePushers();
    assert.deepStrictEqual([sleeper.x, sleeper.y], [2, 1], "pusher fired in the wrong register");
    game.room.register = 2;
    game.activatePushers();
    assert.deepStrictEqual([sleeper.x, sleeper.y], [2, 2], "powered-down robot ignored an active pusher");
    game.room.flags = [{x: 2, y: 2, number: 1}];
    game.players.one.checkpointAvailable = 1;
    game.touchCheckpoints();
    assert.equal(game.players.one.checkpoints, 1, "powered-down robot did not activate a flag");
    assert.deepStrictEqual(sleeper.archive, {x: 2, y: 2}, "flag did not update the powered-down robot's archive");
    game.players.one.damage = 2;
    features.repairs.add("2,2");
    game.cleanupRound();
    assert.equal(game.players.one.damage, 1, "repair space did not repair a powered-down robot");
    features.pits.add("2,3");
    game.move(sleeper, "south", "test pit");
    assert.equal(sleeper.destroyed, true, "powered-down robot did not fall into a pit");
}

// A pending Перезагрузка can be accepted or rejected during reentry.
{
    const {game} = makeGame();
    const player = game.players.one;
    const robot = game.getRobot("one");
    robot.destroyed = true;
    robot.x = null;
    robot.y = null;
    player.powerDownReentryChoiceRequired = true;
    game.room.phase = "reentry";
    game.room.reentryQueue = ["one"];
    game.room.reentryUserId = "one";
    game.startRound = () => { game.roundStarted = true; };
    game.chooseReentry("one", {x: 0, y: 12, direction: "east"});
    assert.equal(robot.destroyed, true, "reentry accepted no Перезагрузка decision");
    game.chooseReentry("one", {x: 0, y: 12, direction: "east", poweredDown: false});
    assert.equal(robot.destroyed, false);
    assert.equal(player.powerDownNextRound, false);
    assert.equal(player.damage, 2);
    assert.equal(game.roundStarted, true);
}

// Alternative reentry cells cannot aim at a nearby robot through a clear lane.
{
    const {game} = makeGame(["one", "two", "three"]);
    const robot = game.getRobot("one");
    Object.assign(robot, {x:null,y:null,destroyed:true,archive:{x:5,y:5}});
    Object.assign(game.getRobot("two"), {x:5,y:5}); // Occupies the archive.
    const nearby = game.getRobot("three");
    Object.assign(nearby, {x:8,y:6});
    const features = {walls:new Set(),pits:new Set(["4,4"]),conveyors:{},express:new Set(),repairs:new Set(),gears:{},lasers:[],pushers:[]};
    Object.defineProperty(game,"features",{value:features});
    const candidate = () => game.reentryCandidates("one").find(point=>point.x===5&&point.y===6);
    assert(!candidate().directions.includes("east"),"A robot three cells ahead did not block the reentry heading");
    assert(!candidate().directions.includes("north"),"The robot at the adjacent archive was ignored");
    assert(candidate().directions.includes("west"));
    assert(!game.reentryCandidates("one").some(point=>point.x===4&&point.y===4),"A pit is a reentry candidate");
    assert(!game.reentryCandidates("one").some(point=>point.x===5&&point.y===5),"An occupied archive is a reentry candidate");
    features.walls.add("7,6,east");
    assert(candidate().directions.includes("east"),"A wall did not block the line to the nearby robot");
    features.walls.clear(); nearby.x=9;
    assert(candidate().directions.includes("east"),"A robot four cells away incorrectly blocked reentry");
    nearby.x=6;
    assert(!candidate().directions.includes("east"),"The nearest robot was ignored");
    nearby.x=5;nearby.y=6;
    assert(!candidate(),"An occupied alternative remained selectable");
    game.getRobot("two").x=10;game.getRobot("two").y=10;
    const points=game.reentryCandidates("one");
    assert.equal(points.length,1,"A free archive should not offer alternative cells");
    assert(points[0].archive && points[0].x===5 && points[0].y===5);
    // The same authoritative heading check is applied again on confirmation.
    game.getRobot("two").x=5;game.getRobot("two").y=5;
    nearby.x=8;nearby.y=6;
    Object.assign(game.room,{phase:"reentry",reentryUserId:"one",reentryQueue:["one"]});
    game.startRound=()=>{};
    game.chooseReentry("one",{x:5,y:6,direction:"east"});
    assert(robot.destroyed,"Server accepted a direction blocked by a nearby robot");
    game.chooseReentry("one",{x:5,y:6,direction:"west"});
    assert(!robot.destroyed,"Server rejected a legal on-field placement");
}

// Damage taken during Перезагрузка is added to the normal two reentry damage.
{
    const {game} = makeGame();
    const player = game.players.one;
    const robot = game.getRobot("one");
    robot.destroyed = true;
    robot.x = null;
    robot.y = null;
    player.poweredDown = true;
    player.powerDownDamage = 3;
    game.room.phase = "reentry";
    game.room.reentryQueue = ["one"];
    game.room.reentryUserId = "one";
    game.startRound = () => {};
    game.chooseReentry("one", {x: 0, y: 12, direction: "north"});
    assert.equal(player.damage, 5);
    assert.deepStrictEqual(player.lockedRegisters, [4]);
    assert(player.registers[4], "reentry damage failed to program the newly locked register");
}

// Destruction after an announcement requires a fresh reentry decision and can preserve the announcement.
{
    const {game} = makeGame();
    const player = game.players.one;
    const robot = game.getRobot("one");
    player.powerDownNextRound = true;
    game.reboot(robot, "test");
    assert.equal(player.powerDownReentryChoiceRequired, true);
    game.room.phase = "reentry";
    game.room.reentryQueue = ["one"];
    game.room.reentryUserId = "one";
    game.startRound = () => { game.roundStarted = true; };
    game.chooseReentry("one", {x: 0, y: 12, direction: "west", poweredDown: true});
    assert.equal(player.powerDownNextRound, true);
    assert.equal(player.damage, 2);
    assert.equal(game.roundStarted, true);
}

// Waking keeps damage and its locked cards.
{
    const {game} = makeGame(["one", "two"]);
    const player = game.players.one;
    player.poweredDown = true;
    player.damage = 6;
    player.powerDownDamage = 6;
    game.syncPoweredDownRegisters(player);
    game.prepareReentry = () => false;
    assert(game.preparePowerDownChoice());
    game.choosePowerDownContinuation("one", false);
    assert.equal(player.poweredDown, false);
    assert.equal(player.damage, 6);
    assert.equal(player.hand.length, 3);
    assert.deepStrictEqual(player.lockedRegisters, [3, 4]);
}

// Continuing Перезагрузка clears accumulated damage and the associated cards at the next round boundary.
{
    const {game} = makeGame(["one", "two"]);
    const player = game.players.one;
    player.poweredDown = true;
    player.damage = 7;
    player.powerDownDamage = 7;
    game.syncPoweredDownRegisters(player);
    game.prepareReentry = () => false;
    assert(game.preparePowerDownChoice());
    game.choosePowerDownContinuation("one", true);
    assert.equal(player.poweredDown, true);
    assert.equal(player.damage, 0);
    assert.equal(player.powerDownDamage, 0);
    assert.deepStrictEqual(player.lockedRegisters, []);
    assert(player.selected.every((value) => value === null));
}

(async () => {
    // A newly announced Перезагрузка does not suppress this round's cards or robot laser.
    const {game} = makeGame(["one", "two"]);
    const programs = {
        one: Array.from({length: 5}, (_, index) => ({...card(`one-${index}`, 500 - index), type: "right", label: "Turn Right"})),
        two: Array.from({length: 5}, (_, index) => ({...card(`two-${index}`, 100 - index), type: "left", label: "Turn Left"}))
    };
    ["one", "two"].forEach((id) => {
        game.players[id].hand = programs[id];
        game.players[id].selected = programs[id].map(({id: cardId}) => cardId);
        game.players[id].locked = true;
    });
    game.players.one.damage = 2;
    game.players.one.powerDownIntent = true;
    game.room.phase = "programming";
    game.room.round = 1;
    game.room.flags = [];
    game.showStage = async () => {};
    game.moveConveyors = () => {};
    game.activatePushers = () => {};
    game.activateGears = () => {};
    let laserPhases = 0;
    game.fireAllLasers = () => {
        laserPhases += 1;
        assert.equal(game.players.one.poweredDown, false, "announcing robot powered down during its current program");
        return [];
    };
    await game.resolveRound();
    assert.equal(laserPhases, 5, "announcing robot did not participate in every current laser phase");
    assert.equal(game.getRobot("one").direction, "east", "announcing robot did not execute all five current cards");
    assert.equal(game.players.one.poweredDown, true, "Перезагрузка did not activate in the following round");
    assert.equal(game.players.one.damage, 0, "Перезагрузка activation did not clear damage");

    // Face-up cards inserted by damage must not execute while Перезагрузка is active.
    {
        const {game: sleepingGame} = makeGame(["one", "two"]);
        const sleeper = sleepingGame.players.one;
        sleeper.poweredDown = true;
        sleeper.damage = 9;
        sleeper.locked = true;
        sleeper.registers = Array.from({length: 5}, (_, index) => ({...card(`sleep-${index}`, 800 - index), type: "right", label: "Turn Right"}));
        sleeper.selected = sleeper.registers.map(({id}) => id);
        sleeper.lockedRegisters = [0, 1, 2, 3, 4];
        const runnerCards = Array.from({length: 5}, (_, index) => ({...card(`run-${index}`, 200 - index), type: "left", label: "Turn Left"}));
        sleepingGame.players.two.hand = runnerCards;
        sleepingGame.players.two.selected = runnerCards.map(({id}) => id);
        sleepingGame.players.two.locked = true;
        sleepingGame.room.phase = "programming";
        sleepingGame.room.round = 2;
        sleepingGame.room.flags = [];
        sleepingGame.showStage = async () => {};
        sleepingGame.moveConveyors = () => {};
        sleepingGame.activatePushers = () => {};
        sleepingGame.activateGears = () => {};
        sleepingGame.fireAllLasers = () => [];
        const sleepingDirection = sleepingGame.getRobot("one").direction;
        await sleepingGame.resolveRound();
        assert.equal(sleepingGame.getRobot("one").direction, sleepingDirection,
            "a face-up locked card executed while its robot was powered down");
    }

    // A powered-down robot never emits a beam, but still blocks and receives another robot's beam.
    {
        const {game: laserGame} = makeGame(["one", "two"]);
        Object.defineProperty(laserGame, "features", {value: {conveyors:{},express:new Set(),walls:new Set(),
            pits:new Set(),repairs:new Set(),gears:{},lasers:[],pushers:[]}});
        const sleeperRobot = laserGame.getRobot("one");
        const shooterRobot = laserGame.getRobot("two");
        Object.assign(sleeperRobot, {x: 3, y: 4, direction: "west"});
        Object.assign(shooterRobot, {x: 0, y: 4, direction: "east"});
        laserGame.players.one.poweredDown = true;
        const hits = laserGame.fireAllLasers();
        assert.equal(laserGame.room.laserShots.some((shot) => shot.sourceUserId === "one"), false,
            "powered-down robot fired a laser");
        const shot = laserGame.room.laserShots.find((item) => item.sourceUserId === "two");
        assert(shot && shot.targetUserId === "one", "powered-down robot did not block the first incoming beam");
        laserGame.applyLaserHits(hits);
        assert.equal(laserGame.players.one.damage, 1, "powered-down robot ignored incoming laser damage");
        assert.equal(laserGame.players.one.powerDownDamage, 1, "incoming damage was not retained for reentry");
    }
    console.log("Перезагрузка regression checks passed");
})().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
