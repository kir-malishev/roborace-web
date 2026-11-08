(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.RaceField = factory();
}(typeof window !== "undefined" ? window : this, function () {
"use strict";
const BOARD_SIZE = 12, STAGE_ROWS = 16, VERSION = 1;
const DIRECTIONS = ["north", "east", "south", "west"];
const VECTORS = {north:{x:0,y:-1},east:{x:1,y:0},south:{x:0,y:1},west:{x:-1,y:0}};
const rotate = (direction, amount) => DIRECTIONS[(DIRECTIONS.indexOf(direction)+amount+4)%4];
const positionKey = (x,y) => x+","+y;
const clone = value => JSON.parse(JSON.stringify(value));
function emptyGeometry() {
    return {starts:[5,6,4,7,3,8,2,9].map(x=>({x,y:14})),pits:[],repairs:[],gears:{},conveyors:{},express:[],hintConnections:[],
        conveyorConnections:[],walls:[],lasers:[],pushers:[]};
}
function geometryShape(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.hasOwn(raw,"connections")) return false;
    return ["pits","repairs","express","walls","lasers","pushers"].every(key => Array.isArray(raw[key]))
        && ["hintConnections","conveyorConnections"].every(key => raw[key] === undefined || Array.isArray(raw[key]))
        && ["gears","conveyors"].every(key => raw[key] && typeof raw[key] === "object" && !Array.isArray(raw[key]));
}
function normalizeGeometry(raw) {
    if (!geometryShape(raw)) return null;
    const cell = (key) => {
        if (typeof key !== "string" || !/^\d{1,2},\d{1,2}$/.test(key)) return false;
        const [x, y] = key.split(",").map(Number);
        return x < BOARD_SIZE && y < STAGE_ROWS;
    };
    const direction = (value) => DIRECTIONS.includes(value);
    const wall = (key) => {
        if (typeof key !== "string") return false;
        const parts = key.split(",");
        return parts.length === 3 && cell(`${parts[0]},${parts[1]}`) && direction(parts[2]);
    };
    const keys = (value, limit, check) => Array.isArray(value) && value.length <= limit
        && value.every(check) ? [...new Set(value)] : null;
    const maxCells = BOARD_SIZE * STAGE_ROWS;
    const pits = keys(raw.pits, maxCells, cell), repairs = keys(raw.repairs, maxCells, cell);
    const express = keys(raw.express, maxCells, cell), rawWalls = keys(raw.walls, maxCells * 4, wall);
    if (!pits || !repairs || !express || !rawWalls) return null;
    const pitCells = new Set(pits);
    const walls = rawWalls.filter((entry) => {
        const [xText,yText,side] = entry.split(",");
        const x = Number(xText), y = Number(yText), {x:dx,y:dy} = VECTORS[side];
        return !pitCells.has(`${x},${y}`) || !pitCells.has(`${x+dx},${y+dy}`);
    });
    const gears = Object.entries(raw.gears), conveyors = Object.entries(raw.conveyors);
    if (gears.length > maxCells || conveyors.length > maxCells
        || !gears.every(([key, turn]) => cell(key) && (turn === 1 || turn === -1))
        || !conveyors.every(([key, movement]) => cell(key) && direction(movement))
        || !express.every((key) => Object.hasOwn(raw.conveyors, key))) return null;
    const lasers = raw.lasers, pushers = raw.pushers;
    if (!Array.isArray(lasers) || lasers.length > maxCells || !Array.isArray(pushers) || pushers.length > maxCells
        || !lasers.every((laser) => laser && typeof laser === "object" && !Array.isArray(laser)
            && Number.isInteger(laser.x) && Number.isInteger(laser.y) && cell(`${laser.x},${laser.y}`)
            && direction(laser.direction) && [1,2,3].includes(laser.count))
        || !pushers.every((pusher) => pusher && typeof pusher === "object" && !Array.isArray(pusher)
            && Number.isInteger(pusher.x) && Number.isInteger(pusher.y) && cell(`${pusher.x},${pusher.y}`)
            && direction(pusher.direction) && Array.isArray(pusher.active)
            && pusher.active.length > 0 && pusher.active.length <= 5
            && pusher.active.every((register) => Number.isInteger(register) && register >= 1 && register <= 5))) return null;
    for (let index = 0; index < pushers.length; index++) {
        const pusher = pushers[index];
        if (pushers.slice(0,index).some((other) => other.x === pusher.x && other.y === pusher.y
            && (other.direction === pusher.direction || other.active.some((register) => pusher.active.includes(register)))))
            return null;
    }
    const occupied = new Set(pits);
    if (repairs.some((key) => occupied.has(key)) || gears.some(([key]) => occupied.has(key))
        || conveyors.some(([key]) => occupied.has(key)) || lasers.some(({x,y}) => occupied.has(`${x},${y}`))
        || pushers.some(({x,y}) => occupied.has(`${x},${y}`))) return null;
    const starts = raw.starts;
    if (!Array.isArray(starts) || starts.length !== 8 || !starts.every(point => point
        && Number.isInteger(point.x) && Number.isInteger(point.y) && point.x >= 0 && point.x < BOARD_SIZE
        && point.y >= BOARD_SIZE && point.y < STAGE_ROWS)
        || new Set(starts.map(point => positionKey(point.x,point.y))).size !== starts.length) return null;
    for (const {x,y} of starts) {
        const key = positionKey(x,y);
        if (pitCells.has(key) || repairs.includes(key) || Object.hasOwn(raw.gears,key) || raw.conveyors[key]
            || lasers.some(item => item.x === x && item.y === y)
            || pushers.some(item => item.x === x && item.y === y)) return null;
    }
    const connections = keys(raw.hintConnections || [], maxCells * 2, (entry) => typeof entry === "string"
        && entry.split("|").length === 2 && entry.split("|").every(cell));
    if (!connections) return null;
    const conveyorConnections = keys(raw.conveyorConnections || [], maxCells * 2, (entry) => {
        if (typeof entry !== "string") return false;
        const [from,to,...rest] = entry.split("|");
        if (rest.length || !cell(from) || !cell(to) || !Object.hasOwn(raw.conveyors, from)
            || !Object.hasOwn(raw.conveyors, to)) return false;
        const [fx,fy] = from.split(",").map(Number), [tx,ty] = to.split(",").map(Number);
        const movement = VECTORS[raw.conveyors[from]];
        return fx + movement.x === tx && fy + movement.y === ty
            && raw.conveyors[to] !== rotate(raw.conveyors[from], 2)
            && !walls.includes(`${from},${raw.conveyors[from]}`)
            && !walls.includes(`${to},${rotate(raw.conveyors[from], 2)}`);
    });
    if (!conveyorConnections) return null;
    const allWalls = new Set(walls);
    pushers.forEach((pusher) => allWalls.add(`${pusher.x},${pusher.y},${rotate(pusher.direction, 2)}`));
    lasers.forEach((laser) => allWalls.add(`${laser.x},${laser.y},${rotate(laser.direction, 2)}`));
    if (conveyorConnections.some((entry) => {
        const [from,to] = entry.split("|");
        const movement = raw.conveyors[from];
        return allWalls.has(`${from},${movement}`) || allWalls.has(`${to},${rotate(movement, 2)}`);
    })) return null;
    return {starts:starts.map(({x,y}) => ({x,y})),pits, repairs, gears: Object.fromEntries(gears), conveyors: Object.fromEntries(conveyors),
        express, hintConnections: connections, conveyorConnections, walls: [...allWalls],
        lasers: lasers.map(({x,y,direction,count}) => ({x,y,direction,count})),
        pushers: pushers.map(({x,y,direction,active}) => ({x,y,direction,active: [...new Set(active)].sort()}))};
}


// Geometry uses final-board coordinates, including the start at y=12..15.
function geometry(raw) {
    const result = emptyGeometry();
    for (const key of Object.keys(result)) {
        const value = raw[key];
        result[key] = Array.isArray(result[key]) ? [...(value || [])] : {...value};
    }
    return clone(result);
}

function hydrate(raw) {
    const result = geometry(raw);
    for (const key of ["pits","repairs","express","walls"]) result[key] = new Set(result[key]);
    return {size:BOARD_SIZE,...result};
}

function inferConnections(raw, crossingOnly = false) {
    return Object.entries(raw.conveyors).flatMap(([from,direction]) => {
        const [x,y] = from.split(",").map(Number), {x:dx,y:dy} = VECTORS[direction], to = positionKey(x+dx,y+dy);
        if (crossingOnly && (y < 12) === (y+dy < 12)) return [];
        if (!raw.conveyors[to] || raw.conveyors[to] === rotate(direction,2)
            || raw.walls.includes(`${from},${direction}`) || raw.walls.includes(`${to},${rotate(direction,2)}`)) return [];
        return [`${from}|${to}`];
    });
}

function read(payload) {
    const fail = message => { throw new Error(message); };
    if (!payload || payload.format !== "roborace-field" || payload.version !== VERSION)
        fail("неподдерживаемый формат файла");
    if (typeof payload.name !== "string" || payload.name.length > 50) fail("неверное название поля");
    const features = normalizeGeometry(payload.features);
    if (!features) fail("неверная геометрия поля");
    const routes = payload.routes;
    if (!Array.isArray(routes) || !routes.length || routes.length > 32) fail("нужен хотя бы один маршрут");
    const cleanRoutes = routes.map(route => {
        const flags = route?.flags;
        if (!route || typeof route.name !== "string" || route.name.length > 50
            || !Array.isArray(flags) || flags.length > 8
            || !flags.every(flag => Array.isArray(flag) && flag.length === 2 && flag.every(Number.isInteger)
                && flag[0] >= 0 && flag[0] < 12 && flag[1] >= 0 && flag[1] < 16
                && !features.pits.includes(flag.join(","))
                && !features.starts.some(point => point.x === flag[0] && point.y === flag[1]))
            || new Set(flags.map(flag => flag.join(","))).size !== flags.length) fail("неверные позиции флагов");
        const result = {name:route.name,flags:flags.map(flag => [...flag])};
        if (route.difficulty !== undefined) {
            if (typeof route.difficulty !== "string" || route.difficulty.length > 50) fail("неверная сложность маршрута");
            result.difficulty = route.difficulty;
        }
        for (const key of ["recommendedMin","recommendedMax"]) if (route[key] !== undefined) {
            if (!Number.isInteger(route[key]) || route[key] < 2 || route[key] > 8) fail("неверная рекомендация состава");
            result[key] = route[key];
        }
        if (result.recommendedMin > result.recommendedMax) fail("неверная рекомендация состава");
        return result;
    });
    const document = {format:"roborace-field",version:VERSION,name:payload.name,
        features,
        routes:cleanRoutes};
    if (payload.id !== undefined) {
        if (typeof payload.id !== "string" || payload.id.length > 50) fail("неверный идентификатор поля");
        document.id = payload.id;
    }
    if ([0,90,180,270].includes(payload.rotation)) document.rotation = payload.rotation;
    return document;
}

return {VERSION,emptyGeometry,geometry,hydrate,inferConnections,normalizeGeometry,read};
}));
