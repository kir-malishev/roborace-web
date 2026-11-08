"use strict";

const path = require("path");
require("./scripts/asset-inputs").verifyAssets(__dirname);
const FieldFormat = require("./public/field-format");

const DIRECTIONS = ["north", "east", "south", "west"];
const VECTORS = {
    north: {x: 0, y: -1},
    east: {x: 1, y: 0},
    south: {x: 0, y: 1},
    west: {x: -1, y: 0}
};
const ROBOT_COLORS = ["#f04444", "#2d82ff", "#ffd23f", "#27c56d", "#b66dff", "#ff8b38", "#32c8cb", "#f26bb4"];
const BOARD_SIZE = 12;
const STAGE_ROWS = 16;
const STEP_DELAY_MS = 360;
const DEFAULT_GAME_OPTIONS = Object.freeze({startingLives: 3, lastPlayerSeconds: 30, powerDownMode: "classic", finishAllFlags: false});
const AUTO_FILL_DISPLAY_MS = 900;
const HISTORY_COMPLETED_ROUNDS = 2;
const HISTORY_VISUAL_FIELDS = ["phase", "round", "register", "revealedRegisters", "stage",
    "robots", "flags", "programs", "playerStats", "laserShots", "boardEvents"];
const {FIELD_DOCUMENTS, BOARD_IMAGES, BOARD_THUMBNAILS, START_CARDS, START_TEMPLATES, BOARD_FEATURES, COURSE_CARDS, EMPTY_FEATURES} = require("./data/catalog");

function normalizeRotation(rotation) {
    const value = Number(rotation) || 0;
    return [0, 90, 180, 270].includes(value) ? value : 0;
}

function rotatePoint(x, y, rotation) {
    if (y >= BOARD_SIZE) return {x,y};
    switch (normalizeRotation(rotation)) {
    case 90: return {x: BOARD_SIZE - 1 - y, y: x};
    case 180: return {x: BOARD_SIZE - 1 - x, y: BOARD_SIZE - 1 - y};
    case 270: return {x: y, y: BOARD_SIZE - 1 - x};
    default: return {x, y};
    }
}

function orientFeatures(features, rotation) {
    const quarterTurns = normalizeRotation(rotation) / 90;
    if (!quarterTurns) return features;
    const pointKey = (key) => {
        const [x, y] = key.split(",").map(Number);
        const point = rotatePoint(x, y, rotation);
        return positionKey(point.x, point.y);
    };
    const mappedCells = (source) => new Set([...source].map(pointKey));
    const mappedValues = (source, directionValues = false) => Object.fromEntries(Object.entries(source).map(([key, value]) =>
        [pointKey(key), directionValues && Number(key.split(",")[1]) < BOARD_SIZE ? rotate(value, quarterTurns) : value]));
    const result = {
        size: BOARD_SIZE, starts:features.starts,
        pits: mappedCells(features.pits),
        repairs: mappedCells(features.repairs),
        gears: mappedValues(features.gears),
        conveyors: mappedValues(features.conveyors, true),
        express: mappedCells(features.express),
        hintConnections: (features.hintConnections || []).map((connection) => connection.split("|").map(pointKey).join("|")),
        conveyorTurns: mappedValues(features.conveyorTurns || {}),
        conveyorConnections: features.conveyorConnections ? features.conveyorConnections.filter(link => { const [from,to]=link.split("|"); return (Number(from.split(",")[1]) < 12) === (Number(to.split(",")[1]) < 12); }).map(connection => connection.split("|").map(pointKey).join("|")) : null,
        walls: new Set([...features.walls].map((wall) => {
            const [x, y, direction] = wall.split(",");
            const point = rotatePoint(Number(x), Number(y), rotation);
            return `${point.x},${point.y},${Number(y) < BOARD_SIZE ? rotate(direction, quarterTurns) : direction}`;
        })),
        lasers: features.lasers.map((laser) => ({...rotatePoint(laser.x, laser.y, rotation),
            direction: laser.y < BOARD_SIZE ? rotate(laser.direction, quarterTurns) : laser.direction, count: laser.count})),
        pushers: features.pushers.map((pusher) => ({...rotatePoint(pusher.x, pusher.y, rotation),
            direction: pusher.y < BOARD_SIZE ? rotate(pusher.direction, quarterTurns) : pusher.direction, active: [...pusher.active]}))
    };
    if (result.conveyorConnections) result.conveyorConnections.push(...FieldFormat.inferConnections(FieldFormat.geometry(result),true));
    return result;
}

function positionKey(x, y) {
    return `${x},${y}`;
}

function rotate(direction, amount) {
    return DIRECTIONS[(DIRECTIONS.indexOf(direction) + amount + 4) % 4];
}

function conveyorArrivalTurn(incomingDirection, outgoingDirection) {
    if (!incomingDirection || !outgoingDirection) return 0;
    const difference=(DIRECTIONS.indexOf(outgoingDirection)-DIRECTIONS.indexOf(incomingDirection)+4)%4;
    return difference===1?1:difference===3?-1:0;
}

function makeDeck() {
    const cards = [];
    let id = 1;
    const add = (type, label, count, startPriority, step) => {
        for (let index = 0; index < count; index++)
            cards.push({id: `card-${id++}`, type, label, priority: startPriority + index * step});
    };
    add("move1", "Вперёд 1", 18, 490, 10);
    add("move2", "Вперёд 2", 12, 670, 10);
    add("move3", "Вперёд 3", 6, 790, 10);
    add("backup", "Назад", 6, 430, 10);
    add("left", "Влево", 18, 70, 20);
    add("right", "Вправо", 18, 80, 20);
    add("uturn", "Разворот", 6, 10, 10);
    return cards;
}

function publicFieldFeatures(features) {
    return {...FieldFormat.geometry(features),
        starts:(features.starts || []).map((point,slot) => ({...point,slot:slot+1})),
        conveyorConnections:features.conveyorConnections == null ? null : [...features.conveyorConnections]};
}

function shuffle(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
        const next = Math.floor(Math.random() * (index + 1));
        [result[index], result[next]] = [result[next], result[index]];
    }
    return result;
}

// Engine code sends this.room as-is (updatePublicState and friends), so sets
// that live in the room must serialize to arrays
class JSONSet extends Set {
    toJSON() {
        return [...this];
    }
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const BOARD_TEMPLATES = FIELD_DOCUMENTS;

function hydrateEditableFeatures(features) {
    return {...FieldFormat.hydrate(features), fullField:true,
        conveyorConnections:new Set(features.conveyorConnections), conveyorTurns:{}};
}

function jsonClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function jsonEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function validGameOption(key, value) {
    if (key === "finishAllFlags") return typeof value === "boolean";
    if (key === "startingLives" || key === "lastPlayerSeconds")
        return value === null || (Number.isSafeInteger(value) && value > 0);
    return key === "powerDownMode" && ["classic", "simple"].includes(value);
}

function normalizeGameOptions(options) {
    const source = options && typeof options === "object" ? options : {};
    return Object.fromEntries(Object.entries(DEFAULT_GAME_OPTIONS).map(([key, fallback]) =>
        [key, validGameOption(key, source[key]) ? source[key] : fallback]));
}

function init(wsServer, gamePath) {
    const app = wsServer.app;
    const registry = wsServer.users;
    registry.handleAppPage(gamePath, path.join(__dirname, "public", "app.html"));
    app.use("/roborace", wsServer.static(path.join(__dirname, "public")));

    class GameState extends wsServer.users.RoomState {
        constructor(hostId, hostData, userRegistry) {
            // Game is still in beta, so it has no entry in the engine's games list and no play time is counted
            super(hostId, hostData, userRegistry, null, gamePath);
            this.players = {};
            this.deck = [];
            this.discard = [];
            this.laserEventCounter = 0;
            this.boardEventCounter = 0;
            this.programmingTimerHandle = null;
            this.programmingTimerGeneration = 0;
            this.autoFillResolveHandle = null;
            this.pauseWaiters = [];
            this.turnHistory = [];
            this.historyRecordingRegister = null;
            this.historyRecordingState = null;
            this.historyViewFrame = null;
            this.historyPlaybackHandle = null;
            this.historyPlaybackGeneration = 0;
            this.room = {
                ...this.room,
                inited: true,
                title: "RoboRace",
                hostId,
                phase: "lobby",
                paused: false,
                round: 0,
                register: null,
                playerNames: {},
                playerSlots: Array(8).fill(null),
                playerColors: {},
                startAssignments: {},
                raceExcludedPlayers: new JSONSet(),
                onlinePlayers: new JSONSet(),
                spectators: new JSONSet(),
                robots: [],
                flags: [],
                log: ["Комната создана. Выберите роль игрока или зрителя."],
                winnerId: null,
                winnerReason: null,
                finishOrder: [],
                resolution: null,
                laserShots: [],
                boardEvents: [],
                programmingTimer: null,
                programmingAutoFill: null,
                powerDownChoice: null,
                gameOptions: {...DEFAULT_GAME_OPTIONS},
                activePowerDownMode: "classic",
                historyReview: {selected: null, playing: false, frameIndex: null, revision: 0},
                board: {name: COURSE_CARDS[0].board, size: BOARD_SIZE, start: START_CARDS[0]},
                course: {...COURSE_CARDS[0]},
                courses: COURSE_CARDS,
                robotColors: ROBOT_COLORS,
                startCards: START_CARDS,
                boardImages: BOARD_IMAGES,
                boardThumbnails: BOARD_THUMBNAILS
            };
        }

        publicPrograms(phase = this.room.phase, revealedRegisters = this.room.revealedRegisters || 0) {
            const showPrograms = phase === "resolving" || phase === "finished";
            const revealed = showPrograms ? revealedRegisters : 0;
            return Object.fromEntries(this.room.playerSlots.filter((userId) => userId && this.players[userId]).map((userId) => {
                const player = this.players[userId];
                const cards = player.selected.map((id) => this.cardById(player, id));
                return [userId, {poweredDown: player.poweredDown,
                    lockedRegisters: [...(player.lockedRegisters || [])],
                    cards: cards.map((card, index) => (player.lockedRegisters || []).includes(index)
                        || (showPrograms && index < revealed) ? card : null)}];
            }));
        }

        publicPlayerStats() {
            return Object.fromEntries(this.room.playerSlots.filter((userId) => userId && this.players[userId]).map((userId) => {
                const player = this.players[userId];
                return [userId, {
                    damage: player.damage,
                    lives: player.lives,
                    checkpoints: player.checkpoints,
                    finished: !!player.finished,
                    ready: !!player.locked,
                    poweredDown: player.poweredDown,
                    powerDownNextRound: player.powerDownNextRound,
                }];
            }));
        }

        publicRobots() {
            return this.room.robots.filter((robot) => !robot.withdrawn).map((robot) => ({...robot}));
        }

        publicHistoryReview() {
            const review = this.room.historyReview || {};
            return {
                entries: this.historyEntries(),
                selected: review.selected || null,
                playing: !!review.playing,
                frameIndex: Number.isInteger(review.frameIndex) ? review.frameIndex : null,
                stage: this.historyViewFrame ? this.historyViewFrame.stage : null,
                // Keep the score panel tied explicitly to the reviewed frame.
                // The regular player-state channel continues to publish the
                // canonical game while paused, so clients must not derive
                // historical public counters from that live state.
                playerStats: this.historyViewFrame
                    ? jsonClone(this.historyViewFrame.playerStats || {}) : null,
                actual: !this.historyViewFrame,
                revision: Number(review.revision) || 0
            };
        }

        publicState() {
            const startLayout = this.features;
            const state = {
                ...this.room,
                startPositions: (startLayout.starts || []).map((position) => ({...position})),
                fieldFeatures: publicFieldFeatures(this.features),
                boardTemplates: BOARD_TEMPLATES,
                startTemplates: START_TEMPLATES,
                programs: this.publicPrograms(),
                playerStats: this.publicPlayerStats(),
                onlinePlayers: [...this.room.onlinePlayers],
                spectators: [...this.room.spectators],
                robots: this.publicRobots(),
                log: this.room.log.slice(-12)
            };
            if (this.historyViewFrame) {
                Object.assign(state, jsonClone(this.historyViewFrame));
                state.paused = this.room.paused;
                state.actualPhase = this.room.phase;
            }
            state.historyReview = this.publicHistoryReview();
            return state;
        }

        privateState(userId) {
            const player = this.room.playerSlots.includes(userId) ? this.players[userId] : null;
            return player ? {
                hand: player.hand,
                selected: player.selected,
                registerCards: player.selected.map((id) => this.cardById(player, id)),
                lockedRegisters: player.lockedRegisters || [],
                locked: player.locked,
                autoFilledRegisters: player.autoFilledRegisters || [],
                damage: player.damage,
                lives: player.lives,
                checkpoints: player.checkpoints,
                finished: !!player.finished,
                poweredDown: player.poweredDown,
                powerDownIntent: player.powerDownIntent,
                canPowerDown: player.damage > 0 && !player.poweredDown,
                powerDownUnavailableReason: player.damage <= 0 ? "Перезагрузка доступен только повреждённому роботу" : null,
                powerDownChoice: this.room.phase === "power-down-choice" ? {
                    eligible: (this.powerDownChoiceUsers || []).includes(userId),
                    answered: !!(this.powerDownChoices && this.powerDownChoices.has(userId)),
                    choice: this.powerDownChoices && this.powerDownChoices.has(userId) ? this.powerDownChoices.get(userId) : null
                } : null,
                resolving: this.room.phase === "resolving",
                reentry: this.room.phase === "reentry" ? {
                    active: this.room.reentryUserId === userId,
                    candidates: this.room.reentryUserId === userId ? this.reentryCandidates(userId) : [],
                    needsPowerDownChoice: this.room.reentryUserId === userId && !!player.powerDownReentryChoiceRequired
                } : null
            } : {hand: [], selected: [], registerCards: [], lockedRegisters: [], locked: false};
        }

        playerName(userId) {
            const profile = this.room.authUsers && this.room.authUsers[userId];
            return profile && profile.gameSettings && profile.gameSettings.syncName && profile.name
                ? profile.name
                : this.room.playerNames[userId] || "Игрок";
        }

        addLog(text) {
            this.room.log.push(text);
            if (this.room.log.length > 30)
                this.room.log.splice(0, this.room.log.length - 30);
        }

        historyEntries() {
            return (this.turnHistory || []).flatMap((round) => (round.registers || [])
                .filter((entry) => entry.completed && entry.frames && entry.frames.length)
                .map((entry) => ({round: round.round, register: entry.register, frames: entry.frames.length})))
                .sort((left, right) => left.round - right.round || left.register - right.register);
        }

        historyRound(roundNumber, create = false) {
            let round = (this.turnHistory || []).find((item) => item.round === roundNumber);
            if (!round && create) {
                round = {round: roundNumber, complete: false, registers: []};
                this.turnHistory.push(round);
                this.turnHistory.sort((left, right) => left.round - right.round);
            }
            return round || null;
        }

        pruneTurnHistory() {
            const complete = (this.turnHistory || []).filter((round) => round.complete)
                .sort((left, right) => left.round - right.round).slice(-HISTORY_COMPLETED_ROUNDS);
            const incomplete = (this.turnHistory || []).filter((round) => !round.complete)
                .sort((left, right) => left.round - right.round).slice(-1);
            const keep = new Set([...complete, ...incomplete]);
            this.turnHistory = (this.turnHistory || []).filter((round) => keep.has(round))
                .sort((left, right) => left.round - right.round);
        }

        captureHistoryVisualState() {
            return jsonClone({
                phase: "resolving",
                round: this.room.round,
                register: this.room.register,
                revealedRegisters: this.room.revealedRegisters || 0,
                stage: this.room.stage,
                robots: this.publicRobots(),
                flags: this.room.flags,
                programs: this.publicPrograms("resolving", this.room.revealedRegisters || 0),
                playerStats: this.publicPlayerStats(),
                laserShots: this.room.laserShots || [],
                boardEvents: this.room.boardEvents || []
            });
        }

        beginHistoryRegister(register) {
            const round = this.historyRound(this.room.round, true);
            const previous = round.registers.find((entry) => entry.register === register);
            if (previous)
                round.registers.splice(round.registers.indexOf(previous), 1);
            const entry = {register, completed: false, frames: []};
            round.registers.push(entry);
            round.registers.sort((left, right) => left.register - right.register);
            this.historyRecordingRegister = entry;
            this.historyRecordingState = null;
            this.pruneTurnHistory();
        }

        recordHistoryFrame(delay) {
            const entry = this.historyRecordingRegister;
            if (!entry || entry.register !== this.room.register)
                return false;
            const state = this.captureHistoryVisualState();
            const duration = Math.max(0, Number(delay) || 0);
            if (!entry.frames.length) {
                entry.frames.push({duration, state});
            } else {
                const changes = {};
                HISTORY_VISUAL_FIELDS.forEach((field) => {
                    if (!jsonEqual(this.historyRecordingState[field], state[field]))
                        changes[field] = state[field];
                });
                entry.frames.push({duration, changes});
            }
            this.historyRecordingState = state;
            return true;
        }

        completeHistoryRegister() {
            if (!this.historyRecordingRegister || !this.historyRecordingRegister.frames.length)
                return false;
            this.historyRecordingRegister.completed = true;
            return true;
        }

        finishHistoryRound() {
            const round = this.historyRound(this.room.round);
            if (round) {
                round.registers = round.registers.filter((entry) => entry.completed && entry.frames.length);
                round.complete = round.registers.length === 5;
            }
            this.historyRecordingRegister = null;
            this.historyRecordingState = null;
            this.pruneTurnHistory();
        }

        historyRegister(roundNumber, register) {
            const round = this.historyRound(roundNumber);
            return round && round.registers.find((entry) => entry.register === register && entry.completed && entry.frames.length) || null;
        }

        reconstructHistoryFrame(entry, frameIndex) {
            if (!entry || !entry.frames || !entry.frames.length)
                return null;
            const lastIndex = Math.max(0, Math.min(entry.frames.length - 1, Number(frameIndex) || 0));
            let state = {};
            for (let index = 0; index <= lastIndex; index++) {
                const frame = entry.frames[index];
                if (frame.state) state = jsonClone(frame.state);
                else Object.assign(state, jsonClone(frame.changes || {}));
            }
            return state;
        }

        stopHistoryPlayback(update = false) {
            this.historyPlaybackGeneration = (this.historyPlaybackGeneration || 0) + 1;
            if (this.historyPlaybackHandle) {
                clearTimeout(this.historyPlaybackHandle);
                this.historyPlaybackHandle = null;
            }
            if (!this.room.historyReview)
                this.room.historyReview = {selected: null, playing: false, frameIndex: null, revision: 0};
            const changed = !!this.room.historyReview.playing;
            this.room.historyReview.playing = false;
            if (update && changed) this.update();
            return changed;
        }

        resetHistoryReview(update = true) {
            this.stopHistoryPlayback(false);
            const review = this.room.historyReview || {};
            const changed = !!this.historyViewFrame || !!review.selected || review.frameIndex != null;
            this.historyViewFrame = null;
            this.room.historyReview = {
                selected: null,
                playing: false,
                frameIndex: null,
                revision: (Number(review.revision) || 0) + (changed ? 1 : 0)
            };
            if (update && changed) this.update();
            return changed;
        }

        clearTurnHistory() {
            this.stopHistoryPlayback(false);
            this.turnHistory = [];
            this.historyRecordingRegister = null;
            this.historyRecordingState = null;
            this.historyViewFrame = null;
            this.room.historyReview = {selected: null, playing: false, frameIndex: null, revision: 0};
        }

        selectHistoryRegister(roundNumber, register) {
            if (!this.room.paused)
                return false;
            const entry = this.historyRegister(Number(roundNumber), Number(register));
            if (!entry)
                return false;
            this.stopHistoryPlayback(false);
            this.historyViewFrame = this.reconstructHistoryFrame(entry, 0);
            const review = this.room.historyReview || {};
            this.room.historyReview = {
                selected: {round: Number(roundNumber), register: Number(register)},
                playing: false,
                frameIndex: 0,
                revision: (Number(review.revision) || 0) + 1
            };
            this.update();
            return true;
        }

        historyPlaybackSequence(roundNumber, register) {
            const entries = this.historyEntries();
            let start = entries.findIndex((entry) => entry.round === roundNumber && entry.register === register);
            if (start < 0) start = 0;
            return entries.slice(start).flatMap((item) => {
                const entry = this.historyRegister(item.round, item.register);
                let state = {};
                return entry.frames.map((frame, frameIndex) => {
                    if (frame.state) state = jsonClone(frame.state);
                    else Object.assign(state, jsonClone(frame.changes || {}));
                    return {round: item.round, register: item.register, frameIndex, duration: frame.duration, state: jsonClone(state)};
                });
            });
        }

        startHistoryPlayback() {
            if (!this.room.paused || (this.room.historyReview && this.room.historyReview.playing))
                return false;
            const selected = (this.room.historyReview && this.room.historyReview.selected) || this.historyEntries()[0];
            if (!selected)
                return false;
            const sequence = this.historyPlaybackSequence(selected.round, selected.register);
            if (!sequence.length)
                return false;
            this.stopHistoryPlayback(false);
            const generation = this.historyPlaybackGeneration;
            let cursor = 0;
            const advance = () => {
                if (generation !== this.historyPlaybackGeneration || !this.room.paused)
                    return;
                if (cursor >= sequence.length) {
                    this.historyPlaybackHandle = null;
                    this.room.historyReview.playing = false;
                    this.update();
                    return;
                }
                const frame = sequence[cursor++];
                this.historyViewFrame = jsonClone(frame.state);
                const review = this.room.historyReview || {};
                this.room.historyReview = {
                    selected: {round: frame.round, register: frame.register},
                    playing: true,
                    frameIndex: frame.frameIndex,
                    revision: (Number(review.revision) || 0) + 1
                };
                this.update();
                this.historyPlaybackHandle = setTimeout(advance, Math.max(0, frame.duration));
                if (this.historyPlaybackHandle.unref)
                    this.historyPlaybackHandle.unref();
            };
            advance();
            return true;
        }

        clearBoardEvents() {
            this.room.boardEvents = [];
        }

        addBoardEvent(type, robot, details = {}) {
            if (!robot)
                return null;
            const death = robot.death || {};
            const x = details.x == null ? (robot.x == null ? death.x : robot.x) : details.x;
            const y = details.y == null ? (robot.y == null ? death.y : robot.y) : details.y;
            if (!Number.isFinite(x) || !Number.isFinite(y))
                return null;
            const event = {
                id: ++this.boardEventCounter,
                type,
                userId: robot.userId,
                color: robot.color,
                ...details,
                x,
                y
            };
            this.room.boardEvents.push(event);
            return event;
        }

        randomizeStartAssignments(requireChange = false) {
            const users = this.room.playerSlots.filter(Boolean);
            const previous = this.room.startAssignments || {};
            let positions = users.map((unused, index) => index);
            let attempts = 0;
            do {
                positions = shuffle(positions);
                attempts += 1;
            } while (requireChange && users.length > 1 && attempts < 100
                && users.every((userId, index) => previous[userId] === positions[index]));
            this.room.startAssignments = Object.fromEntries(users.map((userId, index) => [userId, positions[index]]));
        }

        hasValidStartAssignments() {
            const users = this.room.playerSlots.filter(Boolean);
            const positions = users.map((userId) => (this.room.startAssignments || {})[userId]);
            return positions.every((position) => Number.isInteger(position) && position >= 0 && position < users.length)
                && new Set(positions).size === users.length;
        }

        createPlayer() {
            return {
                hand: [], selected: Array(5).fill(null), registers: [], lockedRegisters: [], locked: false,
                autoFilledRegisters: [],
                damage: 0, lives: this.room.gameOptions.startingLives,
                checkpoints: 0, poweredDown: false, powerDownIntent: false,
                powerDownNextRound: false, powerDownContinuation: null, powerDownDamage: 0,
                powerDownReentryChoiceRequired: false, finished: false
            };
        }

        joinPausedGame(userId) {
            if (!this.room.onlinePlayers.has(userId) || this.room.playerSlots.includes(userId)) return;
            if (this.room.raceExcludedPlayers.has(userId))
                return this.userRegistry.send(userId, "message", "Хост исключил вас из текущего заезда. Вы можете остаться зрителем.");
            const slot = this.room.playerSlots.indexOf(null);
            if (slot < 0) return this.userRegistry.send(userId, "message", "В игре уже заняты все восемь мест.");
            const startLayout = this.features;
            const usedStarts = new Set(this.room.playerSlots.filter(Boolean).map((id) => this.room.startAssignments[id]));
            const playerCount = this.room.playerSlots.filter(Boolean).length;
            const start = !usedStarts.has(playerCount) ? playerCount
                : startLayout.starts.findIndex((position, index) => position && !usedStarts.has(index));
            if (start < 0 || !startLayout.starts[start]) return;
            if (this.historyViewFrame) this.resetHistoryReview(false);
            const usedColors = new Set(this.room.playerSlots.filter(Boolean).map((id) => this.room.playerColors[id]));
            const color = ROBOT_COLORS.find((item) => !usedColors.has(item));
            this.room.playerSlots[slot] = userId;
            this.room.spectators.delete(userId);
            this.room.startAssignments[userId] = start;
            this.room.playerColors[userId] = color;
            this.room.robots.push({userId, slot: start, x: startLayout.starts[start].x,
                y: startLayout.starts[start].y, direction: "north", headingTurns: 0,
                color, eliminated: false, archive: {...startLayout.starts[start]}});
            this.players[userId] = this.createPlayer();
            if (this.room.phase === "programming") {
                this.deal(userId);
                this.cancelProgrammingTimer();
            } else {
                // The current register has already been dealt; join the next round.
                this.players[userId].locked = true;
            }
            this.addLog(`${this.playerName(userId)} вступил в заезд на стартовой клетке ${start + 1}.`);
            this.update();
        }

        leavePausedGame(userId) {
            const slot = this.room.playerSlots.indexOf(userId);
            if (slot < 0) return;
            if (this.historyViewFrame) this.resetHistoryReview(false);
            const robot = this.getRobot(userId);
            if (robot) robot.withdrawn = true; // Pending register actions may still hold this reference.
            this.room.robots = this.room.robots.filter((item) => item.userId !== userId);
            this.room.playerSlots[slot] = null;
            this.room.spectators.add(userId);
            this.room.finishOrder = this.room.finishOrder.filter((id) => id !== userId);
            delete this.room.startAssignments[userId];
            delete this.room.playerColors[userId];
            const player = this.players[userId];
            if (player) this.discardProgram(player);
            delete this.players[userId];
            this.powerDownChoiceUsers = (this.powerDownChoiceUsers || []).filter((id) => id !== userId);
            if (this.powerDownChoices) this.powerDownChoices.delete(userId);
            if (Array.isArray(this.room.reentryQueue))
                this.room.reentryQueue = this.room.reentryQueue.filter((id) => id !== userId);
            if (this.room.phase === "programming") this.cancelProgrammingTimer();
            this.addLog(`${this.playerName(userId)} перешёл в зрители.`);
            if (this.room.phase === "power-down-choice") return this.completePowerDownChoice();
            if (this.room.phase === "reentry" && this.room.reentryUserId === userId) {
                this.room.reentryUserId = this.room.reentryQueue[0] || null;
                if (!this.room.reentryUserId) {
                    this.room.reentryQueue = [];
                    return this.startRound();
                }
            }
            this.update();
        }

        update() {
            this.room.serverTime = Date.now();
            this.userRegistry.send(this.room.onlinePlayers, "state", this.publicState());
            this.room.onlinePlayers.forEach((userId) =>
                this.userRegistry.send(userId, "player-state", this.privateState(userId)));
        }

        updatePublicState() {
            this.update();
        }

        removePlayer(playerId) {
            const playerName = this.playerName(playerId);
            const slot = this.room.playerSlots.indexOf(playerId);
            if (slot >= 0) {
                if (playerId === this.room.hostId)
                    return this.userRegistry.send(this.room.hostId, "message", "Сначала передайте роль хоста другому участнику.");
                if (this.room.phase !== "lobby") this.room.raceExcludedPlayers.add(playerId);
                this.room.playerSlots[slot] = null;
                this.room.spectators.add(playerId);
                if (this.room.phase === "lobby") {
                    delete this.room.playerColors[playerId];
                    this.randomizeStartAssignments();
                    this.addLog(`${playerName} переведён хостом в зрители.`);
                } else {
                    const robot = this.getRobot(playerId);
                    if (robot) {
                        robot.eliminated = true;
                        robot.destroyed = false;
                        robot.withdrawn = true;
                        delete robot.death;
                    }
                    this.addLog(`${playerName} переведён хостом в зрители и больше не участвует в заезде.`);
                    this.powerDownChoiceUsers = (this.powerDownChoiceUsers || []).filter((id) => id !== playerId);
                    if (this.powerDownChoices) this.powerDownChoices.delete(playerId);
                    if (Array.isArray(this.room.reentryQueue))
                        this.room.reentryQueue = this.room.reentryQueue.filter((id) => id !== playerId);
                    const wasResolving = this.room.phase === "resolving";
                    if (this.checkLastRobotStanding()) {
                        this.cancelProgrammingTimer();
                        this.cancelAutoFillResolution();
                        if (!wasResolving)
                            this.addLog(`${this.playerName(this.room.winnerId)} остался единственным роботом с жизнями и победил!`);
                        return this.update();
                    }
                    if (this.room.phase === "power-down-choice")
                        return this.completePowerDownChoice();
                    if (this.room.phase === "reentry" && this.room.reentryUserId === playerId) {
                        this.room.reentryUserId = this.room.reentryQueue[0] || null;
                        if (this.room.reentryUserId) {
                            this.addLog(`${this.playerName(this.room.reentryUserId)} выбирает возрождение.`);
                            return this.update();
                        }
                        this.room.reentryQueue = [];
                        return this.startRound();
                    }
                    if (this.room.phase === "programming") {
                        this.cancelProgrammingTimer();
                        if (this.areAllProgramsLocked() && !this.room.paused) {
                            this.update();
                            this.resolveRound().catch((error) => {
                                this.addLog(`Ошибка разрешения хода: ${error.message}`);
                                this.room.phase = "programming";
                                this.update();
                            });
                            return;
                        }
                        this.maybeStartProgrammingTimer();
                    }
                }
            } else if (this.room.spectators.has(playerId)) {
                this.room.spectators.delete(playerId);
                delete this.room.playerNames[playerId];
                this.emit("user-kicked", playerId);
            }
            this.update();
        }

        getRobot(userId) {
            return this.room.robots.find((robot) => robot.userId === userId);
        }

        get features() {
            if (this.room.course.customFeatures) {
                if (this.cachedEditableCourse !== this.room.course) {
                    this.cachedEditableCourse = this.room.course;
                    this.cachedEditableFeatures = hydrateEditableFeatures(this.room.course.customFeatures);
                }
                return this.cachedEditableFeatures;
            }
            const board = this.room.course.board;
            const rotation = normalizeRotation(this.room.course.rotation);
            const key = `${board}:${rotation}`;
            this.orientedFeatureCache = this.orientedFeatureCache || new Map();
            if (!this.orientedFeatureCache.has(key))
                this.orientedFeatureCache.set(key, orientFeatures(BOARD_FEATURES[board] || EMPTY_FEATURES, rotation));
            return this.orientedFeatureCache.get(key);
        }

        boardKey(robot) {
            return positionKey(robot.x, robot.y);
        }

        turnRobot(robot, amount) {
            if (!robot || !amount) return;
            const currentTurns = Number.isFinite(robot.headingTurns) ? robot.headingTurns : DIRECTIONS.indexOf(robot.direction);
            robot.headingTurns = currentTurns + amount;
            robot.direction = rotate(robot.direction, amount);
        }

        conveyorAt(robot) {
            return robot ? this.features.conveyors[this.boardKey(robot)] : null;
        }

        isExpressAt(robot) {
            return this.features.express.has(this.boardKey(robot));
        }

        robotAt(x, y, excludedUserId) {
            return this.room.robots.find((robot) => !robot.eliminated && !robot.destroyed && !robot.withdrawn && robot.userId !== excludedUserId && robot.x === x && robot.y === y);
        }

        isInside(x, y) {
            return x >= 0 && y >= 0 && x < BOARD_SIZE && y < STAGE_ROWS;
        }

        cardById(player, id) {
            if (!id)
                return null;
            return [...player.hand, ...(player.registers || [])].filter(Boolean).find((card) => card.id === id) || null;
        }

        drawProgramCard() {
            if (!this.deck.length)
                this.deck.push(...shuffle(this.discard.splice(0)));
            if (!this.deck.length)
                this.deck.push(...shuffle(makeDeck()));
            return this.deck.shift();
        }

        lockedRegisterIndexes(damage) {
            const count = Math.min(5, Math.max(0, damage - 4));
            return Array.from({length: count}, (_, index) => 5 - count + index);
        }

        discardProgram(player) {
            this.discard.push(...player.hand.filter(Boolean), ...(player.registers || []).filter(Boolean));
            player.hand = [];
            player.registers = [];
            player.selected = Array(5).fill(null);
            player.lockedRegisters = [];
            player.autoFilledRegisters = [];
        }

        syncPoweredDownRegisters(player) {
            if (!player.poweredDown)
                return;
            const required = this.lockedRegisterIndexes(player.damage);
            const requiredSet = new Set(required);
            const registers = Array(5).fill(null);
            (player.registers || []).forEach((card, index) => {
                if (card && requiredSet.has(index)) registers[index] = card;
                else if (card) this.discard.push(card);
            });
            required.forEach((index) => {
                if (!registers[index]) registers[index] = this.drawProgramCard();
            });
            player.registers = registers;
            player.lockedRegisters = required;
            player.selected = registers.map((card) => card ? card.id : null);
        }

        deal(userId) {
            const player = this.players[userId];
            if (!player)
                return;
            // Five or more damage locks the last registers from the previous program.
            // The remaining cards are returned before the new hand is dealt.
            const lockedCount = Math.min(5, Math.max(0, player.damage - 4));
            const previousProgram = player.registers || [];
            const lockedCards = previousProgram.slice(5 - lockedCount).filter(Boolean);
            this.discard.push(...previousProgram.filter((card) => card && !lockedCards.includes(card)));
            player.registers = lockedCards;
            player.lockedRegisters = Array.from({length: lockedCards.length}, (_, index) => 5 - lockedCards.length + index);
            const cardsNeeded = Math.max(0, 9 - player.damage);
            if (this.deck.length < cardsNeeded)
                this.deck.push(...shuffle(this.discard.splice(0)));
            if (this.deck.length < cardsNeeded)
                this.deck.push(...shuffle(makeDeck()));
            player.hand = this.deck.splice(0, cardsNeeded);
            player.selected = Array(5).fill(null);
            lockedCards.forEach((card, index) => player.selected[5 - lockedCards.length + index] = card.id);
            player.locked = false;
            player.autoFilledRegisters = [];
        }

        startRound() {
            this.cancelProgrammingTimer();
            this.cancelAutoFillResolution();
            this.pruneTurnHistory();
            this.room.programmingAutoFill = null;
            this.room.phase = "programming";
            this.room.round += 1;
            this.room.activePowerDownMode = this.room.gameOptions.powerDownMode;
            this.room.register = null;
            this.room.revealedRegisters = 0;
            this.room.resolution = null;
            this.room.laserShots = [];
            this.room.stage = "Подготовка нового раунда";
            this.room.playerSlots.filter(Boolean).forEach((userId) => {
                const player = this.players[userId];
                player.checkpointAvailable = player.checkpoints + 1;
                player.powerDownIntent = false;
                player.powerDownContinuation = null;
                const robot = this.getRobot(userId);
                if (robot && (robot.eliminated || robot.withdrawn)) {
                    player.hand = [];
                    player.selected = Array(5).fill(null);
                    player.locked = true;
                    player.poweredDown = false;
                    player.powerDownNextRound = false;
                    player.powerDownReentryChoiceRequired = false;
                    return;
                }
                if (player.powerDownNextRound) {
                    this.discardProgram(player);
                    player.damage = 0;
                    player.powerDownDamage = 0;
                    player.poweredDown = true;
                    player.powerDownNextRound = false;
                    player.locked = true;
                    this.addLog(`${this.playerName(userId)} входит в Перезагрузка и снимает все повреждения.`);
                } else {
                    player.poweredDown = false;
                    player.powerDownNextRound = false;
                    player.powerDownDamage = 0;
                    this.deal(userId);
                }
            });
            this.addLog(`Раунд ${this.room.round}: выберите пять карт программы.`);
            this.maybeStartProgrammingTimer();
            this.update();
            if (!this.room.paused && this.areAllProgramsLocked())
                setTimeout(() => this.resolveRound().catch((error) => {
                    this.addLog(`Ошибка разрешения хода: ${error.message}`);
                    this.room.phase = "programming";
                    this.update();
                }), STEP_DELAY_MS);
        }

        startGame() {
            this.cancelProgrammingTimer();
            this.cancelAutoFillResolution();
            this.clearTurnHistory();
            this.room.raceExcludedPlayers.clear();
            this.room.paused = false;
            this.releasePauseWaiters();
            const users = this.room.playerSlots.filter(Boolean);
            if (users.length < 2)
                return;
            if (users.length < this.room.course.min || users.length > this.room.course.max)
                return this.userRegistry.send(this.room.hostId, "message", `Для курса «${this.room.course.name}» рекомендовано игроков: ${this.room.course.players}.`);
            this.room.phase = "programming";
            this.room.round = 0;
            this.room.winnerId = null;
            this.room.winnerReason = null;
            this.room.finishOrder = [];
            this.room.board = {name: this.room.course.board, size: BOARD_SIZE, start: this.room.course.start};
            this.room.flags = this.room.course.flags.map(([x, y], index) => ({x, y, number: index + 1}));
            const startLayout = this.features;
            if (!this.hasValidStartAssignments())
                this.randomizeStartAssignments();
            this.room.robots = users.map((userId) => {
                const slot = this.room.startAssignments[userId];
                return {
                userId,
                slot,
                x: startLayout.starts[slot].x,
                y: startLayout.starts[slot].y,
                direction: "north",
                headingTurns: 0,
                color: this.room.playerColors[userId] || ROBOT_COLORS[slot],
                eliminated: false,
                archive: {...startLayout.starts[slot]}
                };
            });
            users.forEach((userId) => {
                this.players[userId] = this.createPlayer();
            });
            this.deck = shuffle(makeDeck());
            this.discard = [];
            this.powerDownChoiceUsers = [];
            this.powerDownChoices = new Map();
            this.room.powerDownChoice = null;
            this.destructionCounter = 0;
            this.survivalVictoryBatchDepth = 0;
            this.survivalVictoryCheckPending = false;
            // Every firing phase must produce fresh React keys.  Without an
            // initialized counter `++undefined` became NaN, so subsequent
            // laser animations were re-used by the browser and stayed ended.
            this.laserEventCounter = 0;
            this.boardEventCounter = 0;
            this.room.boardEvents = [];
            this.room.programmingTimer = null;
            this.room.programmingAutoFill = null;
            this.addLog("Игра началась. Роботы получили программы.");
            this.startRound();
        }

        checkLastRobotStanding() {
            if (this.room.phase === "lobby" || this.room.phase === "finished" || this.room.robots.length < 2)
                return false;
            const remaining = this.room.robots.filter((robot) => {
                const player = this.players[robot.userId];
                return player && (player.lives === null || player.lives > 0) && !robot.eliminated;
            });
            if (remaining.length !== 1)
                return false;
            const winner = remaining[0];
            const everyOpponentEliminated = this.room.robots.every((robot) => robot.userId === winner.userId
                || robot.eliminated || !this.players[robot.userId]
                || (this.players[robot.userId].lives !== null && this.players[robot.userId].lives <= 0));
            if (!everyOpponentEliminated)
                return false;
            this.room.phase = "finished";
            this.room.winnerId = winner.userId;
            this.room.winnerReason = "last-robot-standing";
            return true;
        }

        checkFlagRaceComplete() {
            if (!this.room.gameOptions.finishAllFlags || this.room.phase === "lobby"
                || this.room.phase === "finished" || !this.room.finishOrder.length) return false;
            if (!this.room.playerSlots.filter(Boolean).every((id) =>
                this.players[id].finished || this.getRobot(id).eliminated)) return false;
            this.room.phase = "finished";
            this.room.winnerId = this.room.finishOrder[0];
            this.room.winnerReason = "flags";
            return true;
        }

        beginSurvivalVictoryBatch() {
            this.survivalVictoryBatchDepth = (this.survivalVictoryBatchDepth || 0) + 1;
        }

        endSurvivalVictoryBatch() {
            this.survivalVictoryBatchDepth = Math.max(0, (this.survivalVictoryBatchDepth || 0) - 1);
            if (!this.survivalVictoryBatchDepth && this.survivalVictoryCheckPending) {
                this.survivalVictoryCheckPending = false;
                return this.checkLastRobotStanding();
            }
            return false;
        }

        requestSurvivalVictoryCheck() {
            if (this.survivalVictoryBatchDepth) {
                this.survivalVictoryCheckPending = true;
                return false;
            }
            return this.checkLastRobotStanding();
        }

        reboot(robot, reason) {
            const player = this.players[robot.userId];
            const destructionId = ++this.destructionCounter;
            robot.death = {x: robot.x, y: robot.y, id: destructionId, reason};
            if (player.powerDownNextRound && !player.poweredDown)
                player.powerDownReentryChoiceRequired = true;
            if (player.lives !== null)
                player.lives -= 1;
            player.damage = 0;
            if (!player.poweredDown)
                player.powerDownDamage = 0;
            if (player.lives !== null && player.lives <= 0) {
                robot.eliminated = true;
                player.poweredDown = false;
                player.powerDownIntent = false;
                player.powerDownNextRound = false;
                player.powerDownReentryChoiceRequired = false;
                robot.x = null;
                robot.y = null;
                this.addLog(`${this.playerName(robot.userId)} потерял последнюю жизнь.`);
                this.requestSurvivalVictoryCheck();
                this.checkFlagRaceComplete();
                return;
            }
            robot.destroyed = true;
            robot.destroyedOrder = destructionId;
            robot.x = null;
            robot.y = null;
            this.addLog(`${this.playerName(robot.userId)} уничтожен (${reason}) и вернётся в конце раунда.`);
        }

        preparePowerDownChoice() {
            const users = this.room.playerSlots.filter((userId) => {
                const robot = userId && this.getRobot(userId);
                return robot && this.players[userId] && this.players[userId].poweredDown && !robot.eliminated && !robot.withdrawn;
            });
            if (!users.length)
                return false;
            this.powerDownChoiceUsers = users;
            this.powerDownChoices = new Map();
            this.room.phase = "power-down-choice";
            this.room.register = null;
            this.room.powerDownChoice = {answered: 0, total: users.length};
            this.room.stage = "Решение о продолжении Перезагрузка";
            this.update();
            return true;
        }

        choosePowerDownContinuation(userId, enabled) {
            if (this.room.phase !== "power-down-choice" || !(this.powerDownChoiceUsers || []).includes(userId)
                || this.powerDownChoices.has(userId))
                return;
            this.powerDownChoices.set(userId, enabled);
            return this.completePowerDownChoice();
        }

        completePowerDownChoice() {
            if (this.room.phase !== "power-down-choice") return false;
            this.room.powerDownChoice = {answered: this.powerDownChoices.size, total: this.powerDownChoiceUsers.length};
            if (this.powerDownChoices.size < this.powerDownChoiceUsers.length)
                return this.update();
            this.powerDownChoiceUsers.forEach((id) => {
                const staysDown = this.powerDownChoices.get(id);
                this.players[id].powerDownNextRound = staysDown;
                this.players[id].powerDownContinuation = staysDown;
            });
            this.powerDownChoiceUsers.forEach((id) => this.addLog(`${this.playerName(id)} ${this.powerDownChoices.get(id)
                ? "остаётся в Перезагрузка на следующий раунд."
                : "выходит из Перезагрузка в следующем раунде."}`));
            this.powerDownChoiceUsers = [];
            this.powerDownChoices = new Map();
            this.room.powerDownChoice = null;
            if (!this.prepareReentry())
                this.startRound();
            return true;
        }

        advanceToNextRound() {
            if (this.preparePowerDownChoice())
                return;
            if (this.prepareReentry())
                return;
            this.startRound();
        }

        prepareReentry() {
            const queue = this.room.robots.filter((robot) => robot.destroyed && !robot.eliminated)
                .sort((left, right) => (left.destroyedOrder || 0) - (right.destroyedOrder || 0))
                .map((robot) => robot.userId);
            if (!queue.length)
                return false;
            this.room.phase = "reentry";
            this.room.register = null;
            this.room.reentryQueue = queue;
            this.room.reentryUserId = queue[0];
            this.room.stage = "Выбор точки и направления возрождения";
            this.addLog(`${this.playerName(queue[0])} выбирает возрождение.`);
            this.update();
            return true;
        }

        reentryDirectionAllowed(x, y, direction) {
            const vector = VECTORS[direction];
            let currentX = x;
            let currentY = y;
            for (let distance = 1; distance <= 3; distance++) {
                if (this.wallBetween(currentX, currentY, direction))
                    return true;
                currentX += vector.x;
                currentY += vector.y;
                if (!this.isInside(currentX, currentY))
                    return true;
                if (this.robotAt(currentX, currentY))
                    return false;
            }
            return true;
        }

        reentryCandidates(userId) {
            const robot = this.getRobot(userId);
            if (!robot || !robot.destroyed || !robot.archive)
                return [];
            const archiveFree = !this.robotAt(robot.archive.x, robot.archive.y);
            const points = archiveFree ? [{...robot.archive, archive: true}]
                : [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => ({x: robot.archive.x + dx, y: robot.archive.y + dy})))
                    .filter((point) => point.x !== robot.archive.x || point.y !== robot.archive.y);
            return points.filter((point) => this.isInside(point.x, point.y) && !this.robotAt(point.x, point.y)
                    && !this.features.pits.has(positionKey(point.x, point.y)))
                .map((point) => ({...point, directions: point.archive ? [...DIRECTIONS]
                    : DIRECTIONS.filter((direction) => this.reentryDirectionAllowed(point.x, point.y, direction))}))
                .filter((point) => point.directions.length);
        }

        chooseReentry(userId, choice) {
            if (this.room.phase !== "reentry" || this.room.reentryUserId !== userId || !choice)
                return;
            const x = Number(choice.x);
            const y = Number(choice.y);
            const direction = String(choice.direction || "");
            const player = this.players[userId];
            if (player.powerDownReentryChoiceRequired && typeof choice.poweredDown !== "boolean")
                return;
            const candidate = this.reentryCandidates(userId).find((item) => item.x === x && item.y === y
                && item.directions.includes(direction));
            if (!candidate)
                return;
            const robot = this.getRobot(userId);
            robot.x = x;
            robot.y = y;
            robot.direction = direction;
            robot.headingTurns = DIRECTIONS.indexOf(direction);
            robot.destroyed = false;
            delete robot.destroyedOrder;
            delete robot.death;
            const powerDownDamage = player.powerDownDamage || 0;
            player.damage = 2 + powerDownDamage;
            player.powerDownDamage = 0;
            if (player.powerDownReentryChoiceRequired) {
                player.powerDownNextRound = choice.poweredDown;
                player.powerDownReentryChoiceRequired = false;
                this.addLog(`${this.playerName(userId)} возродится ${choice.poweredDown ? "в Перезагрузка" : "в обычном режиме"}.`);
            }
            if (player.poweredDown)
                this.syncPoweredDownRegisters(player);
            this.addLog(`${this.playerName(userId)} возрождается на клетке ${x + 1}, ${y + 1}.`);
            this.room.reentryQueue.shift();
            if (player.damage >= 10) {
                this.reboot(robot, "10 повреждений при возрождении");
                if (!robot.eliminated)
                    this.room.reentryQueue.push(userId);
            }
            if (this.room.phase === "finished") {
                this.room.reentryQueue = [];
                this.room.reentryUserId = null;
                this.addLog(`${this.playerName(this.room.winnerId)} остался единственным роботом с жизнями и победил!`);
                return this.update();
            }
            this.room.reentryUserId = this.room.reentryQueue[0] || null;
            if (this.room.reentryUserId) {
                this.addLog(`${this.playerName(this.room.reentryUserId)} выбирает возрождение.`);
                return this.update();
            }
            this.room.reentryQueue = [];
            this.startRound();
        }

        move(robot, direction, cause, visited = new Set()) {
            if (robot.eliminated || robot.destroyed || robot.withdrawn)
                return false;
            const signature = `${robot.userId}:${robot.x},${robot.y}:${direction}`;
            if (visited.has(signature))
                return false;
            visited.add(signature);
            if (this.wallBetween(robot.x, robot.y, direction))
                return false;
            const vector = VECTORS[direction];
            const target = {x: robot.x + vector.x, y: robot.y + vector.y};
            if (!this.isInside(target.x, target.y)) {
                if (cause === "толкатель" || cause === "толчок")
                    this.addBoardEvent(cause === "толкатель" ? "pusher" : "push", robot, {direction});
                this.reboot(robot, "падение с поля");
                return true;
            }
            const blockingRobot = this.robotAt(target.x, target.y, robot.userId);
            if (blockingRobot && !this.move(blockingRobot, direction, "толчок", visited))
                return false;
            robot.x = target.x;
            robot.y = target.y;
            if (cause === "толкатель" || cause === "толчок")
                this.addBoardEvent(cause === "толкатель" ? "pusher" : "push", robot, {direction});
            if (this.features.pits.has(this.boardKey(robot)))
                this.reboot(robot, "яма");
            return true;
        }

        wallBetween(x, y, direction) {
            const vector = VECTORS[direction];
            const opposite = rotate(direction, 2);
            const targetX = x + vector.x;
            const targetY = y + vector.y;
            const sourceWall = y >= 0 && y < STAGE_ROWS && this.features.walls.has(`${x},${y},${direction}`);
            const targetWall = targetY >= 0 && targetY < STAGE_ROWS
                && this.features.walls.has(`${targetX},${targetY},${opposite}`);
            return sourceWall || targetWall;
        }

        async showStage(stage, delay = STEP_DELAY_MS) {
            await this.waitWhilePaused();
            this.room.stage = stage;
            this.recordHistoryFrame(delay);
            this.update();
            await wait(delay);
            await this.waitWhilePaused();
            this.clearBoardEvents();
        }

        async executeCard(robot, card) {
            if (robot.eliminated || robot.destroyed || robot.withdrawn)
                return;
            if (card.type === "left") this.turnRobot(robot, -1);
            if (card.type === "right") this.turnRobot(robot, 1);
            if (card.type === "uturn") this.turnRobot(robot, 2);
            if (["left", "right", "uturn"].includes(card.type)) {
                await this.showStage(`${this.playerName(robot.userId)}: ${card.label}`);
                return;
            }
            const steps = card.type === "move3" ? 3 : card.type === "move2" ? 2 : 1;
            const direction = card.type === "backup" ? rotate(robot.direction, 2) : robot.direction;
            for (let step = 0; step < steps && !robot.destroyed; step++) {
                if (!this.move(robot, direction, card.label)) break;
                await this.showStage(`${this.playerName(robot.userId)}: ${card.label} · шаг ${step + 1}/${steps}`);
            }
        }

        damageRobot(robot, amount, source) {
            if (!robot || robot.eliminated || robot.destroyed || robot.withdrawn)
                return;
            const player = this.players[robot.userId];
            player.damage += amount;
            if (player.poweredDown) {
                player.powerDownDamage = (player.powerDownDamage || 0) + amount;
                const previouslyLocked = new Set(player.lockedRegisters || []);
                this.syncPoweredDownRegisters(player);
                const added = player.lockedRegisters.filter((register) => !previouslyLocked.has(register));
                if (added.length)
                    this.addLog(`${this.playerName(robot.userId)} получает случайные карты в заблокированные регистры ${added.map((index) => index + 1).join(", ")}.`);
            }
            this.addLog(`${this.playerName(robot.userId)} получает ${amount} урон (${source}).`);
            if (player.damage >= 10)
                this.reboot(robot, "10 повреждений");
        }

        fireLaser(x, y, direction, source, includeOrigin = false) {
            const robot = this.traceLaser(x, y, direction, includeOrigin).target;
            if (robot)
                this.damageRobot(robot, 1, source);
        }

        laserTarget(x, y, direction, includeOrigin = false) {
            return this.traceLaser(x, y, direction, includeOrigin).target;
        }

        traceLaser(x, y, direction, includeOrigin = false) {
            const vector = VECTORS[direction];
            const start = includeOrigin
                ? {x: x + .5 - vector.x * .5, y: y + .5 - vector.y * .5}
                : {x: x + .5, y: y + .5};
            let cellX = includeOrigin ? x : x + vector.x;
            let cellY = includeOrigin ? y : y + vector.y;
            let end = {...start};
            if (!includeOrigin && this.wallBetween(x, y, direction)) {
                end = {x: x + .5 + vector.x * .5, y: y + .5 + vector.y * .5};
                return {start, end, target: null};
            }
            while (this.isInside(cellX, cellY)) {
                end = {x: cellX + .5, y: cellY + .5};
                const robot = this.robotAt(cellX, cellY);
                if (robot)
                    return {start, end, target: robot};
                if (this.wallBetween(cellX, cellY, direction)) {
                    end = {x: cellX + .5 + vector.x * .5, y: cellY + .5 + vector.y * .5};
                    return {start, end, target: null};
                }
                const nextX = cellX + vector.x;
                const nextY = cellY + vector.y;
                if (!this.isInside(nextX, nextY)) {
                    end = {x: cellX + .5 + vector.x * .5, y: cellY + .5 + vector.y * .5};
                    return {start, end, target: null};
                }
                cellX = nextX;
                cellY = nextY;
            }
            return {start, end, target: null};
        }

        moveConveyors(expressOnly) {
            this.clearBoardEvents();
            const candidates = this.room.robots.filter((robot) => !robot.eliminated && !robot.destroyed && !robot.withdrawn)
                .map((robot) => ({robot, source: this.boardKey(robot), direction: this.conveyorAt(robot)}))
                .filter((item) => item.direction && (!expressOnly || this.isExpressAt(item.robot)))
                .map((item) => {
                    const vector = VECTORS[item.direction];
                    return {...item, from: positionKey(item.robot.x, item.robot.y),
                        target: {x: item.robot.x + vector.x, y: item.robot.y + vector.y}};
                });
            const unobstructed = candidates.filter(({robot, direction}) => !this.wallBetween(robot.x, robot.y, direction));
            const targetCounts = new Map();
            unobstructed.forEach(({target}) => targetCounts.set(positionKey(target.x, target.y), (targetCounts.get(positionKey(target.x, target.y)) || 0) + 1));
            let allowed = unobstructed.filter(({target}) => targetCounts.get(positionKey(target.x, target.y)) === 1);
            let changed = true;
            while (changed) {
                changed = false;
                const movingIds = new Set(allowed.map(({robot}) => robot.userId));
                const filtered = allowed.filter(({robot, target}) => {
                    const occupant = this.robotAt(target.x, target.y, robot.userId);
                    return !occupant || movingIds.has(occupant.userId);
                });
                if (filtered.length !== allowed.length) {
                    allowed = filtered;
                    changed = true;
                }
            }
            this.beginSurvivalVictoryBatch();
            try {
                allowed.forEach((item) => {
                    const {robot, target, direction} = item;
                    if (!this.isInside(target.x, target.y)) {
                        this.addBoardEvent("conveyor", robot, {direction, express: !!expressOnly});
                        return this.reboot(robot, "конвейер вынес за край");
                    }
                    robot.x = target.x;
                    robot.y = target.y;
                });
                allowed.forEach(({robot, direction, from}) => {
                    if (robot.destroyed) return;
                    const destinationDirection = this.conveyorAt(robot);
                    const links=this.features.conveyorConnections;
                    const connected=links==null
                        || (links instanceof Set ? links.has(`${from}|${this.boardKey(robot)}`)
                            : links.includes(`${from}|${this.boardKey(robot)}`));
                    const turn=connected ? conveyorArrivalTurn(direction,destinationDirection) : 0;
                    if (turn) this.turnRobot(robot, turn);
                    this.addBoardEvent("conveyor", robot, {direction, turn: turn || 0, express: !!expressOnly});
                    if (this.features.pits.has(this.boardKey(robot))) this.reboot(robot, "конвейер переместил в яму");
                });
            } finally {
                this.endSurvivalVictoryBatch();
            }
        }

        setRobotArchive(robot) {
            robot.archive = {x: robot.x, y: robot.y};
        }

        activatePushers() {
            this.clearBoardEvents();
            this.beginSurvivalVictoryBatch();
            try {
                this.features.pushers.filter((pusher) => !pusher.active || pusher.active.includes(this.room.register))
                    .forEach((pusher) => {
                        const robot = this.robotAt(pusher.x, pusher.y);
                        if (robot) this.move(robot, pusher.direction, "толкатель");
                    });
            } finally {
                this.endSurvivalVictoryBatch();
            }
        }

        activateGears() {
            this.clearBoardEvents();
            this.room.robots.forEach((robot) => {
                if (robot.eliminated || robot.destroyed || robot.withdrawn)
                    return;
                const gear = this.features.gears[this.boardKey(robot)];
                if (gear) {
                    this.turnRobot(robot, gear);
                    this.addBoardEvent("gear", robot, {turn: gear});
                }
            });
        }

        fireAllLasers() {
            // Determine every target first: laser fire is simultaneous, so a
            // robot destroyed by one beam still blocks the others this phase.
            const hits = new Map();
            const shots = [];
            const addShot = (trace, emitter, amount = 1, sourceUserId = null) => {
                this.laserEventCounter = (this.laserEventCounter || 0) + 1;
                const shot = {id: this.laserEventCounter, source: sourceUserId ? "robot" : "board", sourceUserId, direction: emitter.direction,
                    sourceColor: emitter.color || null, sourceName: sourceUserId ? this.playerName(sourceUserId) : null,
                    start: trace.start, end: trace.end, count: amount,
                    targetUserId: trace.target ? trace.target.userId : null};
                shots.push(shot);
                if (trace.target)
                    hits.set(trace.target, (hits.get(trace.target) || 0) + amount);
            };
            this.features.lasers.forEach((laser) => {
                addShot(this.traceLaser(laser.x, laser.y, laser.direction, true), laser, laser.count || 1);
            });
            this.room.robots.forEach((robot) => {
                const player = this.players[robot.userId];
                if (!robot.eliminated && !robot.destroyed && !robot.withdrawn && player && !player.poweredDown)
                    addShot(this.traceLaser(robot.x, robot.y, robot.direction), robot,
                        1, robot.userId);
            });
            this.room.laserShots = shots;
            // Keep every firing robot on the board while the simultaneous
            // beams are visible. Applying damage before the client update
            // made a destroyed shooter's legal beam look like a phantom.
            return [...hits.entries()].map(([robot, amount]) => ({userId: robot.userId, amount}));
        }

        applyLaserHits(hits) {
            this.beginSurvivalVictoryBatch();
            try {
                (hits || []).forEach(({userId, amount}) =>
                    this.damageRobot(this.getRobot(userId), amount, "лазеры"));
            } finally {
                this.endSurvivalVictoryBatch();
            }
        }

        touchCheckpoints() {
            this.clearBoardEvents();
            this.room.robots.forEach((robot) => {
                if (robot.eliminated || robot.destroyed || robot.withdrawn)
                    return;
                const player = this.players[robot.userId];
                const flag = this.room.flags.find((item) => item.x === robot.x && item.y === robot.y);
                const previousArchive = robot.archive && `${robot.archive.x},${robot.archive.y}`;
                if (flag) {
                    this.setRobotArchive(robot);
                    if (flag.number === player.checkpointAvailable) {
                        player.checkpoints += 1;
                        player.checkpointAvailable = null;
                        this.addBoardEvent("flag", robot, {flagNumber: flag.number});
                        this.addLog(`${this.playerName(robot.userId)} активирует флаг ${flag.number}.`);
                        if (player.checkpoints === this.room.flags.length) {
                            this.room.finishOrder.push(robot.userId);
                            player.finished = true;
                            if (this.room.gameOptions.finishAllFlags) {
                                robot.withdrawn = true;
                                robot.x = null;
                                robot.y = null;
                                player.locked = true;
                                this.addLog(`${this.playerName(robot.userId)} собрал все флаги и завершил свой заезд.`);
                            } else {
                                this.room.phase = "finished";
                                this.room.winnerId = robot.userId;
                                this.room.winnerReason = "flags";
                            }
                        }
                    } else if (previousArchive !== `${robot.x},${robot.y}`) {
                        this.addBoardEvent("archive", robot, {onFlag: true});
                    }
                }
                if (!flag && this.features.repairs.has(this.boardKey(robot))) {
                    this.setRobotArchive(robot);
                    if (previousArchive !== `${robot.x},${robot.y}`)
                        this.addBoardEvent("archive", robot);
                }
            });
            this.checkFlagRaceComplete();
        }

        cleanupRound() {
            // Wrenches repair only after register 5, not after every register.
            this.clearBoardEvents();
            let repaired = 0;
            this.room.robots.forEach((robot) => {
                if (robot.eliminated || robot.destroyed || robot.withdrawn)
                    return;
                const onFlag = this.room.flags.some((flag) => flag.x === robot.x && flag.y === robot.y);
                if (this.features.repairs.has(this.boardKey(robot)) || onFlag) {
                    const player = this.players[robot.userId];
                    const previousDamage = player.damage;
                    player.damage = Math.max(0, previousDamage - 1);
                    this.syncPoweredDownRegisters(player);
                    this.setRobotArchive(robot);
                    this.addLog(`${this.playerName(robot.userId)} обслуживает робота на ремонтной клетке.`);
                    if (player.damage < previousDamage) {
                        repaired += 1;
                        this.addBoardEvent("heal", robot, {amount: previousDamage - player.damage});
                    }
                }
            });
            return repaired;
        }

        confirmPowerDownIntents(userIds) {
            if (this.room.activePowerDownMode === "simple") {
                userIds.filter((userId) => this.players[userId].powerDownIntent).forEach((userId) => {
                    const player = this.players[userId];
                    this.discardProgram(player);
                    player.damage = 0;
                    player.powerDownDamage = 0;
                    player.poweredDown = true;
                    player.powerDownNextRound = false;
                    player.locked = true;
                    this.addLog(`${this.playerName(userId)} входит в Перезагрузка в текущем раунде и снимает все повреждения.`);
                });
                return;
            }
            userIds.forEach((userId) => {
                const player = this.players[userId];
                player.powerDownNextRound = !!player.powerDownIntent;
            });
            userIds.filter((userId) => this.players[userId].powerDownNextRound).forEach((userId) => {
                this.addLog(`${this.playerName(userId)} объявляет Перезагрузка на следующий раунд.`);
            });
        }

        async resolveRound() {
            if (this.room.phase !== "programming")
                return;
            this.cancelProgrammingTimer();
            this.cancelAutoFillResolution();
            this.room.programmingAutoFill = null;
            this.room.phase = "resolving";
            this.room.revealedRegisters = 0;
            const resolutionId = (this.resolutionId || 0) + 1;
            this.resolutionId = resolutionId;
            const activeUsers = this.room.playerSlots.filter(Boolean);
            const participants = new Map(activeUsers.map((userId) => [userId, this.players[userId]]));
            this.confirmPowerDownIntents(activeUsers);
            this.room.resolution = [];
            for (let register = 0; register < 5 && this.room.phase === "resolving" && this.resolutionId === resolutionId; register++) {
                this.room.register = register + 1;
                this.room.revealedRegisters = register + 1;
                this.beginHistoryRegister(register + 1);
                await this.showStage(`Регистр ${register + 1}: карты открыты`, 500);
                const actions = activeUsers.filter((userId) => this.room.playerSlots.includes(userId)
                    && this.players[userId] === participants.get(userId)).map((userId) => ({
                    userId,
                    player: this.players[userId],
                    robot: this.getRobot(userId),
                    card: this.cardById(this.players[userId], this.players[userId].selected[register])
                })).filter((item) => item.robot && item.card && !item.player.poweredDown
                    && !item.robot.eliminated && !item.robot.destroyed && !item.robot.withdrawn)
                    .sort((left, right) => right.card.priority - left.card.priority);
                for (const {robot, card} of actions) {
                    await this.executeCard(robot, card);
                    this.room.resolution.push({register: register + 1, userId: robot.userId, card: card.label});
                    if (this.room.phase === "finished") break;
                }
                if (this.room.phase === "finished") break;
                this.moveConveyors(true);
                await this.showStage(`Регистр ${register + 1}: экспресс-конвейеры`);
                if (this.room.phase === "finished") break;
                this.moveConveyors(false);
                await this.showStage(`Регистр ${register + 1}: все конвейеры`);
                if (this.room.phase === "finished") break;
                this.activatePushers();
                await this.showStage(`Регистр ${register + 1}: толкатели`);
                if (this.room.phase === "finished") break;
                this.activateGears();
                await this.showStage(`Регистр ${register + 1}: шестерни`);
                const laserHits = this.fireAllLasers();
                await this.showStage(`Регистр ${register + 1}: лазеры`, Math.max(STEP_DELAY_MS, 850));
                this.room.laserShots = [];
                this.applyLaserHits(laserHits);
                await this.showStage(`Регистр ${register + 1}: попадания лазеров`, STEP_DELAY_MS);
                if (this.room.phase === "finished") break;
                this.touchCheckpoints();
                await this.showStage(`Регистр ${register + 1}: флаги и архивы`);
                this.completeHistoryRegister();
            }
            if (this.resolutionId !== resolutionId || this.room.phase === "lobby")
                return;
            if (this.room.phase !== "finished") {
                const repaired = this.cleanupRound();
                if (repaired)
                    await this.showStage("Конец раунда: ремонт", Math.max(STEP_DELAY_MS, 700));
            }
            this.finishHistoryRound();
            activeUsers.forEach((userId) => {
                const player = this.players[userId];
                if (!this.room.playerSlots.includes(userId) || player !== participants.get(userId)) return;
                if (player.poweredDown) {
                    player.hand = [];
                    player.locked = true;
                    return;
                }
                let program = player.selected.map((id) => this.cardById(player, id));
                this.discard.push(...player.hand.filter((card) => !program.includes(card)));
                player.registers = program;
                player.hand = [];
                player.selected = Array(5).fill(null);
                player.lockedRegisters = [];
                player.locked = false;
            });
            if (this.room.phase === "finished") {
                this.addLog(this.room.winnerReason === "last-robot-standing"
                    ? `${this.playerName(this.room.winnerId)} остался единственным роботом с жизнями и победил!`
                    : `${this.playerName(this.room.winnerId)} собрал все флаги и победил!`);
                this.update();
            } else {
                this.addLog("Регистр 5 завершён. Начинается следующий раунд.");
                this.advanceToNextRound();
            }
        }

        areAllProgramsLocked() {
            return this.room.playerSlots.filter(Boolean).every((userId) => this.players[userId] && this.players[userId].locked);
        }

        waitWhilePaused() {
            if (!this.room.paused)
                return Promise.resolve();
            return new Promise((resolve) => this.pauseWaiters.push(resolve));
        }

        releasePauseWaiters() {
            const waiters = this.pauseWaiters.splice(0);
            waiters.forEach((resolve) => resolve());
        }

        setPaused(paused) {
            const next = !!paused;
            if (this.room.paused === next)
                return false;
            this.room.paused = next;
            const timer = this.room.programmingTimer;
            if (next) {
                if (timer && !timer.paused) {
                    timer.pausedRemainingMs = Math.max(0, timer.endsAt - Date.now());
                    timer.remaining = Math.max(0, Math.ceil(timer.pausedRemainingMs / 1000));
                    timer.paused = true;
                }
                if (this.programmingTimerHandle) {
                    clearInterval(this.programmingTimerHandle);
                    this.programmingTimerHandle = null;
                }
            } else {
                this.resetHistoryReview(false);
                if (timer && timer.paused) {
                    timer.endsAt = Date.now() + Math.max(0, timer.pausedRemainingMs || 0);
                    timer.paused = false;
                    delete timer.pausedRemainingMs;
                    this.scheduleProgrammingTimer(this.programmingTimerGeneration);
                }
                if (this.room.phase === "programming")
                    this.maybeStartProgrammingTimer();
                this.releasePauseWaiters();
                if (this.room.phase === "programming" && this.areAllProgramsLocked())
                    this.resolveRound().catch((error) => this.registry.log(`roborace resolve: ${error.stack}`));
            }
            return true;
        }

        cancelProgrammingTimer() {
            if (this.programmingTimerHandle) {
                clearInterval(this.programmingTimerHandle);
                this.programmingTimerHandle = null;
            }
            this.programmingTimerGeneration = (this.programmingTimerGeneration || 0) + 1;
            if (this.room)
                this.room.programmingTimer = null;
        }

        scheduleProgrammingTimer(generation) {
            if (this.programmingTimerHandle)
                clearInterval(this.programmingTimerHandle);
            this.programmingTimerHandle = setInterval(() => {
                const timer = this.room.programmingTimer;
                const players = this.room.playerSlots.filter((userId) => userId && this.players[userId]);
                const stillPending = players.filter((userId) => !this.players[userId].locked);
                if (generation !== this.programmingTimerGeneration || this.room.phase !== "programming"
                    || !timer || timer.paused || !stillPending.length || this.players[timer.userId]?.locked) {
                    if (generation === this.programmingTimerGeneration && (!timer || !timer.paused))
                        this.cancelProgrammingTimer();
                    return;
                }
                const remaining = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
                if (remaining <= 0)
                    return this.expireProgrammingTimer(timer.userId, generation);
                if (remaining !== timer.remaining) {
                    timer.remaining = remaining;
                    this.update();
                }
            }, 200);
            if (this.programmingTimerHandle.unref)
                this.programmingTimerHandle.unref();
        }

        cancelAutoFillResolution() {
            if (this.autoFillResolveHandle) {
                clearTimeout(this.autoFillResolveHandle);
                this.autoFillResolveHandle = null;
            }
        }

        maybeStartProgrammingTimer() {
            if (this.room.phase !== "programming" || this.room.paused)
                return false;
            const players = this.room.playerSlots.filter((userId) => userId && this.players[userId]
                && !this.getRobot(userId)?.eliminated && !this.getRobot(userId)?.withdrawn);
            const pending = players.filter((userId) => !this.players[userId].locked);
            const lastPlayerSeconds = this.room.gameOptions.lastPlayerSeconds;
            if (this.room.programmingTimer) return false;
            if (players.length < 2 || pending.length !== 1 || lastPlayerSeconds === null)
                return false;
            const seconds = lastPlayerSeconds;
            const userIds = [pending[0]];
            const generation = ++this.programmingTimerGeneration;
            const endsAt = Date.now() + seconds * 1000;
            this.room.programmingTimer = {userId: userIds[0], userIds: [...userIds], endsAt, remaining: seconds};
            this.addLog(`${this.playerName(userIds[0])} остаётся последним: запущен таймер программирования на ${seconds} секунд.`);
            this.scheduleProgrammingTimer(generation);
            return true;
        }

        expireProgrammingTimer(userId, generation = this.programmingTimerGeneration) {
            const timer = this.room.programmingTimer;
            if (this.room.phase !== "programming" || !timer || generation !== this.programmingTimerGeneration)
                return false;
            const userIds = [userId].filter((id) => id && this.players[id] && !this.players[id].locked);
            if (!userIds.length || timer.userId !== userId) return false;
            this.cancelProgrammingTimer();
            const fills = userIds.map((id) => {
                const player = this.players[id];
                if (this.room.activePowerDownMode === "simple" && player.powerDownIntent) {
                    player.locked = true;
                    player.autoFilledRegisters = [];
                    this.addLog(`Время ${this.playerName(id)} истекло: Перезагрузка автоматически подтверждён.`);
                    return {userId: id, registers: [], powerDown: true};
                }
                const selected = new Set(player.selected.filter(Boolean));
                const available = shuffle(player.hand.filter((card) => !selected.has(card.id))).map((card) => card.id);
                const registers = [];
                player.selected = player.selected.map((cardId, register) => {
                    if (cardId || player.lockedRegisters.includes(register)) return cardId;
                    const randomCard = available.shift() || null;
                    if (randomCard) registers.push(register);
                    return randomCard;
                });
                player.autoFilledRegisters = registers;
                player.locked = true;
                if (registers.length)
                    this.addLog(`Время ${this.playerName(id)} истекло: пустые регистры заполнены случайными картами с руки.`);
                else
                    this.addLog(`Время ${this.playerName(id)} истекло: готовая программа автоматически зафиксирована.`);
                return {userId: id, registers};
            });
            const first = fills[0];
            this.room.programmingAutoFill = {userId: first.userId, userIds: [...userIds], registers: [...first.registers],
                fills, count: fills.reduce((sum, fill) => sum + fill.registers.length, 0)};
            this.update();
            this.autoFillResolveHandle = setTimeout(() => {
                this.autoFillResolveHandle = null;
                if (this.room.phase !== "programming" || !this.areAllProgramsLocked()) return;
                this.resolveRound().catch((error) => {
                    this.addLog(`Ошибка разрешения хода: ${error.message}`);
                    this.room.phase = "programming";
                    this.update();
                });
            }, AUTO_FILL_DISPLAY_MS);
            if (this.autoFillResolveHandle.unref)
                this.autoFillResolveHandle.unref();
            return true;
        }

        getPlayerCount() {
            return Object.keys(this.room.playerNames).length;
        }

        getActivePlayerCount() {
            return this.room.onlinePlayers.size;
        }

        getLastInteraction() {
            return this.lastInteraction || new Date(this.room.createTime);
        }

        getSnapshot() {
            return {
                format: "roborace-room", version: 1,
                room: {...this.room, onlinePlayers: [], spectators: [...this.room.spectators]},
                players: this.players,
                deck: this.deck,
                discard: this.discard,
                turnHistory: this.turnHistory
            };
        }

        setSnapshot(snapshot) {
            if (snapshot.format !== "roborace-room" || snapshot.version !== 1) throw new Error("Unsupported room snapshot");
            Object.assign(this.room, snapshot.room);
            // Catalog metadata belongs to this build, not to the saved lobby.
            Object.assign(this.room, {courses:COURSE_CARDS,startCards:START_CARDS,
                boardImages:BOARD_IMAGES,boardThumbnails:BOARD_THUMBNAILS});
            delete this.room.boardCards;
            delete this.room.startImages;
            const retiredField=!this.room.course.customFeatures&&!Object.hasOwn(BOARD_FEATURES,this.room.course.board);
            if(retiredField){
                Object.assign(this.room,{phase:"lobby",paused:false,robots:[],winnerId:null,winnerReason:null,finishOrder:[],resolution:null,
                    laserShots:[],boardEvents:[],programmingTimer:null,programmingAutoFill:null,powerDownChoice:null});
                this.room.log=[...(this.room.log||[]).slice(-10),"Каталог полей обновлён. Выберите новое поле и маршрут в лобби."];
            }
            if(this.room.phase === "lobby" && !this.room.course.customFeatures){
                const course=COURSE_CARDS.find(item=>item.id===this.room.course.id)
                    ||(!retiredField&&this.room.course.id==="custom"?this.room.course:COURSE_CARDS[0]);
                this.room.course={...course};
                this.room.board={name:course.board,size:BOARD_SIZE,start:course.start};
                this.room.flags=course.flags.map(([x,y],index)=>({x,y,number:index+1}));
            }
            this.room.gameOptions = normalizeGameOptions(this.room.gameOptions);
            this.room.finishOrder = Array.isArray(this.room.finishOrder) ? this.room.finishOrder : [];
            this.room.activePowerDownMode = ["classic", "simple"].includes(this.room.activePowerDownMode)
                ? this.room.activePowerDownMode : this.room.gameOptions.powerDownMode;
            this.room.onlinePlayers = new JSONSet();
            this.room.spectators = new JSONSet(snapshot.room.spectators || []);
            this.room.raceExcludedPlayers = new JSONSet(snapshot.room.raceExcludedPlayers || []);
            if(retiredField)this.room.raceExcludedPlayers.clear();
            this.players = retiredField?{}:snapshot.players || {};
            this.deck = retiredField?[]:snapshot.deck || [];
            this.discard = retiredField?[]:snapshot.discard || [];
            this.turnHistory = !retiredField&&Array.isArray(snapshot.turnHistory) ? jsonClone(snapshot.turnHistory) : [];
            this.historyRecordingRegister = null;
            this.historyRecordingState = null;
            this.historyPlaybackHandle = null;
            this.historyPlaybackGeneration = 0;
            this.pruneTurnHistory();
            const savedReview = this.room.historyReview || {};
            this.room.historyReview = {
                selected: savedReview.selected || null,
                playing: false,
                frameIndex: Number.isInteger(savedReview.frameIndex) ? savedReview.frameIndex : null,
                revision: Number(savedReview.revision) || 0
            };
            const selected = this.room.paused && this.room.historyReview.selected;
            const entry = selected && this.historyRegister(Number(selected.round), Number(selected.register));
            this.historyViewFrame = entry ? this.reconstructHistoryFrame(entry, this.room.historyReview.frameIndex || 0) : null;
            if (!this.historyViewFrame) {
                this.room.historyReview.selected = null;
                this.room.historyReview.frameIndex = null;
            }
        }

        userJoin(data) {
            this.lastInteraction = new Date();
            const userId = data.userId;
            this.room.onlinePlayers.add(userId);
            if (!this.room.playerSlots.includes(userId))
                this.room.spectators.add(userId);
            this.room.playerNames[userId] = String(this.room.playerNames[userId] || data.userName || "Гость").trim().slice(0, 60) || "Гость";
            this.update();
        }

        userLeft(userId) {
            this.room.onlinePlayers.delete(userId);
            if (this.room.spectators.has(userId)) {
                this.room.spectators.delete(userId);
                delete this.room.playerNames[userId];
            }
            this.update();
        }

        selectCourse(course) {
            this.room.course = {...course, start: course.start || START_CARDS[0]};
            this.room.board = {name: course.board, size: BOARD_SIZE, start: this.room.course.start};
            this.room.flags = course.flags.map(([x, y], index) => ({x, y, number: index + 1}));
            this.addLog(`Выбран курс «${course.name}».`);
            this.update();
        }

        userEvent(userId, event, args) {
            this.lastInteraction = new Date();
            // Common engine events: chat, auth, profile, avatars, change-name
            if (this.eventHandlers && this.eventHandlers[event]) {
                Promise.resolve(this.eventHandlers[event](userId, ...args))
                    .catch((error) => this.registry.log(`roborace ${event}: ${error.stack}`));
                return;
            }
            const value = args[0];
            if (event === "set-game-option" && userId === this.room.hostId && value && typeof value === "object") {
                const {key, setting} = value;
                if (!validGameOption(key, setting) || this.room.gameOptions[key] === setting) return;
                this.room.gameOptions[key] = setting;
                if (key === "startingLives" && this.room.phase !== "lobby") {
                    Object.entries(this.players).forEach(([id, player]) => {
                        if (setting === null || player.lives === null || player.lives > setting) player.lives = setting;
                        const robot = this.getRobot(id);
                        if (setting === null && robot?.eliminated && this.room.phase !== "finished") {
                            robot.eliminated = false;
                            robot.destroyed = true;
                            robot.destroyedOrder = ++this.destructionCounter;
                            player.locked = true;
                            player.damage = 0;
                            if (this.room.phase === "reentry" && !this.room.reentryQueue.includes(id))
                                this.room.reentryQueue.push(id);
                        }
                    });
                }
                if (key === "lastPlayerSeconds" && this.room.phase === "programming") {
                    if (this.room.programmingTimer)
                        this.cancelProgrammingTimer();
                    if (!this.room.paused) this.maybeStartProgrammingTimer();
                }
                if (key === "finishAllFlags" && !setting && this.room.finishOrder.length && this.room.phase !== "finished") {
                    this.room.phase = "finished";
                    this.room.winnerId = this.room.finishOrder[0];
                    this.room.winnerReason = "flags";
                }
                if (this.room.phase === "finished") {
                    this.cancelProgrammingTimer();
                    this.cancelAutoFillResolution();
                    if (this.room.paused) this.setPaused(false);
                }
                this.addLog(`Хост изменил настройку игры: ${key === "startingLives" ? "жизни" : key === "lastPlayerSeconds" ? "таймер последнего игрока" : key === "finishAllFlags" ? "доигрывание флагов" : "Перезагрузка"}.`);
                return this.update();
            }
            if (event === "set-player-lives" && userId === this.room.hostId && this.room.phase !== "lobby"
                && this.room.phase !== "finished" && value && typeof value === "object") {
                const targetId = value.userId;
                const lives = value.lives;
                if (this.room.gameOptions.startingLives === null || !this.room.playerSlots.includes(targetId)
                    || !this.players[targetId] || !this.getRobot(targetId)
                    || !(lives === null || (Number.isSafeInteger(lives) && lives > 0))) return;
                const player = this.players[targetId];
                const robot = this.getRobot(targetId);
                if (player.lives === lives) return;
                const wasEliminated = !!robot.eliminated;
                player.lives = lives;
                if (wasEliminated) {
                    robot.eliminated = false;
                    robot.destroyed = true;
                    robot.destroyedOrder = ++this.destructionCounter;
                    player.locked = true;
                    player.damage = 0;
                    player.powerDownDamage = 0;
                    this.addLog(`${this.playerName(targetId)} получил жизни от хоста и вернётся перед следующим раундом.`);
                    if (this.room.phase === "reentry" && !this.room.reentryQueue.includes(targetId))
                        this.room.reentryQueue.push(targetId);
                } else {
                    this.addLog(`Хост установил число жизней ${this.playerName(targetId)}: ${lives === null ? "∞" : lives}.`);
                }
                if (this.room.phase === "programming" && this.areAllProgramsLocked())
                    this.resolveRound().catch((error) => this.registry.log(`roborace resolve: ${error.stack}`));
                if (this.room.phase === "finished") {
                    this.cancelProgrammingTimer();
                    this.cancelAutoFillResolution();
                    if (this.room.paused) this.setPaused(false);
                }
                return this.update();
            }
            if (event === "remove-player" && userId === this.room.hostId && typeof value === "string")
                return this.removePlayer(value);
            if (event === "give-host" && userId === this.room.hostId && typeof value === "string") {
                if (!this.room.onlinePlayers.has(value)) return;
                this.room.hostId = value;
                this.emit("host-changed", userId, value);
                this.addLog(`${this.playerName(value)} теперь хост.`);
                return this.update();
            }
            if (userId === this.room.hostId && this.room.phase === "lobby" && event === "select-course") {
                const course = COURSE_CARDS.find((item) => item.id === value);
                if (course) this.selectCourse(course);
                return;
            }
            if (userId === this.room.hostId && this.room.phase === "lobby" && event === "set-custom-course" && value && typeof value === "object") {
                const flags = Array.isArray(value.flags) ? value.flags.filter((flag) => Array.isArray(flag) && flag.length === 2
                    && flag.every(Number.isInteger) && flag[0] >= 0 && flag[0] < BOARD_SIZE && flag[1] >= 0 && flag[1] < BOARD_SIZE).slice(0, 8) : [];
                const uniqueFlags = new Set(flags.map(([x, y]) => positionKey(x, y)));
                const rotation = normalizeRotation(value.rotation);
                const features = orientFeatures(BOARD_FEATURES[value.board] || EMPTY_FEATURES, rotation);
                const invalidFlag = flags.some(([x, y]) => features && features.pits.has(positionKey(x, y)));
                if (!BOARD_FEATURES[value.board] || !START_CARDS.includes(value.start) || !flags.length
                    || uniqueFlags.size !== flags.length || invalidFlag)
                    return this.userRegistry.send(userId, "message", "Для своего курса выберите карту, старт и хотя бы один флаг.");
                this.selectCourse({id: "custom", name: String(value.name || "Мой курс").slice(0, 50), board: value.board,
                    start: value.start, rotation, players: "2–8", min: 2, max: 8, length: "своя", level: "авторская", flags});
                return;
            }
            if (event === "join-game" && this.room.paused && this.room.phase !== "lobby"
                && this.room.phase !== "finished") return this.joinPausedGame(userId);
            if (event === "spectators-join" && this.room.paused && this.room.phase !== "lobby"
                && this.room.phase !== "finished") return this.leavePausedGame(userId);
            if (event === "join-game" && this.room.phase === "lobby") {
                if (this.room.playerSlots.includes(userId)) return;
                const requestedSlot = this.room.playerSlots.indexOf(null);
                if (requestedSlot < 0 || this.room.playerSlots[requestedSlot] !== null)
                    return this.userRegistry.send(userId, "message", "В игре уже заняты все восемь мест.");
                const usedColors = new Set(Object.entries(this.room.playerColors)
                    .filter(([id]) => this.room.playerSlots.includes(id)).map(([, color]) => color));
                this.room.playerSlots[requestedSlot] = userId;
                if (!ROBOT_COLORS.includes(this.room.playerColors[userId]) || usedColors.has(this.room.playerColors[userId]))
                    this.room.playerColors[userId] = ROBOT_COLORS.find((color) => !usedColors.has(color));
                this.room.spectators.delete(userId);
                this.randomizeStartAssignments();
                this.addLog(`${this.playerName(userId)} присоединился к игре.`);
                return this.update();
            }
            if (event === "spectators-join" && this.room.phase === "lobby") {
                const slot = this.room.playerSlots.indexOf(userId);
                if (slot >= 0) this.room.playerSlots[slot] = null;
                this.room.spectators.add(userId);
                delete this.room.playerColors[userId];
                this.randomizeStartAssignments();
                this.addLog(`${this.playerName(userId)} перешёл в зрители.`);
                return this.update();
            }
            if (event === "shuffle-starts" && userId === this.room.hostId && this.room.phase === "lobby") {
                this.randomizeStartAssignments(true);
                this.addLog("Хост заново перемешал стартовые позиции роботов.");
                return this.update();
            }
            if (event === "select-color" && this.room.phase === "lobby" && this.room.playerSlots.includes(userId)
                && ROBOT_COLORS.includes(value)) {
                const occupied = this.room.playerSlots.some((id) => id && id !== userId && this.room.playerColors[id] === value);
                if (occupied)
                    return this.userRegistry.send(userId, "message", "Этот цвет уже выбрал другой игрок.");
                this.room.playerColors[userId] = value;
                return this.update();
            }
            if (event === "start-game" && userId === this.room.hostId && this.room.phase === "lobby") {
                this.startGame();
                return;
            }
            if (event === "restart-game" && userId === this.room.hostId) {
                this.cancelProgrammingTimer();
                this.cancelAutoFillResolution();
                this.clearTurnHistory();
                this.room.paused = false;
                this.releasePauseWaiters();
                this.resolutionId = (this.resolutionId || 0) + 1;
                this.powerDownChoiceUsers = [];
                this.powerDownChoices = new Map();
                this.room.phase = "lobby";
                this.room.raceExcludedPlayers.clear();
                this.room.robots = [];
                this.room.winnerId = null;
                this.room.winnerReason = null;
                this.room.powerDownChoice = null;
                this.room.boardEvents = [];
                this.room.programmingAutoFill = null;
                this.addLog("Хост вернул игру в лобби.");
                return this.update();
            }
            if (event === "set-paused" && userId === this.room.hostId && this.room.phase !== "lobby"
                && this.room.phase !== "finished" && value && typeof value.paused === "boolean") {
                if (this.setPaused(value.paused))
                    this.addLog(value.paused ? "Хост поставил игру на паузу." : "Хост продолжил игру.");
                return this.update();
            }
            if (this.room.paused && userId === this.room.hostId && event === "select-history-register"
                && value && Number.isInteger(Number(value.round)) && Number.isInteger(Number(value.register))) {
                this.selectHistoryRegister(Number(value.round), Number(value.register));
                return;
            }
            if (userId === this.room.hostId && this.room.phase === "lobby" && event === "set-authored-course" && value && typeof value === "object") {
                let field;
                try {
                    field = FieldFormat.read(value);
                    if (!field.routes[0].flags.length) throw new Error("Добавьте флаг.");
                } catch (error) {
                    return this.userRegistry.send(userId, "message", `Проверьте поле: ${error.message}`);
                }
                const route = field.routes[0];
                this.selectCourse({id: "authored", name: field.name,
                    board: Object.hasOwn(BOARD_FEATURES,field.name) ? field.name : "Custom",
                    start: START_CARDS[0], rotation: 0, players: "2–8", min: 2, max: 8,
                    length: "своя", level: route.difficulty || "авторская", flags:route.flags,
                    customFeatures:{...field.features,fullField:true},
                    editorRotation:field.rotation || 0});
                return;
            }
            if (this.room.paused && userId === this.room.hostId && event === "set-history-playback"
                && value && typeof value.playing === "boolean") {
                if (value.playing) this.startHistoryPlayback();
                else this.stopHistoryPlayback(true);
                return;
            }
            if (this.room.paused && userId === this.room.hostId && event === "reset-history-review") {
                this.resetHistoryReview(true);
                return;
            }
            if (this.room.paused && this.room.phase !== "lobby")
                return;
            if (event === "choose-reentry" && this.room.phase === "reentry") {
                this.chooseReentry(userId, value);
                return;
            }
            if (event === "choose-power-down-continuation" && this.room.phase === "power-down-choice"
                && value && typeof value.enabled === "boolean") {
                this.choosePowerDownContinuation(userId, value.enabled);
                return;
            }
            const player = this.players[userId];
            if (!player || this.room.phase !== "programming")
                return;
            if (event === "set-power-down-intent") {
                if (player.locked || player.poweredDown || !value || typeof value.enabled !== "boolean") return;
                if (value.enabled && player.damage <= 0) return;
                player.powerDownIntent = value.enabled;
                return this.update();
            }
            if (player.locked) {
                if (event === "unlock-program" && this.room.gameOptions.lastPlayerSeconds === null
                    && !this.room.programmingAutoFill && !this.room.programmingTimer
                    && !this.areAllProgramsLocked() && !player.poweredDown
                    && !this.getRobot(userId).eliminated && !this.getRobot(userId).withdrawn) {
                    player.locked = false;
                    this.addLog(`${this.playerName(userId)} отменил готовность.`);
                    return this.update();
                }
                return;
            }
            if (this.room.activePowerDownMode === "simple" && player.powerDownIntent
                && ["assign-register", "swap-registers", "clear-register", "toggle-card", "auto-program"].includes(event)) return;
            if (event === "assign-register" && value && typeof value === "object") {
                const register = Number(value.register);
                const cardId = String(value.cardId || "");
                if (!Number.isInteger(register) || register < 0 || register >= 5 || player.lockedRegisters.includes(register)
                    || !player.hand.some((card) => card.id === cardId)) return;
                const previous = player.selected.indexOf(cardId);
                const displaced = player.selected[register];
                player.selected[register] = cardId;
                if (previous >= 0 && previous !== register && !player.lockedRegisters.includes(previous))
                    player.selected[previous] = displaced || null;
                return this.update();
            }
            if (event === "swap-registers" && value && typeof value === "object") {
                const from = Number(value.from);
                const to = Number(value.to);
                if (![from, to].every((register) => Number.isInteger(register) && register >= 0 && register < 5)
                    || player.lockedRegisters.includes(from) || player.lockedRegisters.includes(to)) return;
                [player.selected[from], player.selected[to]] = [player.selected[to], player.selected[from]];
                return this.update();
            }
            if (event === "clear-register" && Number.isInteger(value) && value >= 0 && value < 5 && !player.lockedRegisters.includes(value)) {
                player.selected[value] = null;
                return this.update();
            }
            if (event === "toggle-card" && typeof value === "string") {
                const index = player.selected.indexOf(value);
                if (index >= 0 && !player.lockedRegisters.includes(index)) player.selected[index] = null;
                else if (player.hand.some((card) => card.id === value)) {
                    const target = player.selected.findIndex((cardId, register) => !cardId && !player.lockedRegisters.includes(register));
                    if (target >= 0) player.selected[target] = value;
                }
                return this.update();
            }
            if (event === "auto-program") {
                const available = shuffle(player.hand).map((card) => card.id);
                player.selected = player.selected.map((cardId, register) =>
                    player.lockedRegisters.includes(register) ? cardId : available.shift() || null);
                return this.update();
            }
            if (event === "lock-program" && (player.selected.every(Boolean)
                || (this.room.activePowerDownMode === "simple" && player.powerDownIntent))) {
                player.locked = true;
                player.autoFilledRegisters = [];
                this.addLog(`${this.playerName(userId)} готов.`);
                if (this.areAllProgramsLocked()) {
                    this.cancelProgrammingTimer();
                    this.update();
                    this.resolveRound().catch((error) => {
                        this.addLog(`Ошибка разрешения хода: ${error.message}`);
                        this.room.phase = "programming";
                        this.update();
                    });
                } else {
                    this.maybeStartProgrammingTimer();
                    this.update();
                }
            }
        }
    }

    registry.createRoomManager(gamePath, GameState);
}

module.exports = init;
module.exports.BOARD_FEATURES = BOARD_FEATURES;
module.exports.BOARD_SIZE = BOARD_SIZE;
module.exports.COURSE_CARDS = COURSE_CARDS;
module.exports.orientFeatures = orientFeatures;
module.exports.START_CARDS = START_CARDS;
module.exports.conveyorArrivalTurn = conveyorArrivalTurn;
