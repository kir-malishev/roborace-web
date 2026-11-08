const DIRECTION_ANGLES = {north: 0, east: 90, south: 180, west: 270};
const FIELD_VECTORS = {north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0]};
const OPPOSITE_DIRECTION = {north: "south", east: "west", south: "north", west: "east"};
const DIRECTION_NAMES = {north: "вверх", east: "вправо", south: "вниз", west: "влево"};
const LOBBY_ROBOT_COLORS = ["#f04444", "#2d82ff", "#ffd23f", "#27c56d", "#b66dff", "#ff8b38", "#32c8cb", "#f26bb4"];

function cardLabel(card) {
    // Saved hands and history can still carry the previous, longer labels.
    return card.type === "left" ? "Влево" : card.type === "right" ? "Вправо" : card.label;
}

function playerName(state, userId) {
    const engineName = state.authUsers ? CommonRoom.getPlayerNameStatic(userId, state) : null;
    return engineName || (state.playerNames || {})[userId] || userId || "игрок";
}

function boardImageUrl(state, board) {
    return state.boardImages[board];
}

function standardBoardName(state, requested) {
    const boards = Object.keys(state.boardTemplates || {});
    return boards.includes(requested) ? requested : boards[0] || "";
}

function keyPoint(key) {
    return key.split(",").map(Number);
}

function connectedGroups(keys, connects) {
    const remaining = new Set(keys);
    const groups = [];
    while (remaining.size) {
        const first = remaining.values().next().value;
        const group = [];
        const queue = [first];
        remaining.delete(first);
        while (queue.length) {
            const key = queue.pop();
            group.push(key);
            const [x, y] = keyPoint(key);
            [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx, dy]) => {
                const neighbor = `${x + dx},${y + dy}`;
                if (remaining.has(neighbor) && (!connects || connects(key, neighbor))) {
                    remaining.delete(neighbor);
                    queue.push(neighbor);
                }
            });
        }
        groups.push(group);
    }
    return groups;
}

function cellOutline(cells) {
    const set = new Set(cells);
    const parts = [];
    cells.forEach((key) => {
        const [x, y] = keyPoint(key);
        if (!set.has(`${x},${y - 1}`)) parts.push(`M${x},${y}H${x + 1}`);
        if (!set.has(`${x + 1},${y}`)) parts.push(`M${x + 1},${y}V${y + 1}`);
        if (!set.has(`${x},${y + 1}`)) parts.push(`M${x + 1},${y + 1}H${x}`);
        if (!set.has(`${x - 1},${y}`)) parts.push(`M${x},${y + 1}V${y}`);
    });
    return parts.join("");
}

function wallLine(x, y, direction) {
    if (direction === "north") return [x, y, x + 1, y];
    if (direction === "east") return [x + 1, y, x + 1, y + 1];
    if (direction === "south") return [x, y + 1, x + 1, y + 1];
    return [x, y, x, y + 1];
}

function corridorPoints([x1, y1, x2, y2], width = .28, bounds = null) {
    const length = Math.hypot(x2 - x1, y2 - y1) || 1;
    const px = -(y2 - y1) / length * width / 2;
    const py = (x2 - x1) / length * width / 2;
    const points = [[x1 + px,y1 + py],[x2 + px,y2 + py],[x2 - px,y2 - py],[x1 - px,y1 - py]];
    if (bounds) {
        const xs=points.map((point)=>point[0]), ys=points.map((point)=>point[1]);
        const shiftX=Math.min(0,bounds.width-Math.max(...xs))-Math.min(0,Math.min(...xs));
        const shiftY=Math.min(0,bounds.height-Math.max(...ys))-Math.min(0,Math.min(...ys));
        points.forEach((point)=>{point[0]+=shiftX;point[1]+=shiftY;});
    }
    return points.map((point)=>point.join(",")).join(" ");
}

function pusherPanel(pusher) {
    if (pusher.direction === "east") return {x: pusher.x, y: pusher.y + .08, width: .42, height: .84};
    if (pusher.direction === "west") return {x: pusher.x + .58, y: pusher.y + .08, width: .42, height: .84};
    if (pusher.direction === "south") return {x: pusher.x + .08, y: pusher.y, width: .84, height: .42};
    return {x: pusher.x + .08, y: pusher.y + .58, width: .84, height: .42};
}

function physicalWallId(wall) {
    const [xText, yText, direction] = wall.split(",");
    const x = Number(xText), y = Number(yText);
    if (direction === "north") return `h,${x},${y}`;
    if (direction === "south") return `h,${x},${y + 1}`;
    if (direction === "west") return `v,${x},${y}`;
    return `v,${x + 1},${y}`;
}

function wallBetweenPits(pitCells, wall) {
    const [xText, yText, direction] = wall.split(",");
    const x = Number(xText), y = Number(yText), [dx,dy] = FIELD_VECTORS[direction];
    return pitCells.has(`${x},${y}`) && pitCells.has(`${x+dx},${y+dy}`);
}

function laserLines(laser, walls) {
    return RaceArt.laserSegments({walls,lasers:[laser]}).map(({x1,y1,x2,y2})=>[[x1,y1],[x2,y2]]);
}

function FieldLaserOverlay({features,rotation=0}){
    const signature=JSON.stringify([features?.lasers,features?.walls,rotation]);
    const lines=React.useMemo(()=>{
        if(!features)return [];
        const turns=((rotation/90)%4+4)%4;
        const point=(x,y)=>{for(let i=0;i<turns&&y<12;i++){const nextX=11-y;y=x;x=nextX;}return [x,y];};
        const direction=d=>EDITOR_DIRECTIONS[(EDITOR_DIRECTIONS.indexOf(d)+turns)%4];
        const walls=(features.walls||[]).map(w=>{const [x,y,d]=w.split(",");return [...point(+x,+y),+y<12?direction(d):d].join(",");});
        const lasers=(features.lasers||[]).map(l=>{const [x,y]=point(l.x,l.y);return {...l,x,y,direction:l.y<12?direction(l.direction):l.direction};});
        return RaceArt.laserSegments({walls,lasers});
    },[signature]);
    if(!lines.length)return null;
    return <svg className="race-field-lasers" viewBox="0 0 12 16" preserveAspectRatio="none" aria-hidden="true">
        {lines.map(({source,...line},index)=><line key={index} {...line}/>)}
    </svg>;
}

class BoardHints extends React.Component {
    constructor(props) {
        super(props);
        this.state = {hovered: null, x: 50, y: 50};
    }

    point(event) {
        return {x: event.clientX, y: event.clientY};
    }

    show(event, item) {
        this.setState({hovered: item, ...this.point(event)});
    }

    move(event) {
        if (this.state.hovered) this.setState(this.point(event));
    }

    componentDidUpdate(previousProps) {
        if (previousProps.enabled && !this.props.enabled && this.state.hovered)
            this.setState({hovered: null});
    }

    render() {
        const {state, enabled, viewAngle=0} = this.props;
        const features = state.fieldFeatures || {pits: [], repairs: [], gears: {}, starts: [], conveyors: {}, express: [], walls: [], lasers: [], pushers: []};
        const items = [];
        const express = new Set(features.express || []);
        const conveyorDirections = features.conveyors || {};
        const explicitConnections = features.conveyorConnections === null || features.conveyorConnections === undefined
            ? null : new Set(features.conveyorConnections);
        const hintConnections = new Set((features.hintConnections || []).map((connection) => connection.split("|").sort().join("|")));
        const conveyorGroups = connectedGroups(Object.keys(conveyorDirections), (left, right) => {
            const [lx, ly] = keyPoint(left);
            const [rx, ry] = keyPoint(right);
            const flowsTo = (from, toX, toY) => {
                const [fx, fy] = keyPoint(from);
                const vector = FIELD_VECTORS[conveyorDirections[from]];
                return vector && fx + vector[0] === toX && fy + vector[1] === toY;
            };
            if (explicitConnections && ly < 12 && ry < 12)
                return explicitConnections.has(`${left}|${right}`) || explicitConnections.has(`${right}|${left}`);
            return flowsTo(left, rx, ry) || flowsTo(right, lx, ly) || hintConnections.has([left, right].sort().join("|"));
        });
        conveyorGroups.forEach((cells, index) => {
            const outline = cellOutline(cells);
            cells.forEach((key) => {
                const isExpress = express.has(key);
                items.push({id: `conveyor-${index}-${key}`, kind: "area", cells: [key], highlightCells: cells, outline,
                    title: isExpress ? "Экспресс-конвейер" : "Конвейер",
                    description: isExpress ? "Срабатывает дважды: в фазах 3 и 4, по клетке за раз." : "Сдвигает на одну клетку в фазе 4."});
            });
        });
        connectedGroups(features.pits || []).forEach((cells, index) => items.push({id: `pit-${index}`, kind: "area", cells,
            outline: cellOutline(cells), title: "Яма", description: "Сразу уничтожает попавшего сюда робота."}));
        Object.entries(features.gears || {}).forEach(([key, turn], index) => items.push({id: `gear-${index}`, kind: "cell", key,
            title: "Шестерня", description: `Поворачивает робота на 90° ${turn > 0 ? "вправо" : "влево"}. Фаза 6.`}));
        (features.repairs || []).forEach((key, index) => items.push({id: `repair-${index}`, kind: "cell", key,
            title: "Ремонтная станция", description: "Запоминает место восстановления. После пятого регистра снимает одно повреждение."}));

        const walls = new Set(features.walls || []);
        (features.lasers || []).forEach((laser, index) => {
            const count = laser.count || 1;
            items.push({id: `laser-${index}`, kind: "multi-line", lines: laserLines(laser, walls), title: count > 1 ? `Лазер ×${count}` : "Лазер",
                description: `Наносит ${count} ${count === 1 ? "повреждение" : "повреждения"}; стену и первого робота не пробивает. Фаза 7.`});
        });
        const uniqueWalls = [...new Map((features.walls || []).map((wall) => [physicalWallId(wall), wall])).values()];
        uniqueWalls.forEach((wall, index) => {
            const [x, y, direction] = wall.split(",");
            items.push({id: `wall-${index}`, kind: "edge", line: wallLine(Number(x), Number(y), direction),
                title: "Стена", description: "Блокирует движение, толкание и лазеры."});
        });
        (features.pushers || []).forEach((pusher, index) => items.push({id: `pusher-${index}`, kind: "pusher", x:pusher.x, y:pusher.y, panel: pusherPanel(pusher), title: "Толкатель",
            description: `Толкает на одну клетку по стрелке. Регистры: ${(pusher.active || []).join(", ")}. Фаза 5.`}));
        (features.starts || []).forEach((start) => items.push({id: `start-${start.slot}`, kind: "cell", key: `${start.x},${start.y}`,
            title: `Стартовая позиция ${start.slot}`, description: "Номер стартового места. Места назначаются игрокам в лобби."}));
        (state.flags || []).filter((flag) => flag.x != null && flag.y != null).forEach((flag) => items.push({id: `flag-${flag.number}`, kind: "checkpoint", x: flag.x, y: flag.y,
            title: `Флаг ${flag.number}`, description: "Засчитывается по порядку в конце регистра. Любой флаг запоминает место восстановления и ремонтирует после пятого регистра."}));
        (state.robots || []).filter((robot) => robot.archive && robot.archive.x != null && robot.archive.y != null && !robot.eliminated).forEach((robot) => items.push({id: `archive-${robot.userId}`,
            kind: "corner", x: robot.archive.x + .64, y: robot.archive.y + .64, title: "Точка восстановления",
            description: `Точка возрождения: ${playerName(state, robot.userId)}${robot.userId === state.userId ? " (вы)" : ""}.`}));
        (state.robots || []).filter((robot) => robot.x != null && robot.y != null).forEach((robot) => items.push({id: `robot-${robot.userId}`,
            kind: "circle", x: robot.x + .5, y: robot.y + .5, r: .33, title: "Робот",
            description: `${playerName(state, robot.userId)}${robot.userId === state.userId ? " (вы)" : ""}. ${(((state.playerStats || {})[robot.userId]) || {}).poweredDown ? "Перезагрузка: не стреляет." : "Стреляет в фазе 7."}`}));

        const hovered = enabled && this.state.hovered && items.find((item) => item.id === this.state.hovered.id);
        const draw = (item, hit) => {
            const common = hit ? {className: "field-hint-hit", "data-hint-id": item.id, onPointerEnter: (event) => this.show(event, item),
                onPointerMove: (event) => this.move(event), onPointerLeave: () => this.setState({hovered: null})} : {className: "field-hint-outline"};
            if (item.kind === "area") return hit
                ? <g key={`${item.id}-hit`}>{item.cells.map((key) => { const [x,y] = keyPoint(key); return <rect {...common} key={key} x={x} y={y} width="1" height="1"/>; })}</g>
                : <g key={`${item.id}-outline`}><g className="field-hint-wash">{(item.highlightCells || item.cells).map((key) => {
                    const [x,y] = keyPoint(key); return <rect key={key} x={x} y={y} width="1" height="1"/>;
                })}</g><path {...common} d={item.outline}/></g>;
            if (item.kind === "cell") { const [x,y] = keyPoint(item.key); return <rect {...common} key={`${item.id}-${hit}`} x={x + .04} y={y + .04} width=".92" height=".92" rx=".08"/>; }
            if (item.kind === "multi-line") {
                return <g key={`${item.id}-${hit}`}>{item.lines.map((line, index) => hit
                    ? <polygon {...common} key={index} points={corridorPoints([...line[0], ...line[1]], .16)}/>
                    : <line {...common} key={index} x1={line[0][0]} y1={line[0][1]} x2={line[1][0]} y2={line[1][1]}/>)}</g>;
            }
            if (item.kind === "edge") return hit
                ? <polygon {...common} key={`${item.id}-hit`} points={corridorPoints(item.line, .34, {width: 12, height: 16})}/>
                : <line {...common} key={`${item.id}-outline`} x1={item.line[0]} y1={item.line[1]} x2={item.line[2]} y2={item.line[3]}/>;
            if (item.kind === "pusher") return <rect {...common} key={`${item.id}-${hit}`}
                {...(hit?{x:item.x+.08,y:item.y+.08,width:.84,height:.84}:item.panel)} rx=".06"/>;
            if (item.kind === "checkpoint") return <g key={`${item.id}-${hit}`}
                transform={`translate(${item.x+.5} ${item.y+.5}) rotate(${-viewAngle}) translate(-.5 -.5)`}>
                {hit ? <path {...common} fillRule="evenodd" d="M0 0H1V1H0Z M.12 .12V.88H.88V.12Z"/>
                    : <path {...common} style={{fill:"none"}} d="M.08 .26V.08H.26M.74 .08H.92V.26M.08 .74V.92H.26M.74 .92H.92V.74"/>}
                <rect {...common} x=".54" y=".09" width=".36" height=".4" rx=".04"/>
                <rect {...common} x=".54" y=".54" width=".36" height=".36" rx=".06"/>
            </g>;
            if (item.kind === "corner") return <rect {...common} key={`${item.id}-${hit}`} x={item.x} y={item.y} width=".258" height=".258" rx=".04"/>;
            return <circle {...common} key={`${item.id}-${hit}`} cx={item.x} cy={item.y} r={item.r}/>;
        };
        const tooltipLeft = this.state.x > window.innerWidth - 260;
        const tooltipAbove = this.state.y > window.innerHeight - 100;
        const tooltip = enabled && hovered ? ReactDOM.createPortal(
            <div className={`field-tooltip ${tooltipLeft ? "to-left" : ""} ${tooltipAbove ? "above" : ""}`}
                style={{left: `${this.state.x}px`, top: `${this.state.y}px`}} role="tooltip">
                <strong>{hovered.title}</strong><span>{hovered.description}</span>
            </div>, document.body) : null;
        return <div className={`board-hints ${enabled ? "enabled" : "disabled"}`}>
            <svg viewBox="0 0 12 16" preserveAspectRatio="none" aria-hidden="true">
                {hovered ? draw(hovered, false) : null}
                {items.map((item) => draw(item, true))}
            </svg>
            {tooltip}
        </div>;
    }
}

function Robot({robot, state, names = {}, ownUserId}) {
    if (robot.x == null || robot.y == null) return null;
    const style = {
        left: `${(robot.x + .5) / 12 * 100}%`,
        top: `${(robot.y + .5) / 16 * 100}%`,
        "--robot-color": robot.color,
        "--robot-angle": `${Number.isFinite(robot.headingTurns) ? robot.headingTurns * 90 : DIRECTION_ANGLES[robot.direction]}deg`
    };
    return <div className={`robot ${robot.userId === ownUserId ? "own-robot" : ""} ${robot.eliminated ? "eliminated" : ""}`} style={style} data-user-id={robot.userId}
                title={`${state ? playerName(state, robot.userId) : names[robot.userId] || robot.userId}: ${robot.x + 1}, ${robot.y + 1}`}>
        <span className="robot-heading"><svg viewBox="0 0 100 100" aria-hidden="true">
            <path d="M50 7 76 39H63V66H37V39H24Z"/>
        </svg></span>
    </div>;
}

function RobotDeath({robot}) {
    if (!robot.death || robot.death.x == null || robot.death.y == null) return null;
    const style = {left: `${(robot.death.x + .5) / 12 * 100}%`, top: `${(robot.death.y + .5) / 16 * 100}%`,
        "--death-color": robot.color};
    return <div className="robot-death" style={style} aria-hidden="true">
        <svg className="robot-death-icon" viewBox="0 0 100 100">
            <path className="death-burst" d="M50 4 61 22 82 14 78 36 98 49 78 62 85 85 62 79 50 98 38 79 15 85 22 62 2 49 22 36 18 14 39 22Z"/>
            <path className="death-skull" d="M28 47c0-14 9-24 22-24s22 10 22 24c0 9-4 15-11 19v11H39V66c-7-4-11-10-11-19Z"/>
            <circle cx="41" cy="48" r="6"/><circle cx="59" cy="48" r="6"/>
            <path className="death-teeth" d="M42 67v10m8-10v10m8-10v10"/>
        </svg>
        {[0,1,2,3,4,5].map((fragment) => <i key={fragment} style={{"--fragment": fragment}}></i>)}
    </div>;
}

function BoardEventIcon({event}) {
    const iconStyle = {"--event-angle": `${DIRECTION_ANGLES[event.direction] || 0}deg`};
    if (event.type === "heal") return <svg className="board-event-icon" data-icon="heal" viewBox="0 0 100 100">
        <path d="M65 15a20 20 0 0 0-19 27L18 70a10 10 0 1 0 14 14l28-28a20 20 0 0 0 27-19L73 48 53 28Z"/>
        <path className="event-accent" d="M25 16v22M14 27h22"/>
    </svg>;
    if (event.type === "flag") return <svg className="board-event-icon" data-icon="flag" viewBox="0 0 100 100">
        <path d="M27 88V13m2 5h48L65 35l12 18H29"/>
        <path className="event-accent" d="m40 67 9 9 20-23"/>
    </svg>;
    if (event.type === "archive") return <svg className="board-event-icon" data-icon="archive" viewBox="0 0 100 100">
        <path d="M50 91S22 64 22 40a28 28 0 1 1 56 0c0 24-28 51-28 51Z"/>
        <circle className="event-accent" cx="50" cy="40" r="12"/>
    </svg>;
    if (event.type === "gear") return <svg className="board-event-icon" data-icon="gear" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="24"/><circle cx="50" cy="50" r="8"/>
        <path d="M50 12v14m0 48v14M12 50h14m48 0h14M23 23l10 10m34 34 10 10M77 23 67 33M33 67 23 77"/>
        <path className="event-accent" d={event.turn > 0 ? "M20 42A32 32 0 0 1 75 27m0 0-2-14m2 14-14 2"
            : "M80 42A32 32 0 0 0 25 27m0 0 2-14m-2 14 14 2"}/>
    </svg>;
    if (event.type === "conveyor") return <svg className="board-event-icon directional" data-icon="conveyor" style={iconStyle} viewBox="0 0 100 100">
        <rect x="22" y="8" width="56" height="84" rx="20"/>
        {event.turn ? <path className="event-accent" d={event.turn > 0
            ? "M35 72V48c0-13 8-21 21-21h15m-10-10 10 10-10 10"
            : "M65 72V48c0-13-8-21-21-21H29m10-10L29 27l10 10"}/>
            : <><path className="event-accent" d="M50 76V24m-12 13 12-13 12 13"/>
                {event.express ? <path className="event-accent express-mark" d="m38 59 12-13 12 13"/> : null}</>}
    </svg>;
    if (event.type === "pusher") return <svg className="board-event-icon directional" data-icon="pusher" style={iconStyle} viewBox="0 0 100 100">
        <path d="M22 82h56M29 69h42M38 69V48h24v21M50 48V15m-14 16 14-16 14 16"/>
    </svg>;
    return <svg className="board-event-icon directional" data-icon="push" style={iconStyle} viewBox="0 0 100 100">
        <path d="M50 80V19m-17 18 17-18 17 18M20 73h60"/>
        <path className="event-accent" d="m14 57 10-6-8-8 12-2-4-10m62 26-10-6 8-8-12-2 4-10"/>
    </svg>;
}

function BoardEvents({events = [], replayKey = "live"}) {
    if (!events.length) return null;
    return <div className="board-events-layer" aria-hidden="true">{events.map((event) => {
        const [dx,dy] = FIELD_VECTORS[event.direction] || [0,0];
        return <span className={`board-event board-event-${event.type} ${event.turn > 0 ? "turn-right" : event.turn < 0 ? "turn-left" : ""}`}
            key={`${replayKey}-${event.id}`} data-event-id={event.id} data-user-id={event.userId}
            style={{left: `${(event.x + .5) / 12 * 100}%`, top: `${(event.y + .5) / 16 * 100}%`,
                "--event-color": event.color || "#8ddcff", "--event-dx": `${-dx * 2.2}cqw`, "--event-dy": `${-dy * 2.2}cqw`}}>
            <BoardEventIcon event={event}/>
        </span>;
    })}</div>;
}

function LaserEffects({shots = [], robots = [], replayKey = "live", viewAngle=0}) {
    if (!shots.length) return null;
    const robotsByUser = Object.fromEntries(robots.map((robot) => [robot.userId, robot]));
    // A robot beam is valid only while its real source robot occupies the
    // recorded square. This also rejects stale network frames instead of
    // drawing a beam from an empty conveyor or another arbitrary cell.
    const visibleShots = shots.filter((shot) => {
        if (shot.source !== "robot") return true;
        const robot = robotsByUser[shot.sourceUserId];
        return robot && !robot.eliminated && !robot.destroyed && robot.x != null && robot.y != null
            && Math.abs(shot.start.x - (robot.x + .5)) < .001
            && Math.abs(shot.start.y - (robot.y + .5)) < .001
            && shot.direction === robot.direction;
    });
    const hits = new Map();
    visibleShots.filter((shot) => shot.targetUserId).forEach((shot) => {
        const hit = hits.get(shot.targetUserId) || {x: shot.end.x, y: shot.end.y, damage: 0};
        hit.damage += shot.count || 1;
        hits.set(shot.targetUserId, hit);
    });
    const beamLines = (shot) => {
        const [dx, dy] = FIELD_VECTORS[shot.direction] || [0, -1];
        const offsets = shot.count === 3 ? [-.24, 0, .24] : shot.count === 2 ? [-.18, .18] : [0];
        return offsets.map((offset) => ({
            x1: shot.start.x + (dy ? offset : 0), y1: shot.start.y + (dx ? offset : 0),
            x2: shot.end.x + (dy ? offset : 0), y2: shot.end.y + (dx ? offset : 0)
        }));
    };
    return <svg className="laser-effects" viewBox="0 0 12 16" preserveAspectRatio="none" aria-hidden="true">
        {visibleShots.map((shot) => {
            return <g className={`laser-shot laser-shot-${shot.source}`} data-source-user-id={shot.sourceUserId || undefined} key={`${replayKey}-${shot.id}`}>
                {beamLines(shot).map((line, index) => <React.Fragment key={index}>
                    <line className="laser-beam-glow" pathLength="1" {...line}/>
                    <line className="laser-beam-core" pathLength="1" {...line}/>
                </React.Fragment>)}
                <circle className="laser-muzzle" cx={shot.start.x} cy={shot.start.y} r=".16"/>
            </g>;
        })}
        {[...hits.entries()].map(([userId, hit]) => <g className="laser-impact" key={`${replayKey}-${userId}`}
            style={{"--impact-color": (robotsByUser[userId] || {}).color || "#ffcf4a"}}>
            <circle className="laser-impact-ring" cx={hit.x} cy={hit.y} r=".38"/>
            <circle className="laser-impact-flash" cx={hit.x} cy={hit.y} r=".2"/>
            <g className="laser-impact-label" transform={`translate(${hit.x} ${hit.y}) rotate(${-viewAngle})`}>
                <text x="0" y="-.42" textAnchor="middle">−{hit.damage}</text>
            </g>
        </g>)}
    </svg>;
}

function HostLivesEditor({userId, lives, app}) {
    const [draft, setDraft] = React.useState(lives === null ? "∞" : String(lives));
    const [editing, setEditing] = React.useState(false);
    React.useEffect(() => setDraft(lives === null ? "∞" : String(lives)), [lives]);
    const trimmed = draft.trim();
    const valid = trimmed === "∞" || (/^[1-9]\d*$/.test(trimmed) && Number.isSafeInteger(Number(trimmed)));
    const commit = () => {
        const next = trimmed === "∞" ? null : Number(trimmed);
        if (valid) {
            app.socket.emit("set-player-lives", {userId, lives: next});
            setEditing(false);
        }
    };
    return <span className="rr-host-lives">
        {editing ? <span className="player-stat lives rr-lives-inline-edit">
            <i aria-hidden="true">♥</i>
            <input aria-label={`Новое число жизней: ${userId}`} title="Положительное число или ∞" aria-invalid={!valid} inputMode="numeric" autoFocus value={draft}
                onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
                    if (event.key === "Enter") commit();
                    if (event.key === "Escape") setEditing(false);
                }}/>
            <button type="button" aria-label="Сохранить жизни" title={valid ? "Сохранить жизни" : "Введите число от 1 или ∞"} disabled={!valid} onClick={commit}>✓</button>
        </span> : <button type="button" className="player-stat lives" aria-label={`Оставшиеся жизни: ${lives === null ? "бесконечно" : lives}. Изменить`}
            title="Изменить жизни робота" aria-expanded={editing} onClick={() => setEditing(!editing)}>
            <i aria-hidden="true">♥</i><b>{lives === null ? "∞" : lives}</b><span className="rr-lives-pencil" aria-hidden="true">✎</span></button>}
    </span>;
}

function PlayerPanel({state, app}) {
    const robotsByUser = {};
    state.robots.forEach((robot) => robotsByUser[robot.userId] = robot);
    const players = state.playerSlots.filter(Boolean);
    const spectators = (state.onlinePlayers || []).filter((userId) => !players.includes(userId));
    const isPlayer = players.includes(state.userId);
    const canChangeRole = state.paused && state.phase !== "finished";
    const removedFromGame = (state.raceExcludedPlayers || []).includes(state.userId);
    const displayedStats = state.historyReview && !state.historyReview.actual
        && state.historyReview.playerStats ? state.historyReview.playerStats : state.playerStats;
    return <section className="players-panel rr-panel">
        <h2>Роботы</h2>
        {players.map((userId) => {
            const robot = robotsByUser[userId] || {};
            const stats = (displayedStats && displayedStats[userId]) || {};
            const status = stats.finished ? "finished"
                : stats.poweredDown ? "powered-down"
                : stats.powerDownNextRound ? "power-down-next"
                : state.phase === "programming" && stats.ready ? "ready" : "";
            const statusTitle = status === "finished" ? "Робот собрал все флаги и завершил заезд"
                : status === "powered-down" ? "Робот находится в режиме перезагрузки"
                : status === "power-down-next" ? "Робот отключится в следующем раунде"
                : status === "ready" ? "Игрок закончил программирование" : "";
            return <div className="player-row" key={userId}>
                <i style={{background: robot.color || state.playerColors[userId]}}></i>
                <div className="player-identity"><span className={`${userId === state.userId ? "own-player-name" : "player-name"} player-name-status ${status}`}
                    title={statusTitle || undefined}>{playerName(state, userId)}</span>
                    <MemberHostControls state={state} userId={userId}/></div>
                <span className="player-stat flags" title="Активированные флаги" aria-label={`Активированные флаги: ${stats.checkpoints || 0} из ${state.flags.length}`}>
                    <i aria-hidden="true">⚑</i><b>{stats.checkpoints || 0}/{state.flags.length}</b></span>
                <span className="player-stat damage" title="Повреждения" aria-label={`Повреждения: ${stats.damage || 0}`}>
                    <i aria-hidden="true">⚡</i><b>{stats.damage || 0}</b></span>
                {state.userId === state.hostId && state.phase !== "finished" && state.gameOptions?.startingLives !== null
                    && (!state.historyReview || state.historyReview.actual) ?
                    <HostLivesEditor userId={userId} lives={stats.lives} app={app}/>
                    : <span className="player-stat lives" title="Оставшиеся жизни" aria-label={`Оставшиеся жизни: ${stats.lives == null ? "бесконечно" : stats.lives}`}>
                        <i aria-hidden="true">♥</i><b>{stats.lives == null ? "∞" : stats.lives}</b></span>}
                {stats.finished ? <small>Финиш · {Math.max(1, (state.finishOrder || []).indexOf(userId) + 1)}</small>
                    : stats.poweredDown ? <small>ПЕРЕЗАГРУЗКА</small> : stats.powerDownNextRound ? <small>ПЕРЕЗАГРУЗКА · следующий раунд</small> : null}
                <PlayerRegisters state={state} userId={userId}/>
            </div>;
        })}
        <div className="rr-game-spectators" aria-label="Зрители">
            <h3>Зрители <small>{spectators.length}</small></h3>
            {spectators.length ? <div className="rr-game-spectator-list">{spectators.map((userId) =>
                <span className="rr-game-spectator" key={userId}>
                    <PlayerName data={state} id={userId}/>{userId === state.hostId ? <small> · хост</small> : null}
                    <MemberHostControls state={state} userId={userId}/>
                </span>)}</div> : <p>Нет зрителей</p>}
        </div>
        {canChangeRole ? <div className="rr-game-role-actions">
            <button type="button" disabled={isPlayer || players.length >= 8 || removedFromGame}
                title={removedFromGame ? "Хост исключил вас из текущего заезда" : undefined}
                onClick={() => app.socket.emit("join-game")}>{removedFromGame ? "Исключён из заезда" : "Войти в игру"}</button>
            <button type="button" disabled={!isPlayer}
                onClick={() => app.socket.emit("spectators-join")}>Стать зрителем</button>
        </div> : null}
    </section>;
}

const GUIDE_PHASES = [
    ["Карты", "Открываются команды регистра"],
    ["Роботы", "Сначала команды с большим числом"],
    ["Экспресс", "Только быстрые ленты: одна клетка"],
    ["Конвейеры", "Все ленты: одна клетка"],
    ["Толкатели", "Работают в указанных регистрах"],
    ["Шестерни", "Поворачивают роботов на 90°"],
    ["Лазеры", "Стреляют поле и активные роботы"],
    ["Флаги и возврат", "Засчитываются флаги, запоминается место возврата"]
];

const GUIDE_ELEMENTS = [
    {id: "conveyor-straight", title: "Конвейеры", phase: "3 и 4", text: "Один шеврон: сдвиг на клетку в фазе 4. Два шеврона: экспресс, сдвиг в фазах 3 и 4. Ленты двигают роботов одновременно, не толкая их друг в друга."},
    {id: "conveyor-merge-triple", title: "Повороты и слияния", phase: "3 или 4", text: "Изогнутая ветвь поворачивает корпус при въезде по связанной ленте. Прямой вход, примыкание без изогнутой стрелки и въезд своей командой сохраняют направление."},
    {id: "pusher-odd", title: "Толкатель", phase: "5", text: "Толкает на клетку по стрелке. Срабатывает только в регистрах, указанных на табличке: например, 1/3/5 или 2/4."},
    {id: "gear-clockwise", title: "Поворотная платформа", phase: "6", text: "Поворачивает корпус на 90°: золотистая — вправо, фиолетовая — влево."},
    {id: "laser-double", title: "Лазер", phase: "7", text: "Каждый луч даёт одно повреждение. Его остановит перегородка или первый встреченный робот."},
    {id: "wall", title: "Стена", phase: "Всегда", text: "Сплошная синяя перегородка останавливает корпуса, цепочки толкания и лучи."},
    {id: "pit", title: "Яма", phase: "Всегда", text: "Падение в яму сразу отнимает жизнь. Медная кромка обозначает провал и не мешает движению."},
    {id: "repair", title: "Ремонтная станция", phase: "Конец раунда", text: "Если закончить здесь пятый регистр, снимает одно повреждение."},
    {id: "robot", title: "Робот", phase: "2 и 7", text: "Нос показывает направление движения вперёд и выстрела. Цвет совпадает с цветом игрока.", kind: "robot"},
    {id: "flag", title: "Флаг", phase: "8", text: "Засчитывается по порядку в конце регистра. Также работает как ремонтная станция, даже если сейчас нужен другой флаг.", kind: "flag"},
    {id: "archive", title: "Точка восстановления", phase: "8", text: "Геометка в цвет игрока показывает, куда вернётся его робот. Обновляется на ремонте и любом флаге.", kind: "archive"}
];

function GuideRobotSymbol({centered=false,size=64}) {
    return <svg className="rr-guide-robot" viewBox="0 0 100 100" x={centered?-size/2:undefined} y={centered?-size/2:undefined}
        width={centered?size:"100%"} height={centered?size:"100%"} aria-hidden="true">
        <path className="rr-guide-robot-body" d="M27 6H73L94 27V73L73 94H27L6 73V27Z"/>
        <path className="rr-guide-robot-bezel" d="M30 13H70L87 30V70L70 87H30L13 70V30Z"/>
        <path className="rr-guide-robot-nose" d="M50 7 76 39H63V66H37V39H24Z" transform="translate(12 15) scale(.76)"/>
    </svg>;
}

function GuideToken({kind}) {
    if (kind === "robot") return <span className="guide-robot-token"><GuideRobotSymbol/></span>;
    if (kind === "flag") return <FlagMarker number={1} className="guide-flag-token"/>;
    return <span className="guide-archive-token"><ArchiveSymbol/></span>;
}

function GuideExample() {
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const [paused,setPaused]=React.useState(reduced);
    const [staticPreview,setStaticPreview]=React.useState(reduced);
    const [cycle,setCycle]=React.useState(0);
    return <figure className="rr-guide-example" data-example="flags" data-paused={paused} data-static={staticPreview}>
        <svg viewBox="0 0 400 120" role="img" aria-label="Робот останавливается на флагах 1, 2 и 3 по порядку" key={cycle}>
                <path className="rr-example-track" d="M40 60H360"/>
                {[1,2,3].map((number,index)=><g key={number} transform={`translate(${110+index*110} 30)`}>
                    <rect className="rr-example-tile" width="60" height="60" rx="6"/>
                    <g transform="scale(.6)" dangerouslySetInnerHTML={{__html:RaceArt.checkpointMarkup(number)}}/>
                    <text className={`rr-example-collected rr-example-collected-${number}`} x="30" y="79" textAnchor="middle">✓</text>
                </g>)}
                <g className="rr-example-flag-robot"><g transform="rotate(90)"><GuideRobotSymbol centered size={44}/></g></g>
        </svg>
        <figcaption><span>Флаг засчитан — двигайтесь к следующему.</span>
            <div><button type="button" aria-label={paused?"Продолжить пример":"Остановить пример"} aria-pressed={paused}
                onClick={()=>{setPaused(!paused);setStaticPreview(false);}}>{paused?"▶":"Ⅱ"}</button>
                <button type="button" aria-label="Повторить пример" onClick={()=>{setCycle(cycle+1);setStaticPreview(false);}}>↻</button></div>
        </figcaption>
    </figure>;
}

function GuidePhaseList({full = false}) {
    return <ol className={full ? "guide-phase-timeline" : "quick-phases"}>
        {GUIDE_PHASES.map(([title, text], index) => <li key={title}><b>{index + 1}</b><span><strong>{title}</strong>{full ? <small>{text}</small> : null}</span></li>)}
    </ol>;
}

function QuickGuide({onOpen, onOpenConveyors, onOpenCollisions}) {
    return <section className="rr-panel quick-guide" aria-label="Шпаргалка">
        <div className="quick-guide-heading"><div className="quick-guide-actions">
            <button type="button" className="conveyor-guide-open" onClick={onOpenConveyors}>КОНВЕЙЕРЫ</button>
            <button type="button" className="rr-collision-guide-open" onClick={onOpenCollisions}>КОЛЛИЗИИ</button>
            <button type="button" className="quick-guide-open" onClick={onOpen}>Как играть</button></div></div>
        <details className="rr-game-disclosure"><summary>Цель и порядок хода</summary>
            <p className="quick-goal"><strong>Цель:</strong> соберите флаги по порядку. Они засчитываются в конце регистра.</p>
            <p className="rr-guide-register-note">Раунд — пять регистров. В каждом роботы выполняют команды, затем работает поле.</p>
            <GuidePhaseList/>
            <p className="quick-repair">Ремонт: зелёная станция или любой флаг снимают одно повреждение после пятого регистра.</p>
        </details>
    </section>;
}

class GuideModal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {tab: "how"};
        this.dialogRef = React.createRef();
        this.handleKeyDown = this.handleKeyDown.bind(this);
    }

    componentDidUpdate(previousProps) {
        if (this.props.open && !previousProps.open) {
            this.returnFocus = this.props.returnFocus || document.activeElement;
            this.previousOverflow = document.body.style.overflow;
            document.body.style.overflow = "hidden";
            document.addEventListener("keydown", this.handleKeyDown);
            this.setState({tab: "how"}, () => {
                const close = this.dialogRef.current && this.dialogRef.current.querySelector(".guide-close");
                if (close) close.focus();
            });
        } else if (!this.props.open && previousProps.open) this.releaseModal();
    }

    componentWillUnmount() {
        if (this.props.open) this.releaseModal();
    }

    releaseModal() {
        document.removeEventListener("keydown", this.handleKeyDown);
        document.body.style.overflow = this.previousOverflow || "";
        if (this.returnFocus && document.contains(this.returnFocus)) this.returnFocus.focus();
    }

    handleKeyDown(event) {
        if (event.key === "Escape") {
            event.preventDefault();
            this.props.onClose();
            return;
        }
        if (event.key !== "Tab" || !this.dialogRef.current) return;
        const focusable = [...this.dialogRef.current.querySelectorAll("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    selectTab(tab) {
        this.setState({tab});
    }

    renderHow() {
        const finishAllFlags = !!this.props.options?.finishAllFlags;
        return <div className="guide-copy guide-how">
            <section className="guide-lead"><div><span className="guide-kicker">Цель игры</span><h3>Пройдите контрольные точки раньше соперников</h3>
                <p>Останавливайтесь на флагах по порядку: они засчитываются в конце регистра. {finishAllFlags
                    ? "Первый финишировавший побеждает, остальные доигрывают маршрут."
                    : "Кто первым соберёт все флаги, побеждает."} Можно также победить, оставшись единственным роботом в заезде.</p></div>
                <GuideToken kind="flag"/></section>
            <GuideExample/>
            <ol className="rr-guide-start-steps">
                <li><b>1</b><div><h3>Соберите программу</h3><p>Выберите пять карт и расставьте их по порядку. Каждая ячейка — один регистр. Программа готова — нажмите «Готов».</p></div></li>
                <li><b>2</b><div><h3>Посмотрите, что получилось</h3><p>Когда готовы все, каждый регистр разыгрывается: сначала команды роботов, затем поле. После пяти регистров — новая раздача и следующая программа.</p></div></li>
            </ol>
        </div>;
    }

    renderField() {
        return <div className="guide-elements">
            <div className="guide-element-grid">{GUIDE_ELEMENTS.map((item) => <article className="guide-element-card" key={item.id}>
                <div className={`guide-element-visual ${item.kind ? "generated" : ""}`}>
                    {item.kind ? <GuideToken kind={item.kind}/> : <img loading="lazy" src={`/roborace/assets/guide/${item.id}.svg`} alt=""/>}
                </div>
                <div className="guide-element-copy"><div><h3>{item.title}</h3><span className="guide-phase-badge">{/^\d/.test(item.phase)?`Фаза ${item.phase}`:item.phase}</span></div><p>{item.text}</p></div>
            </article>)}</div>
            <details className="rr-guide-phase-details"><summary>Порядок одного регистра</summary><GuidePhaseList full/></details>
        </div>;
    }

    renderDamage() {
        const options = this.props.options || {};
        return <div className="guide-copy guide-damage">
            <section className="guide-damage-scale"><div><b>0</b><span>полная рука<br/><strong>9 карт</strong></span></div><i></i><div><b>5–9</b><span>блокируются регистры<br/><strong>с 5-го к 1-му</strong></span></div><i></i><div className="danger"><b>10</b><span>робот уничтожен<br/><strong>−1 жизнь</strong></span></div></section>
            <div className="guide-rule-grid">
                <article><h3>Урон и потеря жизни</h3><p>Одно повреждение — на одну карту меньше в руке. С пятого повреждения команды прошлого раунда блокируются: от пятого регистра к первому. Десять повреждений, яма или падение за край отнимают жизнь.</p></article>
                <article><h3>Возрождение на поле</h3><p>Робот возвращается перед новой раздачей с двумя повреждениями. Выберите подсвеченную клетку, затем направление стрелкой и нажмите «Возродиться». Если точка занята, доступны соседние клетки.</p></article>
                <article><h3>Ремонт и восстановление</h3><p>Зелёная станция и любой флаг запоминают место возврата. В конце пятого регистра они снимают одно повреждение. Если регистр разблокировался, его старая карта сбрасывается.</p></article>
                <article><h3>Таймер последнего игрока</h3><p>{options.lastPlayerSeconds === null
                    ? "Выключен. Пока готовы не все, можно отменить готовность и изменить программу."
                    : `Когда готовыми стали все, кроме одного, у последнего остаётся ${options.lastPlayerSeconds || 30} секунд. Затем пустые регистры заполняются случайными картами с руки, программа подтверждается.`}</p></article>
            </div>
            <section className="guide-power-down"><div className="guide-power-token"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v9M6 5.5a8 8 0 1 0 12 0"/></svg><small>Перезагрузка</small></span></div><div><h3>Перезагрузка</h3>
                <p>{options.powerDownMode === "simple"
                    ? "Выберите перезагрузку вместо программы: робот пропустит текущий раунд. Доступно при повреждениях."
                    : "Объявите перезагрузку вместе с программой: текущий раунд робот выполнит, следующий пропустит. Доступно при повреждениях."}</p>
                <p>В начале отключённого раунда весь урон снимается. Робот не выполняет команды и не стреляет, но поле действует на него, а другие роботы могут толкать.</p>
                <p>После раунда выберите: включиться или остаться в перезагрузке. Полученный за этот раунд урон при включении сохранится.</p></div></section>
            <aside className="guide-course-note">Перед заездом проверьте настройки жизней, таймера и режима перезагрузки.</aside>
        </div>;
    }

    render() {
        if (!this.props.open) return null;
        const tabs = [["how", "Как играть"], ["field", "Элементы поля"], ["damage", "Урон и Перезагрузка"]];
        return <div className="guide-backdrop" onClick={(event) => event.target === event.currentTarget && this.props.onClose()}>
            <section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-modal-title" ref={this.dialogRef}>
                <header className="guide-modal-header"><div><span>Справочник</span><h2 id="guide-modal-title">Как играть в RoboRace</h2></div>
                    <button type="button" className="guide-close" aria-label="Закрыть справочник" onClick={this.props.onClose}>×</button></header>
                <div className="guide-tabs" role="tablist" aria-label="Разделы справочника">{tabs.map(([id, label]) => <button type="button" role="tab" key={id}
                    id={`guide-tab-${id}`} aria-selected={this.state.tab === id} aria-controls={`guide-panel-${id}`}
                    className={this.state.tab === id ? "active" : ""} onClick={() => this.selectTab(id)}>{label}</button>)}</div>
                <div className="guide-modal-content" role="tabpanel" id={`guide-panel-${this.state.tab}`} aria-labelledby={`guide-tab-${this.state.tab}`}>
                    {this.state.tab === "how" ? this.renderHow() : this.state.tab === "field" ? this.renderField() : this.renderDamage()}
                </div>
            </section>
        </div>;
    }
}

function PauseBanner({state}) {
    if (!state.paused) return null;
    const review = state.historyReview || {};
    const mode = review.playing ? "Воспроизведение журнала"
        : !review.actual && review.selected ? "Просмотр журнала" : "Актуальное состояние";
    const detail = review.playing
        ? review.selected ? `Раунд ${review.selected.round} · регистр ${review.selected.register} · ${review.stage || "выполнение"}` : "Подготовка воспроизведения"
        : !review.actual && review.selected
            ? `Раунд ${review.selected.round} · ${review.frameIndex === 0 ? "перед" : "стадия"} регистра ${review.selected.register}${review.stage ? ` · ${review.stage}` : ""}`
            : "Хост может открыть журнал выполненных регистров.";
    return <section className={`pause-banner ${review.playing || !review.actual && review.selected ? "history" : ""}`} role="status">
        <strong>Игра на паузе</strong><span>{mode}</span><small>{detail}</small>
    </section>;
}

function HistoryReviewPanel({state, app}) {
    if (!state.paused) return null;
    const review = state.historyReview || {entries: [], selected: null, actual: true, playing: false};
    const entries = review.entries || [];
    const isHost = state.userId === state.hostId;
    const rounds = [...new Set(entries.map((entry) => entry.round))].sort((left, right) => right - left);
    const selected = review.selected;
    const select = (entry) => app.socket.emit("select-history-register", {round: entry.round, register: entry.register});
    return <section className={`rr-panel history-review-panel ${review.actual ? "actual" : "reviewing"} ${review.playing ? "playing" : ""}`}
        aria-label="Журнал выполненных регистров">
        <div className="history-review-heading"><div><h2>Журнал ходов</h2><small>{review.actual ? "Показано актуальное состояние"
            : review.playing ? "Идёт общее воспроизведение" : "Все участники видят выбранный кадр"}</small></div>
            <span className="history-live-mark">{review.actual ? "СЕЙЧАС" : "АРХИВ"}</span></div>
        <div className="history-review-actions">
            <button type="button" className={review.playing ? "history-stop" : "history-play"}
                disabled={!isHost || !entries.length}
                title={!isHost ? "Историей управляет хост" : review.playing ? "Остановить воспроизведение" : "Проиграть с выбранного регистра"}
                onClick={() => app.socket.emit("set-history-playback", {playing: !review.playing})}>
                {review.playing ? "■ Остановить" : "▶ Проиграть"}
            </button>
            <button type="button" className="history-reset" disabled={!isHost || review.actual}
                title={!isHost ? "Историей управляет хост" : "Вернуть актуальное состояние"}
                onClick={() => app.socket.emit("reset-history-review", {reset: true})}>СБРОСИТЬ</button>
        </div>
        {entries.length ? <div className="history-rounds">{rounds.map((round) => <div className="history-round" key={round}>
            <strong>Раунд {round}</strong><div>{entries.filter((entry) => entry.round === round).map((entry) => {
                const active = selected && selected.round === entry.round && selected.register === entry.register;
                return <button type="button" key={`${entry.round}-${entry.register}`} className={active ? "active" : ""}
                    aria-current={active ? "step" : undefined} disabled={!isHost}
                    title={!isHost ? "Выбранный хостом кадр" : `Состояние перед регистром ${entry.register}`}
                    onClick={() => select(entry)}>Регистр {entry.register}</button>;
            })}</div>
        </div>)}</div> : <p className="history-empty">Выполненных регистров пока нет.</p>}
        {!isHost ? <small className="history-read-only">Просмотром управляет хост.</small> : null}
    </section>;
}

function GamePauseControls({state, app}) {
    if (state.userId !== state.hostId || state.phase === "lobby" || state.phase === "finished") return null;
    return <section className="rr-panel game-pause-controls">
        <h2>Управление игрой</h2>
        <button type="button" className={state.paused ? "resume" : "pause"}
            aria-pressed={!!state.paused}
            onClick={() => app.socket.emit("set-paused", {paused: !state.paused})}>
            {state.paused ? "▶ Продолжить" : "Ⅱ Пауза"}
        </button>
        {state.paused ? <button type="button" onClick={app.openGameSettings}>⚙ Настройки</button> : null}
    </section>;
}

function ConveyorDemoBoard({kind}) {
    const robotClass = kind === "belt" ? "conveyor-demo-good-robot" : "conveyor-demo-card-robot";
    return <svg className="conveyor-demo-svg" viewBox="0 0 300 400" role="img" data-entry={kind}
        aria-label={kind === "belt" ? "Вперёд 1: робот входит на ленту. Лента доставляет его на изгиб и поворачивает вправо. Движение закончено."
            : "Вперёд 2: робот входит на изгиб своей командой. Лента сдвигает его вправо, нос остаётся направлен вверх."}>
        <image className="rr-conveyor-demo-background" href="/roborace/assets/guide/conveyor-turn.svg" width="300" height="400"/>
        <g className={robotClass}><g className="conveyor-demo-robot"><GuideRobotSymbol centered/></g></g>
    </svg>;
}

function ConveyorDemoCommand({steps,priority}) {
    return <div className="rr-conveyor-demo-command">
        <div className="rr-demo-card"><strong>Вперёд {steps}</strong><b>{priority}</b><span aria-hidden="true">↑</span></div>
        <span aria-hidden="true">→</span><strong className="rr-demo-belt-phase">Конвейер</strong>
    </div>;
}

const COLLISION_EXAMPLES = [
    {id:"priority",title:"Кто первым",heading:"Одна клетка — две команды",turns:[90,0],commands:[{steps:1,priority:570},{steps:1,priority:490}],
        text:"Сначала бирюзовый робот с приоритетом 570 занимает клетку. Затем янтарный с приоритетом 490 входит в неё и толкает его вверх.",
        note:"При толчке робот сохраняет направление носа. Его собственная команда выполнится в свою очередь."},
    {id:"passing",title:"Без столкновения",heading:"Два робота проходят пересечение",turns:[90,0],commands:[{steps:1,priority:570},{steps:2,priority:680}],
        text:"Янтарный с приоритетом 680 первым проходит две клетки и освобождает пересечение. Затем бирюзовый делает один шаг. Никто никого не толкает.",
        note:"Карта выполняется целиком, прежде чем начнёт двигаться следующий робот."},
    {id:"headon",title:"Друг в друга",heading:"Два толчка — снова на исходных клетках",turns:[90,270],commands:[{steps:1,priority:570},{steps:1,priority:490}],
        text:"Бирюзовый делает шаг и толкает янтарного вправо. Затем янтарный выполняет свою карту и толкает бирюзового влево. Оба возвращаются на исходные клетки.",
        note:"Толчок не отменяет команду соседа и не поворачивает его корпус."},
    {id:"wall",title:"Стена",heading:"Робот упирается в стену",turns:[90],commands:[{steps:1,priority:570}],
        text:"Робот выполняет «Вперёд 1», но перед ним стена. Он остаётся на своей клетке."},
    {id:"chain",title:"Цепочка",heading:"Одна команда сдвигает всю цепочку",turns:[90,0,180],commands:[{steps:1,priority:570}],
        text:"Бирюзовый выполняет «Вперёд 1». Впереди свободно, поэтому все три робота сдвигаются на одну клетку.",
        note:"Толчок не расходует команды соседей и не меняет направление их носа."}
];

function CollisionDemoBoard({kind}) {
    const example=COLLISION_EXAMPLES.find(item=>item.id===kind);
    const colors=["#83d5c9","#f1b568","#b5a1ed"];
    return <svg className="rr-collision-svg" viewBox="0 0 360 300" role="img" aria-label={example.text}>
        <image href={`/roborace/assets/guide/collision${kind==="wall"?"-wall":""}.svg`} width="360" height="300"/>
        {["priority","passing"].includes(kind)?<rect className="rr-collision-target" x="122" y="122" width="56" height="56" rx="6"/>:null}
        {example.turns.map((turn,index)=><g key={index} className={`rr-collision-robot rr-collision-${kind}-${index}`} style={{"--rr-example-color":colors[index]}}>
            <g transform={`rotate(${turn})`}><GuideRobotSymbol centered size={44}/></g>
        </g>)}
        {kind==="wall"?<path className="rr-collision-blocked" d="M239 123V177"/>:null}
    </svg>;
}

class FieldExampleModal extends React.Component {
    constructor(props) {
        super(props);
        const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        this.state={paused:reduced,staticPreview:reduced,cycle:0,example:"priority"};
        this.dialogRef = React.createRef();
        this.handleKeyDown = this.handleKeyDown.bind(this);
    }

    componentDidUpdate(previousProps) {
        if (this.props.open && !previousProps.open) {
            const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            this.setState(current=>({paused:reduced,staticPreview:reduced,cycle:current.cycle+1,example:"priority"}));
            this.returnFocus = this.props.returnFocus || document.activeElement;
            this.previousOverflow = document.body.style.overflow;
            document.body.style.overflow = "hidden";
            document.addEventListener("keydown", this.handleKeyDown);
            requestAnimationFrame(() => {
                const close = this.dialogRef.current && this.dialogRef.current.querySelector(".guide-close");
                if (close) close.focus();
            });
        } else if (!this.props.open && previousProps.open) this.releaseModal();
    }

    componentWillUnmount() { if (this.props.open) this.releaseModal(); }

    releaseModal() {
        document.removeEventListener("keydown", this.handleKeyDown);
        document.body.style.overflow = this.previousOverflow || "";
        if (this.returnFocus && document.contains(this.returnFocus)) this.returnFocus.focus();
    }

    handleKeyDown(event) {
        if (event.key === "Escape") { event.preventDefault(); this.props.onClose(); return; }
        if (event.key !== "Tab" || !this.dialogRef.current) return;
        const focusable = [...this.dialogRef.current.querySelectorAll("button:not([disabled]), [tabindex]:not([tabindex='-1'])")];
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    render() {
        if (!this.props.open) return null;
        const collisions=this.props.kind==="collisions";
        const example=COLLISION_EXAMPLES.find(item=>item.id===this.state.example);
        return <div className="guide-backdrop conveyor-guide-backdrop" onClick={(event) => event.target === event.currentTarget && this.props.onClose()}>
            <section className="guide-modal conveyor-guide-modal" role="dialog" aria-modal="true" aria-labelledby="conveyor-guide-title" ref={this.dialogRef}>
                <header className="guide-modal-header conveyor-guide-header"><div><h2 id="conveyor-guide-title">{collisions?"Столкновения и приоритет":"Как поворачивают конвейеры"}</h2></div>
                    <button type="button" className="guide-close" aria-label={collisions?"Закрыть примеры столкновений":"Закрыть подсказку о конвейерах"} onClick={this.props.onClose}>×</button></header>
                <div className="guide-modal-content conveyor-guide-content">
                    {collisions?<div className="rr-collision-choices" role="group" aria-label="Пример столкновения">{COLLISION_EXAMPLES.map(item=><button key={item.id} type="button" aria-pressed={this.state.example===item.id}
                        onClick={()=>this.setState(current=>({example:item.id,cycle:current.cycle+1}))}>{item.title}</button>)}</div>:null}
                    <div className="rr-conveyor-controls"><p>{collisions?"Команды одного регистра выполняются по очереди.":"Один поворот, два способа въезда. Смотрите на нос робота."}</p>
                        <div><button type="button" aria-pressed={this.state.paused}
                            onClick={()=>this.setState(current=>({paused:!current.paused,staticPreview:false}))}>{this.state.paused?"Продолжить":"Пауза"}</button>
                            <button type="button" onClick={()=>this.setState(current=>({cycle:current.cycle+1,staticPreview:false}))}>Сначала</button></div></div>
                    {collisions?<div className="rr-collision-example" data-paused={this.state.paused} data-static={this.state.staticPreview} key={this.state.cycle}>
                        <CollisionDemoBoard kind={example.id}/>
                        <div className="rr-collision-copy"><h3>{example.heading}</h3>
                            <div className="rr-collision-commands">{example.commands.map((command,index)=><span key={index}
                                className={index?"rr-collision-command-second":"rr-collision-command-first"}>Вперёд {command.steps} <b>{command.priority}</b></span>)}</div>
                            <p>{example.text}</p>
                            {example.note?<p className="rr-collision-note">{example.note}</p>:null}
                        </div>
                    </div>:<div className="conveyor-demo-grid" data-paused={this.state.paused} data-static={this.state.staticPreview} key={this.state.cycle}>
                        <article><div className="conveyor-demo-verdict yes">С ПОВОРОТОМ</div><h3>По ленте на изгиб</h3>
                            <ConveyorDemoCommand steps={1} priority={570}/>
                            <div className="conveyor-demo-stage"><ConveyorDemoBoard kind="belt"/></div>
                            <p>Карта делает один шаг до ленты. Затем лента привозит робота на изгиб и поворачивает вправо на 90°. На этом движение закончено.</p></article>
                        <article><div className="conveyor-demo-verdict no">БЕЗ ПОВОРОТА</div><h3>Картой на изгиб</h3>
                            <ConveyorDemoCommand steps={2} priority={680}/>
                            <div className="conveyor-demo-stage"><ConveyorDemoBoard kind="card"/></div>
                            <p>Карта делает два шага до изгиба. Затем лента сдвигает робота вправо, но нос остаётся направлен вверх.</p></article>
                    </div>}
                    <p className="rr-conveyor-note">{collisions?"Это примеры движения по картам. Конвейеры двигают роботов одновременно и не толкают их друг в друга.":"На слиянии действует то же правило: связанная боковая ветвь поворачивает корпус, прямой вход сохраняет направление."}</p>
                </div>
            </section>
        </div>;
    }
}

function MemberHostControls({state, userId}) {
    const isHost = state.userId === state.hostId;
    if (!isHost || userId === state.userId) return null;
    const isPlayer = state.playerSlots.includes(userId);
    const removeLabel = isPlayer ? "Перевести в зрители" : "Удалить зрителя";
    return <span className="member-host-controls">
        {state.onlinePlayers.includes(userId) ? <button type="button" className="member-admin-button" title="Передать хоста" aria-label="Передать хоста"
            onClick={(evt) => window.commonRoom.handleGiveHost(userId, evt)}><i className="material-icons member-admin-glyph" aria-hidden="true">vpn_key</i></button> : null}
        <button type="button" className="member-admin-button" title={removeLabel} aria-label={removeLabel}
            onClick={(evt) => window.commonRoom.handleRemovePlayer(userId, evt)}><i className="material-icons member-admin-glyph" aria-hidden="true">{isPlayer ? "person_off" : "delete_forever"}</i></button>
    </span>;
}

class Lobby extends React.Component {
    render() {
        const {state, app} = this.props;
        const players = state.playerSlots.filter(Boolean);
        const online = state.onlinePlayers || [];
        const spectators = online.filter((userId) => !players.includes(userId));
        const isPlayer = players.includes(state.userId);
        const isHost = state.userId === state.hostId;
        const playerCount = players.length;
        const playerColors = state.playerColors || {};
        const robotColors = state.robotColors || LOBBY_ROBOT_COLORS;
        const colorFor = (userId) => playerColors[userId] || robotColors[Math.max(0, state.playerSlots.indexOf(userId))];
        const canStart = playerCount >= 2 && playerCount >= state.course.min && playerCount <= state.course.max;
        const missingPlayers = Math.max(2, state.course.min) - playerCount;
        const startHint = canStart ? (isHost ? "Курс и состав готовы — можно начинать" : "Все готовы к старту. Ожидаем хоста")
            : missingPlayers > 0 ? `Для старта нужно ещё игроков: ${missingPlayers}`
            : `На этом курсе максимум ${state.course.max} игроков. Выберите другой курс`;
        const usedColors = new Set(players.filter((userId) => userId !== state.userId)
            .map(colorFor));
        return <section className="lobby-shell lobby">
            <section className="lobby-intro rr-panel">
                <div className="lobby-intro-title"><div><h2>Лобби · {state.roomId}</h2>
                    <p>{isHost ? "Вы хост · " : ""}{isPlayer ? "Вы участвуете в заезде" : "Вы смотрите за подготовкой"}</p></div>
                    <div className="lobby-intro-links"><button type="button" className="lobby-guide-button" onClick={this.props.onOpenGuide}>Как играть</button>
                    <button type="button" className="lobby-settings-button" onClick={this.props.onOpenSettings}>⚙ Настройки</button></div></div>
                <div className="lobby-primary-actions"><div className="role-actions" aria-label="Роль в комнате">
                        <button className={`lobby-role-button ${isPlayer ? "current-role" : "primary"}`} disabled={isPlayer || playerCount >= 8}
                            onClick={() => app.socket.emit("join-game")}>
                            {isPlayer ? "Вы в игре ✓" : "Присоединиться к игре"}</button>
                        <button className={`lobby-role-button ${!isPlayer ? "current-role" : ""}`} disabled={!isPlayer}
                            onClick={() => app.socket.emit("spectators-join")}>{isPlayer ? "Стать зрителем" : "Вы зритель"}</button>
                    </div>
                    <section className="lobby-start">
                        {isHost ? <button className="primary" aria-describedby="rr-lobby-next-step" disabled={!canStart} onClick={() => app.socket.emit("start-game")}>Начать игру</button>
                            : <span className="lobby-start-placeholder">Игру начнёт хост</span>}
                    </section>
                </div>
                <p className="rr-lobby-next-step" id="rr-lobby-next-step" role="status">{startHint}</p>
            </section>
            <section className="lobby-members rr-panel">
                <div className="member-column"><h3>Игроки <small>{playerCount}/8</small></h3>
                    {players.length ? players.map((userId) => <div className="lobby-member" key={userId}>
                        <i className="lobby-robot-color" style={{background: colorFor(userId)}}></i>
                        <span><PlayerName data={state} id={userId}/> {userId === state.hostId ? <small>хост</small> : null}</span>
                        <MemberHostControls state={state} userId={userId}/>
                        <em>старт {((state.startAssignments || {})[userId] ?? 0) + 1}</em>
                        {userId === state.userId ? <b>вы</b> : null}
                    </div>) : <p className="empty-members">Пока никто не присоединился.</p>}
                </div>
                <div className="member-column"><h3>Зрители <small>{spectators.length}</small></h3>
                    {spectators.length ? spectators.map((userId) => <div className="lobby-member spectator" key={userId}>
                        <span><PlayerName data={state} id={userId}/> {userId === state.hostId ? <small>хост</small> : null}</span>
                        <MemberHostControls state={state} userId={userId}/>
                        {userId === state.userId ? <b>вы</b> : null}
                    </div>) : <p className="empty-members">Нет зрителей.</p>}
                </div>
                {isPlayer ? <div className="color-picker"><h3>Цвет вашего робота</h3>
                    <div>{robotColors.map((color) => <button type="button" key={color}
                        className={colorFor(state.userId) === color ? "selected" : ""}
                        style={{"--swatch": color}} disabled={usedColors.has(color)}
                        title={usedColors.has(color) ? "Цвет занят" : "Выбрать цвет"}
                        aria-label={`Цвет ${color}`} aria-pressed={colorFor(state.userId) === color} onClick={() => app.socket.emit("select-color", color)}>{colorFor(state.userId) === color ? "✓" : ""}</button>)}</div>
                </div> : null}
            </section>
            <CourseSetup state={state} app={app} playerCount={playerCount} readOnly={!isHost}/>
        </section>;
    }
}

class GameOptionNumber extends React.Component {
    constructor(props) {
        super(props);
        this.state = {draft: String(props.value == null ? props.fallback : props.value)};
        this.commit = this.commit.bind(this);
    }

    componentDidUpdate(previousProps) {
        if (previousProps.value !== this.props.value && this.props.value !== null)
            this.setState({draft: String(this.props.value)});
    }

    commit() {
        if (!this.props.editable || this.props.value === null) return;
        const number = Number(this.state.draft);
        if (Number.isSafeInteger(number) && number > 0) this.props.onChange(number);
        else this.setState({draft: String(this.props.value)});
    }

    render() {
        const {value, fallback, editable, unit, label, onChange} = this.props;
        if (!editable) return <strong className="rr-option-value">{value === null ? (unit ? "Без таймера" : "∞") : `${value}${unit}`}</strong>;
        return <span className="rr-option-number">
            <button type="button" className={value !== null ? "selected" : ""} aria-pressed={value !== null}
                title={unit ? "Использовать таймер в секундах" : "Использовать ограничение жизней"}
                onClick={() => {
                    const draft = Number(this.state.draft);
                    onChange(Number.isSafeInteger(draft) && draft > 0 ? draft : fallback);
                }}>{unit ? "Секунды" : "Число"}</button>
            <input type="number" min="1" step="1" inputMode="numeric" aria-label={label}
                disabled={value === null} value={this.state.draft}
                onChange={(event) => this.setState({draft: event.target.value})} onBlur={this.commit}
                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}/>
            {unit ? <span>{unit}</span> : null}
            <button type="button" className={value === null ? "selected" : ""} aria-pressed={value === null}
                title={unit ? "Отключить таймер последнего игрока" : "Сделать жизни бесконечными для всех"}
                onClick={() => onChange(null)}>{unit ? "Без таймера" : "∞"}</button>
        </span>;
    }
}

function GameSettingsContent({state, app}) {
    const options = state.gameOptions || {startingLives: 3, lastPlayerSeconds: 30, powerDownMode: "classic", finishAllFlags: false};
    const editable = state.userId === state.hostId;
    const setOption = (key, setting) => app.socket.emit("set-game-option", {key, setting});
    const classicHelp = "Classic: объявите Перезагрузка вместе с программой; текущий раунд выполняется полностью, робот отключится в следующем.";
    const simpleHelp = "Simple: вместо программы подтвердите Перезагрузка; робот отключится уже в текущем раунде.";
    return <div className="rr-game-options">
        <div className="rr-game-options-body">
            <div className="rr-option-row"><div className="rr-option-name"><strong>Жизни</strong>
                <span className="rr-option-help" tabIndex="0" title="Число жизней у робота в начале партии. При уменьшении лимита текущие жизни обрезаются; увеличение их не восстанавливает. ∞ сразу даёт всем бесконечные жизни и выключает ручную правку. При числовом лимите хост может менять жизни любого игрока через кнопку ♥." aria-label="Пояснение к числу жизней">ⓘ</span></div>
                <GameOptionNumber value={options.startingLives} fallback={3} editable={editable} label="Число жизней"
                    unit="" onChange={(setting) => setOption("startingLives", setting)}/></div>
            <div className="rr-option-row"><div className="rr-option-name"><strong>Последний игрок</strong>
                <span className="rr-option-help" tabIndex="0" title="Когда готовыми стали все, кроме одного, запускается этот таймер. Выкл: можно отменять готовность, пока не готовы все." aria-label="Пояснение к таймеру">ⓘ</span></div>
                <GameOptionNumber value={options.lastPlayerSeconds} fallback={30} editable={editable} label="Таймер последнего игрока, секунд"
                    unit="с" onChange={(setting) => setOption("lastPlayerSeconds", setting)}/></div>
            <div className="rr-option-row rr-option-power"><div className="rr-option-name"><strong>Перезагрузка</strong>
                <span className="rr-option-help" tabIndex="0" title={`${classicHelp} ${simpleHelp} Доступен повреждённому роботу.`} aria-label="Пояснение к режимам Перезагрузка">ⓘ</span></div>
                <div className="rr-option-modes" role="group" aria-label="Режим Перезагрузка">
                    {["classic", "simple"].map((mode) => <button key={mode} type="button"
                        className={options.powerDownMode === mode ? "selected" : ""} aria-pressed={options.powerDownMode === mode}
                        title={mode === "classic" ? classicHelp : simpleHelp} disabled={!editable}
                        onClick={() => setOption("powerDownMode", mode)}>{mode}</button>)}
                </div></div>
            <div className="rr-option-row"><div className="rr-option-name"><strong>Доиграть флаги</strong>
                <span className="rr-option-help" tabIndex="0" title="После первого финиша остальные роботы продолжают игру. Финишировавший робот больше не участвует. Игра завершится, когда все оставшиеся соберут флаги или останется один выживший." aria-label="Пояснение к доигрыванию флагов">ⓘ</span></div>
                <div className="rr-option-modes" role="group" aria-label="Завершение игры после флагов">
                    <button type="button" className={!options.finishAllFlags ? "selected" : ""} aria-pressed={!options.finishAllFlags}
                        disabled={!editable} onClick={() => setOption("finishAllFlags", false)}>Первый финиш</button>
                    <button type="button" className={options.finishAllFlags ? "selected" : ""} aria-pressed={!!options.finishAllFlags}
                        disabled={!editable} onClick={() => setOption("finishAllFlags", true)}>Доиграть всем</button>
                </div></div>
            <p className="rr-options-effective">{state.phase === "lobby" ? "Настройки сохраняются для этой комнаты." : "Лимит жизней, таймер и флаги — сразу; режим Перезагрузка — со следующего раунда."}</p>
        </div>
    </div>;
}

function GameSettingsModal({open, state, app, onClose, returnFocus}) {
    const dialogRef = React.useRef(null);
    React.useEffect(() => {
        if (!open) return undefined;
        const oldOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const close = dialogRef.current && dialogRef.current.querySelector(".rr-settings-close");
        if (close) close.focus();
        const onKeyDown = (event) => {
            if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
            if (event.key !== "Tab" || !dialogRef.current) return;
            const elements = [...dialogRef.current.querySelectorAll("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])")];
            if (!elements.length) return;
            const first = elements[0];
            const last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
            document.removeEventListener("keydown", onKeyDown, true);
            document.body.style.overflow = oldOverflow;
            if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
        };
    }, [open, onClose, returnFocus]);
    if (!open) return null;
    return <div className="rr-settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <section className="rr-settings-modal rr-panel" role="dialog" aria-modal="true" aria-labelledby="rr-settings-title" ref={dialogRef}>
            <header><h2 id="rr-settings-title">Настройки игры</h2><button type="button" className="rr-settings-close" aria-label="Закрыть настройки" onClick={onClose}>×</button></header>
            <GameSettingsContent state={state} app={app}/>
        </section>
    </div>;
}

const EDITOR_ART = "/roborace/assets/editor/";
const EDITOR_DIRECTIONS = ["north", "east", "south", "west"];
const EDITOR_TOOLS = [["conveyor","Конвейер"],["pit","Яма"],["wall","Стена"],["laser","Лазер"],
    ["pusher","Толкатель"],["gear","Шестерня"],["repair","Ремонт"],["flag","Флаг"],["erase","Ластик"]];

function EditorToolIcon({tool, gearTurn = 1, express = false}) {
    const sprite = tool === "conveyor" ? (express ? "express-straight" : "belt-straight")
        : tool === "gear" ? (gearTurn === 1 ? "gear-right" : "gear-left") : tool;
    return <span className="rr-editor-tool-icon rr-editor-tool-sprite" aria-hidden="true"
        style={{backgroundImage: `url(${EDITOR_ART}${sprite}.svg)`}}/>;
}

function customCellStyle(x, y, rows = 12) {
    return {left: `${x / 12 * 100}%`, top: `${y / rows * 100}%`, width: `${100 / 12}%`, height: `${100 / rows}%`};
}

let arenaArtInstance = 0;
function CustomFactoryArt({features}) {
    if (!features) return null;
    const starts = features.starts || [];
    const rows = features.fullField ? 16 : 12;
    const signature = JSON.stringify([features, rows === 16 ? starts : []]);
    const svg = React.useMemo(() => RaceArt.render(features,
        {rows, starts: rows === 16 ? starts : [], beams:false, id: "custom-" + (++arenaArtInstance)}), [signature]);
    return <div className={`rr-custom-factory ${rows === 16 ? "rr-custom-full-field" : ""}`}
        aria-hidden="true" dangerouslySetInnerHTML={{__html: svg}}/>;
}

function FlagMarker({number, className = "", style, isNext=false}) {
    return <span className={`flag ${className}${isNext ? " race-flag-next" : ""}`} data-number={number} style={style}
        title={`Контрольная точка ${number} · ремонт и восстановление${isNext ? " · следующая цель вашего робота" : ""}`}>
        <svg className="race-flag-icon" viewBox="0 0 100 100" aria-hidden="true"
            dangerouslySetInnerHTML={{__html:RaceArt.checkpointMarkup(number)}}/>
    </span>;
}

function BoardCheckpoints({state}) {
    const stats=state.historyReview&&!state.historyReview.actual&&state.historyReview.playerStats
        ?state.historyReview.playerStats[state.userId]:state.playerStats?.[state.userId];
    const active=(state.playerSlots||[]).includes(state.userId)&&stats&&!stats.finished&&stats.lives>0&&state.phase!=="finished";
    const nextNumber=active?(stats.checkpoints||0)+1:null;
    return <React.Fragment>{state.flags.filter(flag=>flag.x!=null&&flag.y!=null).map(flag=><FlagMarker
        key={flag.number} number={flag.number} isNext={flag.number===nextNumber}
        style={{left:`${(flag.x+.5)/12*100}%`,top:`${(flag.y+.5)/16*100}%`}}/>)}</React.Fragment>;
}

function ArchiveSymbol(){
    return <svg className="rr-recovery-symbol" viewBox="0 0 24 24" aria-hidden="true">
        <ellipse className="rr-recovery-shadow" cx="12" cy="22" rx="5" ry="1.2"/>
        <path className="rr-recovery-pin" d="M12 21.5S4.5 15 4.5 9a7.5 7.5 0 1 1 15 0c0 6-7.5 12.5-7.5 12.5Z"/>
        <circle className="rr-recovery-core" cx="12" cy="9" r="2.7"/>
    </svg>;
}

const BOARD_VIEW_STORAGE_KEY = "roborace-board-view-angle";

function boardViewClass(angle) {
    return `rr-view-frame${angle % 180 ? " rr-view-landscape" : ""}`;
}

function boardViewStyle(angle) {
    return {"--rr-view-angle": `${angle}deg`};
}

// Return coordinates in the unchanged 12×16 field, regardless of its screen rotation.
function boardPointFromView(element, angle, clientX, clientY) {
    const rect = element.getBoundingClientRect();
    const u = (clientX - rect.left - element.clientLeft) / element.clientWidth;
    const v = (clientY - rect.top - element.clientTop) / element.clientHeight;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    const [x, y] = angle === 90 ? [v, 1 - u] : angle === 180 ? [1 - u, 1 - v]
        : angle === 270 ? [1 - v, u] : [u, v];
    return {fx: Math.min(12 - 1e-6, x * 12), fy: Math.min(16 - 1e-6, y * 16)};
}

function BoardViewControls({app}) {
    const angle = app.boardViewAngle();
    const automatic = app.state.boardViewChoice === null;
    return <div className="rr-view-controls" role="group" aria-label="Повернуть вид поля">
        <button type="button" aria-label="Повернуть вид против часовой стрелки" title="Повернуть вид против часовой стрелки"
            onClick={() => app.rotateBoardView(-90)}>↺</button>
        <span>{angle}°</span>
        <button type="button" aria-label="Повернуть вид по часовой стрелке" title="Повернуть вид по часовой стрелке"
            onClick={() => app.rotateBoardView(90)}>↻</button>
        <button type="button" className={automatic ? "selected" : ""} aria-label="Автоматический ракурс поля"
            aria-pressed={automatic} title="Авто: на широком экране старт слева, на узком снизу"
            onClick={() => app.resetBoardViewAngle()}>Авто</button>
    </div>;
}

const DOCK_EDGES = {left: "Слева", right: "Справа", top: "Сверху", bottom: "Снизу"};

function dockEdgeAt(clientX, clientY) {
    const horizontal = Math.min(clientX, window.innerWidth - clientX) / window.innerWidth;
    const vertical = Math.min(clientY, window.innerHeight - clientY) / window.innerHeight;
    const edge = horizontal < vertical ? (clientX < window.innerWidth / 2 ? "left" : "right")
        : clientY < window.innerHeight / 2 ? "top" : "bottom";
    return window.innerWidth <= 760 && edge === "left" ? "top"
        : window.innerWidth <= 760 && edge === "right" ? "bottom" : edge;
}

function DockPlacementControl({app, panel, effectivePosition}) {
    const name = panel === "info" ? "информационную панель" : "панель программирования";
    return <button type="button" className="rr-dock-placement rr-dock-drag-handle"
        aria-label={`Перетащить ${name}`}
        title={`Перетащить ${name} · сейчас ${DOCK_EDGES[effectivePosition].toLowerCase()}`}
        onPointerDown={(event) => app.beginDockPointerDrag(panel, event)}
        onPointerMove={(event) => app.moveDockPointerDrag(event)}
        onPointerUp={(event) => app.endDockPointerDrag(event)}
        onPointerCancel={(event) => app.endDockPointerDrag(event, true)}>⠿</button>;
}

function CourseFieldContents({course, state, flagClassName, showLobbyRobots = false}) {
    const assignments = state.startAssignments || {};
    const startPositions = (course.customFeatures || state.boardTemplates?.[course.board]?.features)?.starts || [];
    const players = (state.playerSlots || []).filter(Boolean);
    return <React.Fragment>
        {course.customFeatures ? <div className={`course-thumbnail-factory ${course.customFeatures.fullField ? "rr-full-field" : ""}`}>
            <CustomFactoryArt features={course.customFeatures}/></div>
            : <img className="course-thumbnail-factory" draggable="false" style={{transform: `rotate(${course.rotation || 0}deg)`}}
                src={boardImageUrl(state, course.board)}/>}
        {!course.customFeatures?.fullField ? <img className="course-thumbnail-start" draggable="false"
            src={boardImageUrl(state, course.board)}/>
            : null}
        {(course.flags || []).map(([x, y], index) => <FlagMarker className={flagClassName || ""} key={`${x}-${y}-${index}`} number={index+1}
            style={{left: `${(x + .5) / 12 * 100}%`, top: `${(y + .5) / 16 * 100}%`}}/>)}
        {showLobbyRobots ? <div className="board-overlay">{players.map((userId) => {
            const start = assignments[userId];
            const position = startPositions[start];
            if (!position) return null;
            const color = (state.playerColors || {})[userId] || (state.robotColors || LOBBY_ROBOT_COLORS)[start];
            return <Robot key={userId} state={state} ownUserId={state.userId}
                robot={{...position,userId,color,direction:"north"}}/>;
        })}</div> : null}
        <FieldLaserOverlay features={course.customFeatures||state.boardTemplates?.[course.board]?.features} rotation={course.customFeatures?0:course.rotation||0}/>
    </React.Fragment>;
}

function emptyEditableFeatures(startLayout) {
    return {...RaceField.geometry(startLayout || RaceField.emptyGeometry()),fullField:true};
}

function cloneEditableFeatures(features) {
    return JSON.parse(JSON.stringify(features));
}

function withEditableStart(features, startLayout) {
    const next = emptyEditableFeatures(startLayout);
    const onFactory = key => keyPoint(key)[1] < 12;
    for (const key of ["pits","repairs","express","walls"]) next[key].push(...features[key].filter(onFactory));
    for (const key of ["gears","conveyors"]) Object.assign(next[key],Object.fromEntries(Object.entries(features[key]).filter(([cell]) => onFactory(cell))));
    for (const key of ["lasers","pushers"]) next[key].push(...features[key].filter(item => item.y < 12));
    for (const key of ["hintConnections","conveyorConnections"]) next[key].push(...(features[key] || []).filter(link => link.split("|").every(onFactory)));
    next.conveyorConnections.push(...RaceField.inferConnections(next,true));
    return next;
}

function rotateEditableFactory(features, flags, clockwise) {
    const amount = clockwise ? 1 : 3;
    const point = (x,y) => y >= 12 ? [x,y] : clockwise ? [11-y,x] : [y,11-x];
    const key = (value) => point(...keyPoint(value)).join(",");
    const direction = (value) => EDITOR_DIRECTIONS[(EDITOR_DIRECTIONS.indexOf(value)+amount)%4];
    const connection = (value) => value.split("|").map(key).join("|");
    const sameSection = (value) => {
        const [from,to] = value.split("|");
        return (keyPoint(from)[1] < 12) === (keyPoint(to)[1] < 12);
    };
    const next = {...cloneEditableFeatures(features),
        pits: features.pits.map(key), repairs: features.repairs.map(key), express: features.express.map(key),
        gears: Object.fromEntries(Object.entries(features.gears).map(([cell,turn]) => [key(cell),turn])),
        conveyors: Object.fromEntries(Object.entries(features.conveyors).map(([cell,facing]) =>
            [key(cell),keyPoint(cell)[1] < 12 ? direction(facing) : facing])),
        walls: features.walls.map((wall) => {
            const [x,y,facing] = wall.split(",");
            const [nx,ny] = point(Number(x),Number(y));
            return `${nx},${ny},${Number(y) < 12 ? direction(facing) : facing}`;
        }),
        lasers: features.lasers.map((laser) => {
            const [x,y] = point(laser.x,laser.y);
            return {...laser,x,y,direction:laser.y < 12 ? direction(laser.direction) : laser.direction};
        }),
        pushers: features.pushers.map((pusher) => {
            const [x,y] = point(pusher.x,pusher.y);
            return {...pusher,x,y,direction:pusher.y < 12 ? direction(pusher.direction) : pusher.direction};
        }),
        hintConnections: (features.hintConnections || []).filter(sameSection).map(connection),
        conveyorConnections: (features.conveyorConnections || []).filter(sameSection).map(connection)};
    Object.entries(next.conveyors).forEach(([from,facing]) => {
        const [x,y] = keyPoint(from), [dx,dy] = FIELD_VECTORS[facing], targetY = y+dy;
        if (!((y === 11 && targetY === 12) || (y === 12 && targetY === 11))) return;
        const to = `${x+dx},${targetY}`;
        if (!next.conveyors[to] || next.conveyors[to] === OPPOSITE_DIRECTION[facing]) return;
        const boundary = physicalWallId(`${from},${facing}`);
        if (next.walls.some((wall) => physicalWallId(wall) === boundary)) return;
        const link = `${from}|${to}`;
        if (!next.conveyorConnections.includes(link)) next.conveyorConnections.push(link);
    });
    return {features: next, flags: flags.map(([x,y]) => point(x,y))};
}

function validateFieldImport(payload, state) {
    const field = RaceField.read(payload);
    return {name:field.name,start:state.startCards[0],
        sourceBoard:Object.hasOwn(state.boardTemplates || {},field.name) ? field.name : "",
        rotation:field.rotation || 0,features:{...field.features,fullField:true},flags:field.routes[0].flags};
}

function editorCellWithoutDevice(features, key) {
    features.pits = features.pits.filter((item) => item !== key);
    features.repairs = features.repairs.filter((item) => item !== key);
    features.express = features.express.filter((item) => item !== key);
    delete features.gears[key];
    delete features.conveyors[key];
    features.conveyorConnections = (features.conveyorConnections || []).filter((entry) => {
        const [from,to] = entry.split("|");
        return from !== key && to !== key;
    });
    const [x,y] = keyPoint(key);
    features.lasers = features.lasers.filter((item) => item.x !== x || item.y !== y);
    features.pushers = features.pushers.filter((item) => item.x !== x || item.y !== y);
}

function editorRemoveConnectionsAcrossWall(features, wall) {
    const boundary = physicalWallId(wall);
    features.conveyorConnections = (features.conveyorConnections || []).filter((entry) => {
        const [from,to] = entry.split("|");
        const [x,y] = keyPoint(from), [tx,ty] = keyPoint(to);
        const direction = EDITOR_DIRECTIONS.find((candidate) => {
            const [dx,dy] = FIELD_VECTORS[candidate];
            return x+dx === tx && y+dy === ty;
        });
        return !direction || physicalWallId(`${from},${direction}`) !== boundary;
    });
}

function editorRemoveWalls(features, boundaries) {
    features.walls = features.walls.filter((wall) => !boundaries.has(physicalWallId(wall)));
    features.lasers = features.lasers.filter((laser) =>
        !boundaries.has(physicalWallId(`${laser.x},${laser.y},${OPPOSITE_DIRECTION[laser.direction]}`)));
    features.pushers = features.pushers.filter((pusher) =>
        !boundaries.has(physicalWallId(`${pusher.x},${pusher.y},${OPPOSITE_DIRECTION[pusher.direction]}`)));
}

class FieldEditorModal extends React.Component {
    constructor(props) {
        super(props);
        const course = props.state.course;
        const start = course.start || props.state.startCards[0];
        const sourceFeatures = course.customFeatures ? cloneEditableFeatures(course.customFeatures)
            : emptyEditableFeatures(props.state.startTemplates?.[start]);
        const initial = {name: course.customFeatures ? course.name : "Моё поле",
            start,
            sourceBoard: course.customFeatures && Object.hasOwn(props.state.boardTemplates || {},course.board) ? course.board : "",
            rotation: course.editorRotation || 0,
            features: sourceFeatures,
            flags: course.customFeatures ? course.flags.map((flag) => [...flag]) : [],
            tool: "conveyor", express: false, gearTurn: 1, laserCount: 1,
            notice: "",
            pusherRegisters: [1,3,5], drawing: [], history: [], future: []};
        this.state = props.draft ? {...props.draft, drawing: []} : initial;
        this.dialogRef = React.createRef();
        this.importRef = React.createRef();
        this.handleKeyDown = this.handleKeyDown.bind(this);
    }

    componentDidMount() {
        this.previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        document.addEventListener("keydown", this.handleKeyDown);
        requestAnimationFrame(() => this.dialogRef.current?.querySelector(".rr-editor-close")?.focus());
    }

    componentWillUnmount() {
        document.body.style.overflow = this.previousOverflow || "";
        document.removeEventListener("keydown", this.handleKeyDown);
        if (this.props.returnFocus && document.contains(this.props.returnFocus)) this.props.returnFocus.focus();
    }

    handleKeyDown(event) {
        if (event.key === "Escape") { event.preventDefault(); this.close(); return; }
        if ((event.ctrlKey || event.metaKey) && (event.code === "KeyZ" || event.code === "KeyY")) {
            if (["INPUT","TEXTAREA"].includes(event.target.tagName) && event.target.type !== "file") return;
            event.preventDefault();
            if (event.shiftKey || event.code === "KeyY") this.redo();
            else this.undo();
            return;
        }
        if (event.key !== "Tab" || !this.dialogRef.current) return;
        const focusable = [...this.dialogRef.current.querySelectorAll("button:not([disabled]),input,select")];
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    close() {
        this.props.onClose({...this.state, drawing: []});
    }

    fieldDocument() {
        return RaceField.read({format:"roborace-field",version:RaceField.VERSION,name:this.state.name,
            features:RaceField.geometry(this.state.features),rotation:this.state.rotation,
            routes:[{name:this.state.name,flags:this.state.flags}]});
    }

    exportField() {
        let payload;
        try { payload = this.fieldDocument(); }
        catch (error) { this.setState({notice:error.message}); return; }
        const blob = new Blob([JSON.stringify(payload,null,2)], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `RoboRace-${(this.state.name.trim() || "поле").replace(/[^a-zA-Z0-9А-Яа-яЁё-]+/g,"-")}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.setState({notice: "Поле экспортировано в JSON."});
    }

    async importField(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
            if (file.size > 256 * 1024) throw new Error("файл слишком большой");
            const imported = validateFieldImport(JSON.parse(await file.text()), this.props.state);
            this.commit(() => ({...imported, notice: "Поле импортировано. Проверьте его и выберите для игры."}));
        } catch (error) {
            this.setState({notice: `Импорт не выполнен: ${error instanceof SyntaxError ? "неверный JSON" : error.message}`});
        }
    }

    changeBoard(sourceBoard) {
        const document = this.props.state.boardTemplates?.[sourceBoard];
        if (document) {
            this.commit(() => ({sourceBoard,features:{...cloneEditableFeatures(document.features),fullField:true},flags:[],rotation:0}));
        } else this.clearBoard();
    }

    clearBoard() {
        this.commit((current) => ({sourceBoard: "", rotation: 0, flags: [],
            features: emptyEditableFeatures(this.props.state.startTemplates?.[current.start]),
            notice: "Поле очищено. Действие можно отменить."}));
    }

    rotateBoard(clockwise) {
        this.commit((current) => ({...rotateEditableFactory(current.features,current.flags,clockwise),
            rotation: (current.rotation + (clockwise ? 90 : 270)) % 360,
            notice: "Основа повернута; проверьте соединения у границы стартового поля."}));
    }

    changeStart(start) {
        const template = this.props.state.startTemplates?.[start];
        this.commit((current) => ({start, features: withEditableStart(current.features, template),
            flags: current.flags.filter(([x,y]) => !template?.starts.some((point) => point.x === x && point.y === y))}));
    }

    isFixedStart(point) {
        return this.state.features.starts.some((start) =>
            start.x === point.x && start.y === point.y);
    }

    editableCellBoundaries(point) {
        return new Set(EDITOR_DIRECTIONS.map((side) => physicalWallId(`${point.key},${side}`)));
    }

    commit(change) {
        this.setState((current) => {
            const next = change(current);
            if (!next) return null;
            return {...next, history: [...current.history, this.editSnapshot(current)].slice(-40), future: []};
        });
    }

    undo() {
        this.setState((current) => {
            if (!current.history.length) return null;
            const previous = current.history[current.history.length - 1];
            return {...previous, history: current.history.slice(0,-1),
                future: [...current.future, this.editSnapshot(current)]};
        });
    }

    redo() {
        this.setState((current) => {
            if (!current.future.length) return null;
            const next = current.future[current.future.length - 1];
            return {...next, future: current.future.slice(0,-1),
                history: [...current.history, this.editSnapshot(current)]};
        });
    }

    editSnapshot(current) {
        return {features:current.features,flags:current.flags,start:current.start,sourceBoard:current.sourceBoard,
            rotation:current.rotation,name:current.name};
    }

    point(event) {
        const point = boardPointFromView(event.currentTarget, this.props.app.boardViewAngle(), event.clientX, event.clientY);
        if (!point) return null;
        const {fx, fy} = point;
        const x = Math.floor(fx), y = Math.floor(fy);
        const edgeDistances = {north: fy - y, east: x + 1 - fx, south: y + 1 - fy, west: fx - x};
        const side = Object.entries(edgeDistances).sort((a,b) => a[1] - b[1])[0][0];
        return {x,y,side,edgeDistance: edgeDistances[side],key: `${x},${y}`};
    }

    beginDraw(event) {
        if (event.button !== 0) return;
        const point = this.point(event);
        if (!point || (this.isFixedStart(point) && this.state.tool !== "wall"
            && !(this.state.tool === "erase" && point.edgeDistance <= .18))) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        this.drag = {pointerId: event.pointerId, points: [point]};
        if (["conveyor","pit","erase"].includes(this.state.tool)) this.setState({drawing: [point.key]});
    }

    continueDraw(event) {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        if (!["conveyor","pit","erase"].includes(this.state.tool)) return;
        const point = this.point(event);
        if (!point || (this.isFixedStart(point) && this.state.tool !== "erase")) return;
        const points = this.drag.points;
        const last = points[points.length - 1];
        if (point.key === last.key) return;
        if (this.state.tool === "conveyor" && Math.abs(point.x-last.x)+Math.abs(point.y-last.y) !== 1) return;
        if (points.length > 1 && point.key === points[points.length - 2].key) points.pop();
        else if (!points.some((item) => item.key === point.key)) points.push(point);
        this.setState({drawing: points.map((item) => item.key)});
    }

    finishDraw(event) {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        const points = this.drag.points;
        this.drag = null;
        this.setState({drawing: []});
        if (!points.length) return;
        if (this.state.tool === "conveyor" && points.length > 1) {
            const existing = this.state.features;
            for (let index = 0; index < points.length - 1; index++) {
                const from = points[index], to = points[index+1];
                const direction = EDITOR_DIRECTIONS.find((candidate) => {
                    const [dx,dy] = FIELD_VECTORS[candidate];
                    return from.x+dx === to.x && from.y+dy === to.y;
                });
                if (!direction) {
                    this.setState({notice: "Ведите маршрут через соседние клетки."});
                    return;
                }
                if (existing.conveyors[from.key] && existing.conveyors[from.key] !== direction) {
                    this.setState({notice: "Через этот конвейер нельзя провести ленту поперёк его движения."});
                    return;
                }
                const boundary = physicalWallId(`${from.key},${direction}`);
                if (existing.walls.some((wall) => physicalWallId(wall) === boundary)) {
                    this.setState({notice: "Конвейер не может проходить сквозь стену."});
                    return;
                }
            }
        }
        if (this.state.tool === "pusher") {
            const point = points[0], facing = OPPOSITE_DIRECTION[point.side];
            const conflict = this.state.features.pushers.some((pusher) => pusher.x === point.x && pusher.y === point.y
                && pusher.direction !== facing
                && pusher.active.some((register) => this.state.pusherRegisters.includes(register)));
            if (conflict) {
                this.setState({notice: "Толкатели на одной клетке не могут срабатывать в одном регистре."});
                return;
            }
        }
        if (this.state.tool === "wall") {
            const point = points[0], wall = `${point.key},${point.side}`;
            const existed = this.state.features.walls.some((entry) => physicalWallId(entry) === physicalWallId(wall));
            if (!existed && wallBetweenPits(new Set(this.state.features.pits), wall)) {
                this.setState({notice: "Стена внутри ямы невозможна. Ставьте её только по внешнему краю."});
                return;
            }
        }
        if (this.state.tool === "conveyor" && points.length > 1) {
            const last = points[points.length-1], previous = points[points.length-2];
            const existing = this.state.features.conveyors[last.key];
            const incoming = EDITOR_DIRECTIONS.find((direction) => {
                const [dx,dy] = FIELD_VECTORS[direction];
                return previous.x + dx === last.x && previous.y + dy === last.y;
            });
            if (existing && existing === OPPOSITE_DIRECTION[incoming]) {
                this.setState({notice: "Здесь лента развернулась бы обратно. Измените точку слияния."});
                return;
            }
        }
        this.commit((current) => {
            const features = cloneEditableFeatures(current.features), flags = current.flags.map((flag) => [...flag]);
            const tool = current.tool;
            if (tool === "conveyor" || tool === "pit") {
                points.forEach((point, index) => {
                    if (tool === "conveyor" && points.length > 1
                        && features.conveyors[point.key]) return;
                    editorCellWithoutDevice(features, point.key);
                    if (tool === "pit") {
                        const flag = flags.findIndex(([x,y]) => `${x},${y}` === point.key);
                        if (flag >= 0) flags.splice(flag,1);
                        features.pits.push(point.key);
                        return;
                    }
                    const next = points[index + 1], previous = points[index - 1];
                    const neighbor = next || (previous ? {x: point.x * 2 - previous.x, y: point.y * 2 - previous.y} : null);
                    const direction = neighbor ? EDITOR_DIRECTIONS.find((candidate) => {
                        const [dx,dy] = FIELD_VECTORS[candidate];
                        return point.x + dx === neighbor.x && point.y + dy === neighbor.y;
                    }) : point.side;
                    features.conveyors[point.key] = direction || point.side;
                    if (current.express) features.express.push(point.key);
                });
                if (tool === "conveyor") points.slice(0,-1).forEach((point,index) => {
                    const connection = `${point.key}|${points[index+1].key}`;
                    if (!features.conveyorConnections.includes(connection)) features.conveyorConnections.push(connection);
                });
                if (tool === "pit") {
                    const pitCells = new Set(features.pits);
                    features.walls = features.walls.filter((wall) => !wallBetweenPits(pitCells, wall));
                }
            } else {
                const {x,y,key,side} = points[0];
                const facing = OPPOSITE_DIRECTION[side];
                if (tool === "flag") {
                    const index = flags.findIndex(([fx,fy]) => fx === x && fy === y);
                    if (index >= 0) flags.splice(index,1);
                    else if (flags.length < 8 && !features.pits.includes(key)) flags.push([x,y]);
                } else if (tool === "erase") {
                    if (points.length === 1) {
                        const boundary = physicalWallId(`${key},${side}`);
                        if (points[0].edgeDistance <= .18
                            && features.walls.some((wall) => physicalWallId(wall) === boundary))
                            editorRemoveWalls(features, new Set([boundary]));
                        else if (!this.isFixedStart(points[0])) {
                            editorCellWithoutDevice(features,key);
                            const index = flags.findIndex(([fx,fy]) => fx === x && fy === y);
                            if (index >= 0) flags.splice(index,1);
                        }
                    } else {
                        const boundaries = new Set();
                        points.forEach((point) => {
                            if (!this.isFixedStart(point)) editorCellWithoutDevice(features,point.key);
                            for (const boundary of this.editableCellBoundaries(point)) boundaries.add(boundary);
                            const index = this.isFixedStart(point) ? -1
                                : flags.findIndex(([fx,fy]) => fx === point.x && fy === point.y);
                            if (index >= 0) flags.splice(index,1);
                        });
                        editorRemoveWalls(features,boundaries);
                    }
                } else if (tool === "wall") {
                    const wall = `${key},${side}`, physical = physicalWallId(wall);
                    const existed = features.walls.some((entry) => physicalWallId(entry) === physical);
                    features.walls = features.walls.filter((entry) => physicalWallId(entry) !== physical);
                    if (!existed) {
                        features.walls.push(wall);
                        editorRemoveConnectionsAcrossWall(features, wall);
                    }
                } else if (tool === "repair" || tool === "gear") {
                    editorCellWithoutDevice(features,key);
                    if (tool === "repair") features.repairs.push(key);
                    else features.gears[key] = current.gearTurn;
                } else if (tool === "laser" || tool === "pusher") {
                    if (features.pits.includes(key)) return null;
                    const list = tool === "laser" ? features.lasers : features.pushers;
                    const existing = list.findIndex((item) => item.x === x && item.y === y && item.direction === facing);
                    if (existing >= 0) list.splice(existing,1);
                    list.push(tool === "laser" ? {x,y,direction:facing,count:current.laserCount}
                        : {x,y,direction:facing,active:[...current.pusherRegisters]});
                    const wall = `${key},${tool === "laser" ? OPPOSITE_DIRECTION[facing] : side}`;
                    if (!features.walls.some((entry) => physicalWallId(entry) === physicalWallId(wall))) features.walls.push(wall);
                    editorRemoveConnectionsAcrossWall(features, wall);
                }
            }
            return {features, flags, notice: ""};
        });
    }

    save() {
        if (!this.state.flags.length || this.state.flags.some(([x,y]) => this.state.features.pits.includes(`${x},${y}`)
            || this.isFixedStart({x,y}))) return;
        let payload;
        try { payload = this.fieldDocument(); }
        catch (error) { this.setState({notice:error.message}); return; }
        if (new TextEncoder().encode(JSON.stringify(payload)).length > 9000) {
            this.setState({notice: "Поле слишком большое для отправки в комнату. Уберите часть элементов."});
            return;
        }
        this.props.app.socket.emit("set-authored-course", payload);
        this.props.onClose(null);
    }

    render() {
        const {state} = this.props;
        const {features, flags} = this.state;
        const viewAngle = this.props.app.boardViewAngle();
        return <div className="rr-editor-backdrop" onClick={(event) => event.target === event.currentTarget && this.close()}>
            <section className="rr-editor-modal" role="dialog" aria-modal="true" aria-labelledby="rr-editor-title" ref={this.dialogRef}>
                <header className="rr-editor-heading"><div><h2 id="rr-editor-title">Редактор поля</h2><p>Нарисуйте маршрут конвейера или выберите элемент и щёлкните по клетке.</p></div>
                    <button type="button" className="rr-editor-close" aria-label="Закрыть редактор" onClick={() => this.close()}>×</button></header>
                <div className="rr-editor-topbar">
                    <label>Основа <select aria-label="Основа поля" value={this.state.sourceBoard} onChange={(event) => this.changeBoard(event.target.value)}>
                        <option value="">Пустое поле</option>{Object.keys(state.boardTemplates || {}).map((board) => <option value={board} key={board}>Копия: {board}</option>)}
                    </select></label>
                    <label>Название <input aria-label="Название своего поля" maxLength="50" value={this.state.name} onChange={(event) => this.setState({name: event.target.value})}/></label>
                    <label>Старт <select aria-label="Старт своего поля" value={this.state.start} onChange={(event) => this.changeStart(event.target.value)}>
                        {state.startCards.map((start, index) => <option value={start} key={start}>Старт {index + 1}</option>)}
                    </select></label>
                    <div className="rr-editor-rotation" title="Поворачивает основу 12×12; стартовые ряды остаются на месте">
                        <button type="button" aria-label="Повернуть основу против часовой стрелки" onClick={() => this.rotateBoard(false)}>↺</button>
                        <span>Основа {this.state.rotation}°</span>
                        <button type="button" aria-label="Повернуть основу по часовой стрелке" onClick={() => this.rotateBoard(true)}>↻</button>
                    </div>
                    <BoardViewControls app={this.props.app}/>
                    <button type="button" disabled={!this.state.history.length} onClick={() => this.undo()}>↶ Отменить</button>
                    <button type="button" disabled={!this.state.future.length} onClick={() => this.redo()}>↷ Повторить</button>
                    <button type="button" className="rr-editor-clear" onClick={() => this.clearBoard()}
                        title="Вернуть пустую основу и исходную стартовую карту; можно отменить">Очистить</button>
                </div>
                <div className="rr-editor-workspace">
                    <div className="rr-editor-palette" aria-label="Инструменты редактора">
                        {EDITOR_TOOLS.map(([tool,label]) => <button type="button" key={tool} className={this.state.tool === tool ? "selected" : ""}
                            aria-label={label} title={label} aria-pressed={this.state.tool === tool} onClick={() => this.setState({tool})}>
                            <EditorToolIcon tool={tool} gearTurn={this.state.gearTurn} express={this.state.express}/>
                            <span className="rr-editor-tool-label">{label}</span>
                        </button>)}
                    </div>
                    <div className="rr-editor-board-column">
                        <div className={`rr-editor-board ${boardViewClass(viewAngle)}`} style={boardViewStyle(viewAngle)}
                            role="img" aria-label="Редактируемое поле 12 на 16 клеток"
                            onPointerDown={(event) => this.beginDraw(event)} onPointerMove={(event) => this.continueDraw(event)}
                            onPointerUp={(event) => this.finishDraw(event)} onPointerCancel={() => { this.drag = null; this.setState({drawing: []}); }}>
                            <div className="rr-view-canvas"><div className="rr-editor-factory"><CustomFactoryArt features={features}/>
                                {flags.map(([x,y], index) => <FlagMarker key={`${x},${y}`} className="rr-editor-flag"
                                    number={index + 1} style={{left: `${(x+.5)/12*100}%`, top: `${(y+.5)/16*100}%`}}/>)}
                                {this.state.drawing.map((key) => {
                                    const [x,y] = keyPoint(key);
                                    return <i key={key} className="rr-editor-drawing" style={customCellStyle(x,y,16)}/>;
                                })}
                                <FieldLaserOverlay features={features}/>
                            </div></div>
                        </div>
                    </div>
                    <div className="rr-editor-inspector">
                        <h3>{EDITOR_TOOLS.find(([tool]) => tool === this.state.tool)?.[1] || "Инструмент"}</h3>
                        {this.state.tool === "conveyor" ? <React.Fragment><div className="rr-editor-edge-guide"><strong>Одна клетка: направление к выбранному краю</strong>
                            <span>Щёлкните ближе к краю, куда должна двигаться лента. Для маршрута проведите по соседним клеткам.</span></div>
                            <div className="rr-editor-variants" role="group" aria-label="Тип конвейера">
                                <button type="button" className={!this.state.express ? "selected" : ""} aria-pressed={!this.state.express}
                                    onClick={() => this.setState({express:false})}><EditorToolIcon tool="conveyor"/><span>Обычный</span></button>
                                <button type="button" className={this.state.express ? "selected" : ""} aria-pressed={this.state.express}
                                    onClick={() => this.setState({express:true})}><EditorToolIcon tool="conveyor" express/><span>Экспресс</span></button>
                            </div>
                            </React.Fragment> : null}
                        {this.state.tool === "laser" ? <React.Fragment><div className="rr-editor-edge-guide"><strong>Направление задаёт край клетки</strong>
                            <span>Щёлкните у нужного края: там появится стена, а луч пойдёт от неё внутрь. Правый край → влево.</span></div>
                            <label>Лучей <select value={this.state.laserCount} onChange={(event) => this.setState({laserCount:Number(event.target.value)})}>
                                {[1,2,3].map((count) => <option value={count} key={count}>{count}</option>)}</select></label></React.Fragment> : null}
                        {this.state.tool === "pusher" ? <div><p>Работает в регистрах:</p><div className="rr-editor-registers">{[1,2,3,4,5].map((register) =>
                            <button type="button" key={register} className={this.state.pusherRegisters.includes(register) ? "selected" : ""}
                                aria-pressed={this.state.pusherRegisters.includes(register)} onClick={() => this.setState((current) => ({pusherRegisters:
                                    current.pusherRegisters.includes(register) ? current.pusherRegisters.length > 1 ? current.pusherRegisters.filter((value) => value !== register) : current.pusherRegisters
                                        : [...current.pusherRegisters,register].sort()}))}>{register}</button>)}</div></div> : null}
                        {this.state.tool === "gear" ? <div className="rr-editor-variants" role="group" aria-label="Направление шестерни">
                            <button type="button" className={this.state.gearTurn === 1 ? "selected" : ""} aria-label="По часовой стрелке"
                                title="По часовой стрелке" aria-pressed={this.state.gearTurn === 1} onClick={() => this.setState({gearTurn:1})}>
                                <EditorToolIcon tool="gear"/><span>↻ По часовой</span></button>
                            <button type="button" className={this.state.gearTurn === -1 ? "selected" : ""} aria-label="Против часовой стрелки"
                                title="Против часовой стрелки" aria-pressed={this.state.gearTurn === -1} onClick={() => this.setState({gearTurn:-1})}>
                                <EditorToolIcon tool="gear" gearTurn={-1}/><span>↺ Против</span></button>
                        </div> : null}
                        {this.state.tool === "wall" ? <div className="rr-editor-edge-guide"><strong>Стена появится на выбранном краю</strong>
                            <span>Щёлкните ближе к нужной стороне клетки.</span></div> : null}
                        {this.state.tool === "pusher" ? <div className="rr-editor-edge-guide"><strong>Толкатель крепится к стене</strong>
                            <span>Щёлкните у края клетки: там появится стена, а толкатель будет двигать от неё внутрь клетки.</span></div> : null}
                        {this.state.tool === "erase" ? <div className="rr-editor-edge-guide"><strong>Клик или выделение</strong>
                            <span>Щёлкните по стене, чтобы удалить только её. Проведите по нескольким клеткам, чтобы очистить их целиком.</span></div> : null}
                        <div className="rr-editor-flags">
                            <h3>Флаги · {flags.length}/8</h3>{flags.map(([x,y], index) => <div key={`${x},${y}`}>
                            <span>{index+1}. ({x+1}, {y+1})</span>
                            <button type="button" disabled={!index} aria-label={`Поднять флаг ${index+1}`} onClick={() => this.commit((current) => {
                                const next = current.flags.map((flag) => [...flag]); [next[index-1],next[index]]=[next[index],next[index-1]]; return {flags:next};
                            })}>↑</button>
                            <button type="button" aria-label={`Удалить флаг ${index+1}`} onClick={() => this.commit((current) => ({flags:current.flags.filter((_,position) => position !== index)}))}>×</button>
                        </div>)}</div>
                    </div>
                </div>
                <footer className="rr-editor-footer"><span role="status">{this.state.notice || (flags.length ? "Поле готово к выбору" : "Поставьте хотя бы один флаг")}</span>
                    <input ref={this.importRef} className="rr-editor-file-input" type="file" accept=".json,application/json"
                        aria-label="Файл поля для импорта" onChange={(event) => this.importField(event)}/>
                    <button type="button" onClick={() => this.importRef.current?.click()} title="Загрузить поле из JSON">Импорт JSON</button>
                    <button type="button" onClick={() => this.exportField()} title="Скачать поле в JSON">Экспорт JSON</button>
                    <button type="button" onClick={() => this.close()}>Закрыть</button>
                    <button type="button" className="primary" disabled={!flags.length || flags.some(([x,y]) => features.pits.includes(`${x},${y}`))}
                        onClick={() => this.save()}>Выбрать это поле</button></footer>
            </section>
        </div>;
    }
}

class CourseSetup extends React.Component {
    constructor(props) {
        super(props);
        this.state = {board: standardBoardName(props.state, props.state.course.board),
            start: props.state.course.start, rotation: props.state.course.rotation || 0,
            name: "Мой курс", flags: [[2,2], [9,5], [5,9]], flagHistory: [], inspectedCourseId: props.state.course.id,
            courseQuery: "", difficulty: "", fitOnly: false, routeChoices: {}, catalogOpen: true, editorOpen: false, editorDraft: null};
    }

    componentDidUpdate(previousProps) {
        const roleChanged = previousProps.readOnly !== this.props.readOnly;
        if (roleChanged) this.pendingCourseId = null;
        if (previousProps.state.course.id !== this.props.state.course.id || roleChanged) {
            // A reply to an earlier click must not replace the latest local preview.
            if (this.pendingCourseId && this.pendingCourseId !== this.props.state.course.id) return;
            this.pendingCourseId = null;
            this.setState(current=>({inspectedCourseId:this.props.state.course.id,
                routeChoices:{...current.routeChoices,[this.props.state.course.board]:this.props.state.course.id}}));
        }
    }

    inspectCourse(course) {
        this.setState(current=>({inspectedCourseId:course.id,routeChoices:{...current.routeChoices,[course.board]:course.id}}));
        if (!this.props.readOnly && (this.pendingCourseId || this.props.state.course.id !== course.id)) {
            this.pendingCourseId = course.id;
            this.props.app.socket.emit("select-course", course.id);
        }
    }

    saveCustom() {
        this.props.app.socket.emit("set-custom-course", {name: this.state.name,
            board: standardBoardName(this.props.state, this.state.board), start: this.state.start,
            rotation: Number(this.state.rotation), flags: this.state.flags});
    }

    setFlags(flags) {
        this.setState((state) => ({flags, flagHistory: [...state.flagHistory, state.flags].slice(-20)}));
    }

    toggleFlag(x, y) {
        const index = this.state.flags.findIndex(([flagX, flagY]) => flagX === x && flagY === y);
        if (index >= 0) return this.setFlags(this.state.flags.filter((flag, flagIndex) => flagIndex !== index));
        if (this.state.flags.length < 8) this.setFlags([...this.state.flags, [x, y]]);
    }

    moveFlag(index, offset) {
        const target = index + offset;
        if (target < 0 || target >= this.state.flags.length) return;
        const flags = [...this.state.flags];
        [flags[index], flags[target]] = [flags[target], flags[index]];
        this.setFlags(flags);
    }

    render() {
        const {state, app, playerCount, readOnly} = this.props;
        const viewAngle = app.boardViewAngle();
        const quickBoard = standardBoardName(state, this.state.board);
        const selected = state.course.id;
        const previewFlags = this.state.flags;
        const normalizedQuery = this.state.courseQuery.trim().toLocaleLowerCase("ru");
        const courseMatches = (course) => {
            const fits = !playerCount || (playerCount >= (course.recommendedMin || course.min) && playerCount <= (course.recommendedMax || course.max));
            const matches = !normalizedQuery || `${course.name} ${course.board}`.toLocaleLowerCase("ru").includes(normalizedQuery);
            return matches && (!this.state.fitOnly || fits)&&(!this.state.difficulty||course.level===this.state.difficulty);
        };
        const visibleCourses=state.courses.filter(courseMatches);
        const fields=Object.keys(state.boardTemplates).map(board=>({board,routes:visibleCourses.filter(c=>c.board===board)})).filter(f=>f.routes.length);
        const inspectedCourse = state.courses.find((course) => course.id === this.state.inspectedCourseId) || state.course;
        const inspectedIsSelected = inspectedCourse.id === selected;
        const inspectedRoutes=inspectedCourse.customFeatures?[]:visibleCourses.filter(c=>c.board===inspectedCourse.board);
        const filtered=!!(normalizedQuery||this.state.fitOnly||this.state.difficulty);
        return <section className="course-setup rr-panel">
            <div className="selected-course-strip" data-course-id={state.course.id}><div><small>Выбран для игры</small><strong>{state.course.customFeatures?state.course.name:state.course.board}</strong>
                    <span>{state.course.customFeatures?`Флагов: ${state.course.flags.length}`:<React.Fragment>{state.course.routeLabel ? `Маршрут ${state.course.routeLabel} · ` : ""}{state.course.name} · {state.course.length}</React.Fragment>}</span></div>
                <span className="selected-course-actions">
                    {readOnly ? <button type="button" style={{visibility:inspectedIsSelected?"hidden":"visible"}}
                        onClick={() => this.setState({inspectedCourseId: selected})}>Показать выбранный</button> : null}
                    {readOnly ? <em>Курс выбирает хост</em> : null}
                </span></div>
            <details className="lobby-fold course-browser" open={this.state.catalogOpen}
                onToggle={(event) => this.setState({catalogOpen: event.currentTarget.open})}>
                <summary><span>Поля <small>{Object.keys(state.boardTemplates).length}</small></span><em>{state.courses.length} маршрута · {this.state.catalogOpen ? "Свернуть" : "Открыть каталог"}</em></summary>
                <div className="course-browser-tools">
                    <label className="course-search"><span>Поиск</span><input type="search" value={this.state.courseQuery} placeholder="Поле или маршрут"
                        onChange={(event) => this.setState({courseQuery: event.target.value})}/></label>
                    <label className="race-catalog-filter"><span>Сложность маршрута</span><select value={this.state.difficulty}
                        onChange={event=>this.setState({difficulty:event.target.value})}><option value="">Любая</option>
                        {["Базовый","Средний","Сложный"].map(level=><option key={level}>{level}</option>)}</select></label>
                    <label className="course-fit-filter"><input type="checkbox" checked={this.state.fitOnly}
                        onChange={(event) => this.setState({fitOnly: event.target.checked})}/><span>Для нашего состава</span></label>
                </div>
                <div className="race-catalog-results" role="status"><span>Полей: {fields.length} · маршрутов: {visibleCourses.length}</span>
                    {filtered?<button type="button" onClick={()=>this.setState({courseQuery:"",difficulty:"",fitOnly:false})}>Сбросить фильтры</button>:null}</div>
                <div className="course-browser-layout">
                    <div className="race-field-list-slot"><div className="course-list" role="listbox" aria-label="Поля">{fields.map(({board,routes}) => {
                        const course=routes.find(c=>c.id===this.state.routeChoices[board])||routes.find(c=>c.id===inspectedCourse.id)||routes[0];
                        return <button key={board} type="button" role="option" aria-label={`Поле ${board}`} aria-selected={inspectedCourse.board === board}
                            data-board={board} className={`course-card race-arena-card ${state.course.board===board ? "selected" : ""} ${inspectedCourse.board===board ? "inspected" : ""}`}
                            onClick={()=>this.inspectCourse(course)}>
                            <span className="race-arena-thumbnail-frame"><img className="race-arena-thumbnail" src={state.boardThumbnails?.[board]||boardImageUrl(state,board)} loading="lazy" decoding="async" alt="" draggable="false"/></span>
                            <span className="course-card-copy"><strong>{board}</strong><span>Маршрутов: {routes.length}</span>
                                <b className="course-selected-badge" style={{visibility:state.course.board===board?"visible":"hidden"}}>Выбрано</b></span>
                        </button>;
                    })}{!fields.length ? <p className="course-empty">Подходящих маршрутов нет. Попробуйте изменить фильтры.</p> : null}</div></div>
                    <section className="selected-course-preview" aria-live="polite">
                        <div className="selected-course-heading"><div><small>Поле</small><strong>{inspectedCourse.customFeatures?inspectedCourse.name:inspectedCourse.board}</strong>
                            <span>2–8 игроков</span></div>
                            <BoardViewControls app={app}/></div>
                        <div className="race-route-list" role="group" aria-label="Маршруты поля">{inspectedRoutes.map(course=><button
                            key={course.id} type="button" data-course-id={course.id} aria-pressed={course.id===inspectedCourse.id}
                            className={`race-route-option${course.id===inspectedCourse.id?" selected":""}`} onClick={()=>this.inspectCourse(course)}>
                            <b>Маршрут {course.routeLabel}</b><strong>{course.name}</strong><span className="race-route-meta"><small>{course.level}</small>
                            <small>{course.recommendedMin}–{course.recommendedMax} игроков</small><small>{course.length}</small></span></button>)}</div>
                        {!courseMatches(inspectedCourse)?<p className="race-filter-notice">Просматриваемый маршрут не соответствует фильтрам. Выбор для игры сохранён.</p>:null}
                        <div className="selected-course-body">
                            <div className="course-preview-group">
                                <div className={`large-course-preview ${boardViewClass(viewAngle)}`} style={boardViewStyle(viewAngle)}>
                                    <div className="rr-view-canvas"><CourseFieldContents course={inspectedCourse} state={state}
                                        flagClassName="large-preview-flag" showLobbyRobots={!readOnly || inspectedIsSelected}/></div></div>
                                {/* Keep this row in the layout while inspecting or awaiting the server. */}
                                <div className="course-start-controls" style={{visibility:!readOnly || inspectedIsSelected?"visible":"hidden"}}>
                                    <div className="course-start-list" aria-label="Стартовые позиции">
                                        {state.playerSlots.filter(Boolean).map((userId) => <span className="course-start-chip" key={userId}
                                            title={`${playerName(state, userId)} · старт ${((state.startAssignments || {})[userId] ?? 0) + 1}`}>
                                            <i style={{background: (state.playerColors || {})[userId] || (state.robotColors || LOBBY_ROBOT_COLORS)[Math.max(0, state.playerSlots.indexOf(userId))]}}/>
                                            <b>{((state.startAssignments || {})[userId] ?? 0) + 1}</b>
                                            <span>{playerName(state, userId)}</span>
                                        </span>)}
                                        {!playerCount ? <span className="course-start-empty">Стартовые позиции появятся после присоединения игроков.</span> : null}
                                    </div>
                                    {!readOnly && playerCount > 1 ? <button type="button" onClick={() => app.socket.emit("shuffle-starts")}>Перемешать старты</button> : null}
                                </div>
                            </div>
                        </div>
                        <div className="course-inspector-actions">
                            {inspectedIsSelected ? <strong className="course-current-note">✓ Выбран для игры</strong>
                                : readOnly ? <span>Можно осмотреть любой курс. Выбор изменяет хост.</span>
                                : <span>Выбираем маршрут…</span>}
                        </div>
                    </section>
                </div>
            </details>
            {!readOnly ? <div className="rr-editor-launch"><div><strong>Своё поле</strong><small>Начните с пустого поля или измените готовое.</small></div>
                <button type="button" className="primary" onClick={(event) => { this.editorReturnFocus = event.currentTarget; this.setState({editorOpen:true}); }}>Открыть редактор поля</button></div> : null}
            {!readOnly ? <details className="constructor"><summary><span>Быстрый курс: готовое поле + флаги</span><em>Открыть</em></summary>
                <div className="constructor-fields">
                    <label>Название<input value={this.state.name} onChange={(event) => this.setState({name: event.target.value})}/></label>
                    <label>Карта<select value={quickBoard} onChange={(event) => this.setState({board: event.target.value})}>{Object.keys(state.boardTemplates).map((board) => <option key={board}>{board}</option>)}</select></label>
                    <label>Старт<select value={this.state.start} onChange={(event) => this.setState({start: event.target.value})}>{state.startCards.map((start) => <option value={start} key={start}>{start}</option>)}</select></label>
                    <label>Поворот карты<select value={this.state.rotation} onChange={(event) => this.setState({rotation: Number(event.target.value)})}>
                        {[0,90,180,270].map((rotation) => <option value={rotation} key={rotation}>{rotation}°</option>)}</select></label>
                    <BoardViewControls app={app}/>
                </div>
                <div className={`constructor-preview ${boardViewClass(viewAngle)}`} style={boardViewStyle(viewAngle)}
                    onClick={(event) => {
                        const point = boardPointFromView(event.currentTarget, viewAngle, event.clientX, event.clientY);
                        if (point && point.fy < 12) this.toggleFlag(Math.floor(point.fx), Math.floor(point.fy));
                    }}><div className="rr-view-canvas"><img className="constructor-preview-board constructor-preview-factory" style={{transform: `rotate(${this.state.rotation}deg)`}}
                        src={boardImageUrl(state, quickBoard)}/>
                    <img className="constructor-preview-board constructor-preview-start"
                        src={boardImageUrl(state, quickBoard)}/>
                    {previewFlags.map(([x, y], index) => <FlagMarker className="preview-flag" key={`${x},${y},${index}`} number={index+1}
                        style={{left: `${(x + .5) / 12 * 100}%`, top: `${(y + .5) / 16 * 100}%`}}/>)}
                    <FieldLaserOverlay features={state.boardTemplates?.[quickBoard]?.features} rotation={Number(this.state.rotation)||0}/>
                </div></div>
                <p className="constructor-help">Щелчок ставит флаг; повторный щелчок по клетке убирает его.</p>
                <div className="flag-editor"><div className="flag-editor-heading"><strong>Порядок флагов</strong><span>{previewFlags.length}/8</span></div>
                    {previewFlags.length ? previewFlags.map(([x, y], index) => <div className="flag-editor-row" key={`${x},${y},${index}`}>
                        <b>{index + 1}</b><span>Флаг {index + 1}</span>
                        <button type="button" disabled={index === 0} title="Переместить раньше" onClick={() => this.moveFlag(index, -1)}>↑</button>
                        <button type="button" disabled={index === previewFlags.length - 1} title="Переместить позже" onClick={() => this.moveFlag(index, 1)}>↓</button>
                        <button type="button" title="Удалить флаг" onClick={() => this.setFlags(previewFlags.filter((flag, flagIndex) => flagIndex !== index))}>×</button>
                    </div>) : <p>Поставьте хотя бы один флаг на поле.</p>}
                    <div className="flag-editor-actions"><button type="button" disabled={!this.state.flagHistory.length} onClick={() => this.setState((current) => ({flags: current.flagHistory[current.flagHistory.length - 1], flagHistory: current.flagHistory.slice(0, -1)}))}>Отменить</button>
                        <button type="button" disabled={!previewFlags.length} onClick={() => this.setFlags([])}>Убрать все</button></div>
                </div>
                <button className="primary" type="button" disabled={!previewFlags.length} onClick={() => this.saveCustom()}>Выбрать свой курс</button>
            </details> : null}
            {this.state.editorOpen ? <FieldEditorModal state={state} app={app} draft={this.state.editorDraft} returnFocus={this.editorReturnFocus}
                onClose={(draft) => this.setState({editorOpen:false, editorDraft:draft})}/> : null}
        </section>;
    }
}

function PowerDownToken({selected = false, confirmed = false, urgent = false, unavailable = false, disabled = false, onClick, title}) {
    return <button type="button" className={`power-down-token ${selected ? "selected" : ""} ${confirmed ? "confirmed" : ""} ${urgent ? "urgent" : ""} ${unavailable ? "unavailable" : ""}`}
        disabled={disabled} aria-pressed={selected} aria-label="Перезагрузка" title={title} onClick={onClick}>
        <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v9M6 5.5a8 8 0 1 0 12 0"/></svg><small>Перезагрузка</small></span>
    </button>;
}

function ProgrammingTimer({state}) {
    if (state.phase !== "programming") return null;
    const automatic = state.programmingAutoFill;
    if (automatic) {
        const fills = automatic.fills || [{userId: automatic.userId, registers: automatic.registers || []}];
        const details = fills.map((fill) => {
            const name = playerName(state, fill.userId);
            return fill.registers.length ? `${name}: ${fill.registers.map((register) => register + 1).join(", ")}` : `${name}: программа зафиксирована`;
        }).join(" · ");
        return <section className="programming-timer expired" role="status" aria-live="assertive">
            <span className="timer-random-icon" aria-hidden="true">◆</span>
            <div><strong>Время вышло</strong><small>{automatic.count ? `Случайное заполнение · ${details}` : details}</small></div>
        </section>;
    }
    const timer = state.programmingTimer;
    if (!timer) return null;
    const remaining = Math.max(0, Number(timer.remaining) || 0);
    const pendingNames = (timer.userIds || [timer.userId]).map((userId) => playerName(state, userId)).join(", ");
    return <section className={`programming-timer ${timer.paused ? "paused" : remaining <= 10 ? "warning" : ""}`} role="timer" aria-live="polite">
        <span className="timer-clock" aria-hidden="true"><strong>{remaining}</strong><small>сек</small></span>
        <div><strong>{timer.paused ? "Таймер приостановлен" : "Последний игрок программирует"}</strong>
            <small>{timer.paused ? "Отсчёт продолжится после снятия паузы." : `${pendingNames}: после сигнала пустые регистры заполнятся случайно.`}</small></div>
    </section>;
}

function bottomDockProgrammingState(state, isPlayer) {
    if (!isPlayer || state.phase !== "programming") return {className: "", label: null};
    if (state.programmingAutoFill) return {
        className: "rr-dock-programming rr-dock-expired",
        label: "ВРЕМЯ ВЫШЛО · РЕГИСТРЫ ЗАПОЛНЕНЫ"
    };
    const timer = state.programmingTimer;
    if (!timer) return state.paused ? {
        className: "rr-dock-programming rr-dock-paused",
        label: "ПРОГРАММИРОВАНИЕ НА ПАУЗЕ"
    } : {
        className: "rr-dock-programming",
        label: `ПРОГРАММИРОВАНИЕ · РАУНД ${state.round}`
    };
    const remaining = Math.max(0, Number(timer.remaining) || 0);
    if (timer.paused || state.paused) return {
        className: "rr-dock-programming rr-dock-timer rr-dock-paused",
        label: "ТАЙМЕР НА ПАУЗЕ"
    };
    const warning = remaining <= 10 ? " rr-dock-warning" : "";
    const targetIds = timer.userIds || [timer.userId];
    const isTarget = targetIds.includes(state.userId);
    return {
        className: `rr-dock-programming rr-dock-timer${warning}`,
        label: isTarget
            ? `ВАШИ ${remaining} СЕКУНД`
            : `${remaining} СЕКУНД · ${targetIds.map((userId) => playerName(state, userId)).join(", ")}`
    };
}

function Program({state, privateState, app}) {
    if (state.phase !== "programming" || !state.playerSlots.includes(state.userId)) return null;
    if (privateState.finished) return <section className="program rr-panel"><h2>Вы уже собрали все флаги</h2><p>Ваш робот завершил заезд. Остальные продолжают.</p></section>;
    if (privateState.lives === 0) return <section className="program rr-panel"><h2>Робот выбыл</h2><p>Хост может вернуть его в игру, выдав жизнь.</p></section>;
    if (privateState.poweredDown) return <section className="program power-down-active rr-panel">
        <PowerDownToken selected confirmed disabled title="Робот находится в режиме перезагрузки"/>
        <div><h2>Перезагрузка · раунд {state.round}</h2><p>Повреждения сняты. Робот не получает карты и не двигается самостоятельно, но поле продолжает на него воздействовать.</p></div>
    </section>;
    const selected = privateState.selected || [];
    const selectedCount = selected.filter(Boolean).length;
    const registerCards = privateState.registerCards || [];
    const lockedRegisters = privateState.lockedRegisters || [];
    const autoFilledRegisters = privateState.autoFilledRegisters || [];
    const simplePowerDown = state.activePowerDownMode === "simple";
    const interactionLocked = privateState.locked || state.paused || (simplePowerDown && privateState.powerDownIntent);
    const mayUnlock = privateState.locked && state.gameOptions?.lastPlayerSeconds === null && !state.programmingAutoFill && !state.programmingTimer;
    const drag = (event, payload) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/json", JSON.stringify(payload));
    };
    const drop = (event, register) => {
        event.preventDefault();
        event.stopPropagation();
        if (interactionLocked || lockedRegisters.includes(register)) return;
        try {
            const payload = JSON.parse(event.dataTransfer.getData("application/json"));
            if (payload.kind === "register") app.socket.emit("swap-registers", {from: payload.register, to: register});
            if (payload.kind === "card") app.socket.emit("assign-register", {cardId: payload.cardId, register});
        } catch (error) {}
    };
    const nearestRegister = (event) => {
        if (event.target.closest(".cards")) return null;
        const registers = [...event.currentTarget.querySelectorAll(".register")];
        const nearest = registers.map((element, register) => {
            const rect = element.getBoundingClientRect();
            const x = Math.max(rect.left, Math.min(event.clientX, rect.right));
            const y = Math.max(rect.top, Math.min(event.clientY, rect.bottom));
            return {register, distance: Math.hypot(event.clientX - x, event.clientY - y)};
        }).sort((left, right) => left.distance - right.distance)[0];
        return nearest && nearest.distance <= 24 && !lockedRegisters.includes(nearest.register)
            ? nearest.register : null;
    };
    const allowDropNearRegister = (event) => {
        if (!interactionLocked && nearestRegister(event) !== null) event.preventDefault();
    };
    const dropNearRegister = (event) => {
        const register = nearestRegister(event);
        if (register !== null) drop(event, register);
    };
    return <section className="program rr-panel" aria-label={`Программирование · раунд ${state.round}`} onDragOver={allowDropNearRegister} onDrop={dropNearRegister}>
        <div className="program-heading">
            <div><h2>Программирование · раунд {state.round}</h2><p>Выберите ровно 5 карт. Их порядок — порядок регистров.</p></div>
            <div className="program-actions">
                <button onClick={() => app.socket.emit("auto-program")} disabled={interactionLocked}>Авто</button>
                <div className="power-down-action">
                    <PowerDownToken selected={!!privateState.powerDownIntent}
                        confirmed={!!privateState.locked && !!privateState.powerDownIntent}
                        urgent={privateState.damage >= 4} unavailable={!privateState.canPowerDown}
                        disabled={privateState.locked || state.paused || !privateState.canPowerDown}
                        title={!privateState.canPowerDown ? privateState.powerDownUnavailableReason || "Перезагрузка недоступна"
                            : privateState.powerDownIntent ? "Отменить перезагрузку" : simplePowerDown ? "Перезагрузка в этом раунде вместо программы" : "Перезагрузка в следующем раунде"}
                        onClick={() => app.socket.emit("set-power-down-intent", {enabled: !privateState.powerDownIntent})}/>
                    <small>{!privateState.canPowerDown ? (privateState.powerDownUnavailableReason === "Курс запрещает Перезагрузка" ? "Запрещён курсом" : "Нужен урон")
                        : privateState.locked && privateState.powerDownIntent ? "Объявлено"
                        : privateState.powerDownIntent ? "Выбрано" : simplePowerDown ? "Этот раунд" : "Следующий раунд"}</small>
                </div>
                <button className="primary" onClick={() => app.socket.emit(mayUnlock ? "unlock-program" : "lock-program")}
                    disabled={state.paused || (privateState.locked ? !mayUnlock : selectedCount !== 5 && !(simplePowerDown && privateState.powerDownIntent))}
                    title={mayUnlock ? "Отменить готовность и изменить выбор" : undefined}>{privateState.locked ? (mayUnlock ? "Отменить готовность" : "Готов ✓") : "Готов"}</button>
            </div>
        </div>
        <div className="registers">
            {[0, 1, 2, 3, 4].map((index) => {
                const card = registerCards[index] || privateState.hand.find((item) => item.id === selected[index]);
                return <div className={`register ${lockedRegisters.includes(index) ? "locked" : ""} ${autoFilledRegisters.includes(index) ? "auto-filled" : ""}`} key={index}
                    draggable={!!card && !lockedRegisters.includes(index) && !interactionLocked}
                    onDragStart={(event) => drag(event, {kind: "register", register: index})}
                    onDragOver={(event) => !interactionLocked && !lockedRegisters.includes(index) && event.preventDefault()}
                    onDrop={(event) => drop(event, index)}
                    onDoubleClick={() => app.socket.emit("clear-register", index)}>
                    <b>{index + 1}{lockedRegisters.includes(index) ? <svg className="rr-register-lock" viewBox="0 0 12 14" role="img" aria-label="Заблокирован">
                        <title>Заблокирован</title><rect x="1" y="6" width="10" height="7" rx="1.5"/><path d="M3 6V4a3 3 0 0 1 6 0v2"/>
                    </svg> : null}</b><span className="register-label" title={card ? cardLabel(card) : undefined} aria-label={card ? cardLabel(card) : "Пустой регистр"}>
                        {card ? cardLabel(card) : "—"}
                    </span>
                    {card ? <small className="priority-badge" title="Приоритет карты">{card.priority}</small> : null}
                </div>;
            })}
        </div>
        <div className="cards">
            {privateState.hand.map((card) => {
                const selectedIndex = selected.indexOf(card.id);
                return <button className={`card ${selectedIndex >= 0 ? "selected" : ""} ${autoFilledRegisters.includes(selectedIndex) ? "auto-filled-source" : ""}`} key={card.id}
                    title={card.type === "left" ? "Повернуть робота на 90° влево" : card.type === "right" ? "Повернуть робота на 90° вправо" : undefined}
                    disabled={interactionLocked}
                    draggable={!interactionLocked}
                    onDragStart={(event) => drag(event, {kind: "card", cardId: card.id})}
                    onClick={() => app.socket.emit("toggle-card", card.id)}>
                    {selectedIndex >= 0 ? <small className="selected-register-label">{`Регистр ${selectedIndex + 1}`}</small> : null}
                    <b className="priority-badge" title="Приоритет карты">{card.priority}</b>
                    <strong>{cardLabel(card)}</strong>
                    <span>{card.type === "left" ? "↶" : card.type === "right" ? "↷" : card.type === "uturn" ? "↻" : card.type === "backup" ? "↓" : "↑"}</span>
                </button>;
            })}
        </div>
    </section>;
}

function PlayerRegisters({state, userId}) {
    const [detail, setDetail] = React.useState(null);
    // Only use the public channel: private hands must never reveal future registers.
    const program = state.programs?.[userId] || {};
    const cards = program.cards || [];
    const description = (index) => {
        const card = cards[index];
        const sleeping = program.poweredDown && index < (state.revealedRegisters || 0);
        const locked = (program.lockedRegisters || []).includes(index);
        return `Регистр ${index + 1}: ${card ? `${cardLabel(card)}, приоритет ${card.priority}`
            : sleeping ? "Перезагрузка" : "Закрыт"}${locked ? ", заблокирован" : ""}`;
    };
    return <div className="rr-player-registers" role="group" aria-label={`Регистры: ${playerName(state, userId)}`}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDetail(null); }}
        onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setDetail(null); } }}>
        {[0,1,2,3,4].map((index) => {
            const card = cards[index];
            const current = state.phase === "resolving" && state.register === index + 1;
            const locked = (program.lockedRegisters || []).includes(index);
            const sleeping = program.poweredDown && index < (state.revealedRegisters || 0);
            const symbol = !card ? (sleeping ? "⏻" : "?") : card.type === "left" ? "↶" : card.type === "right" ? "↷"
                : card.type === "uturn" ? "↻" : card.type === "backup" ? "↓" : "↑";
            return <button type="button" key={index} data-register={index + 1}
                className={`public-register ${card || sleeping ? "revealed" : "closed"}${current ? " current" : ""}${locked ? " locked" : ""}${program.poweredDown && locked && card ? " random-locked" : ""}`}
                title={description(index)} aria-label={description(index)} aria-current={current ? "step" : undefined}
                onFocus={() => setDetail(index)} onMouseEnter={() => setDetail(index)}
                onMouseLeave={() => { if (!document.activeElement?.closest(".rr-player-registers")) setDetail(null); }}
                onClick={() => setDetail(index)}>
                <span className="rr-command-symbol" aria-hidden="true">{symbol}{/^move[123]$/.test(card?.type || "") ? <b>{card.type.slice(-1)}</b> : null}</span>
                {card ? <small className="priority-badge" aria-hidden="true">{card.priority}</small> : null}
                {locked ? <svg className="rr-public-lock" viewBox="0 0 12 14" aria-hidden="true">
                    <rect x="1" y="6" width="10" height="7" rx="1.5"/><path d="M3 6V4a3 3 0 0 1 6 0v2"/>
                </svg> : null}
            </button>;
        })}
        {detail !== null ? <span className="rr-register-detail" role="status">{description(detail)}</span> : null}
    </div>;
}

function PowerDownChoicePanel({state, privateState, app}) {
    if (state.phase !== "power-down-choice") return null;
    const progress = state.powerDownChoice || {answered: 0, total: 0};
    const choice = privateState.powerDownChoice || {eligible: false, answered: false, choice: null};
    return <section className="power-down-choice-panel rr-panel">
        <div><h2>Продолжить Перезагрузка?</h2><p>Ответили: {progress.answered} из {progress.total}. Решения откроются одновременно.</p></div>
        {choice.eligible ? <div className="power-down-choice-actions">
            <button type="button" className={choice.answered && choice.choice === false ? "selected" : ""}
                disabled={choice.answered || state.paused} onClick={() => app.socket.emit("choose-power-down-continuation", {enabled: false})}>Проснуться</button>
            <PowerDownToken selected={choice.answered && choice.choice === true}
                confirmed={choice.answered && choice.choice === true} disabled={choice.answered || state.paused}
                title="Остаться в режиме перезагрузки ещё на один раунд"
                onClick={() => app.socket.emit("choose-power-down-continuation", {enabled: true})}/>
            {choice.answered ? <small>Ваш выбор принят</small> : null}
        </div> : <p className="power-down-waiting">Ожидаем решения отключённых роботов.</p>}
    </section>;
}

function ReentryPanel({state, privateState, app, choice, viewAngle}) {
    if (state.phase !== "reentry") return null;
    const reentry = privateState.reentry || {active: false, candidates: []};
    if (!reentry.active || state.reentryUserId !== state.userId) return <section className="reentry-panel rr-panel" role="status">
        <p>{playerName(state, state.reentryUserId)} выбирает возрождение на поле.</p></section>;
    const disabled = state.paused || state.reentryPending;
    const candidate = choice && reentry.candidates.find(point => point.x === choice.x && point.y === choice.y);
    const modeChosen = !reentry.needsPowerDownChoice || state.reentryPoweredDown !== null;
    const screenDirection = choice && Object.keys(DIRECTION_ANGLES)[((DIRECTION_ANGLES[choice.direction] + viewAngle) % 360) / 90];
    return <section className="reentry-panel rr-panel" aria-label="Возрождение">
        <p className="rr-reentry-instruction" role="status">{!reentry.candidates.length ? "Ожидаем доступную клетку восстановления."
            : !choice ? "Выберите подсвеченную клетку на поле."
            : !choice.direction ? "Выберите направление стрелкой рядом с роботом на поле."
            : `Робот смотрит ${DIRECTION_NAMES[screenDirection]}. Подтвердите возрождение.`}</p>
        <div className="rr-reentry-controls">
            {reentry.needsPowerDownChoice ? <div className="reentry-power-down-choice" role="group" aria-label="Режим после возрождения">
                <button type="button" className={state.reentryPoweredDown === false ? "selected" : ""}
                    aria-pressed={state.reentryPoweredDown === false} disabled={disabled}
                    onClick={() => app.setState({reentryPoweredDown: false})}>Обычный режим</button>
                <button type="button" className={state.reentryPoweredDown === true ? "selected" : ""}
                    aria-pressed={state.reentryPoweredDown === true} disabled={disabled}
                    onClick={() => app.setState({reentryPoweredDown: true})}>Перезагрузка</button>
            </div> : null}
            <button type="button" className="primary rr-reentry-confirm" disabled={disabled || !choice?.direction || !modeChosen}
                onClick={() => app.confirmReentry()}>{state.reentryPending ? "Отправляем…" : "Возродиться"}</button>
        </div>
        {reentry.needsPowerDownChoice && !modeChosen ? <small>Выберите обычный режим или перезагрузку.</small> : null}
        {choice && reentry.candidates.length > 1 ? <small>Нажмите на робота, чтобы выбрать другую клетку.</small> : null}
        {candidate && candidate.directions.length < 4 ? <small>Серые стороны недоступны: на линии огня есть робот в пределах трёх клеток.</small> : null}
        {state.reentryError ? <small role="alert">{state.reentryError}</small> : null}
    </section>;
}

function ReentryDirections({choice, reentry, viewAngle, width, disabled, app}) {
    if (!choice || !width) return null;
    const candidate = reentry.candidates.find(point => point.x === choice.x && point.y === choice.y);
    if (!candidate) return null;
    const directions = Object.keys(DIRECTION_ANGLES);
    const x = (choice.x + .5) / 12, y = (choice.y + .5) / 16;
    const point = viewAngle === 90 ? [1-y,x] : viewAngle === 180 ? [1-x,1-y] : viewAngle === 270 ? [y,1-x] : [x,y];
    const fieldWidth = width - 10, fieldHeight = fieldWidth * (viewAngle % 180 ? .75 : 4/3);
    const anchor = [point[0]*fieldWidth, point[1]*fieldHeight];
    const size = Math.min(96,fieldWidth-6,fieldHeight-6), hit = size/3;
    const center = [Math.max(size/2,Math.min(fieldWidth-size/2,anchor[0])), Math.max(size/2,Math.min(fieldHeight-size/2,anchor[1]))];
    const choose = direction => { if (!disabled && candidate.directions.includes(direction)) app.faceReentry(direction); };
    return <div className="rr-reentry-direction-overlay">
        <div className={`rr-reentry-compass${!choice.direction && !disabled ? " rr-reentry-needs-direction" : ""}`} style={{left:center[0],top:center[1],width:size,height:size}}
            role="group" aria-label="Направление возрождения" onKeyDown={event => {
                const screenIndex = ["ArrowUp","ArrowRight","ArrowDown","ArrowLeft"].indexOf(event.key);
                if(screenIndex >= 0) { event.preventDefault(); choose(directions[(screenIndex-viewAngle/90+4)%4]); }
            }}>
            {directions.map(direction => {
                const angle = (DIRECTION_ANGLES[direction] + viewAngle) % 360;
                const allowed = !disabled && candidate.directions.includes(direction);
                const label = `Смотреть ${DIRECTION_NAMES[directions[angle/90]]}`;
                return <button type="button" key={direction} className={`rr-reentry-direction${choice.direction===direction ? " selected" : ""}`}
                    data-direction={direction} disabled={!allowed} aria-label={label} title={allowed ? label : `${label}: недоступно`}
                    aria-disabled={!allowed} aria-pressed={choice.direction===direction}
                    style={{left:size/2+Math.sin(angle*Math.PI/180)*hit,top:size/2-Math.cos(angle*Math.PI/180)*hit,width:hit,height:hit}}
                    onClick={() => choose(direction)}>
                    <svg viewBox="0 0 24 24" style={{transform:`rotate(${angle}deg)`}} aria-hidden="true">
                        <path className="rr-direction-arrow" d="M12 2 22 12H16V22H8V12H2Z"/>
                    </svg>
                </button>;
            })}
        </div>
    </div>;
}

// Mobile players are a dialog rather than a second scrolling dock above the field.
function PlayersOverlay({open, onClose, children}) {
    const dialog = React.useRef(null);
    React.useEffect(() => {
        if (!open) return;
        const previousFocus = document.activeElement;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        dialog.current?.querySelector(".rr-dock-collapse-button")?.focus();
        const handleKey = (event) => {
            if (!dialog.current.contains(event.target)) return;
            if (event.key === "Escape") { event.preventDefault(); onClose(); }
            if (event.key !== "Tab") return;
            const items = [...dialog.current.querySelectorAll("button:not(:disabled),a[href],input,select,[tabindex='0']")]
                .filter((item) => item.getClientRects().length);
            const first = items[0], last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        document.addEventListener("keydown", handleKey);
        return () => {
            document.removeEventListener("keydown", handleKey);
            document.body.style.overflow = previousOverflow;
            if (document.contains(previousFocus)) previousFocus.focus();
        };
    }, [open]);
    return <React.Fragment>
        {open ? <div className="rr-players-backdrop" onClick={onClose} aria-hidden="true"/> : null}
        <div className="rr-players-shell" ref={dialog} role={open ? "dialog" : undefined}
            aria-modal={open ? "true" : undefined} aria-label={open ? "Игроки и регистры" : undefined}>{children}</div>
    </React.Fragment>;
}

class Game extends React.Component {
    constructor() {
        super();
        const storedView = localStorage.getItem(BOARD_VIEW_STORAGE_KEY);
        const boardViewChoice = ["0","90","180","270"].includes(storedView) ? Number(storedView) : null;
        const savedInfoDock = localStorage.getItem("roborace-info-dock");
        const savedProgramDock = localStorage.getItem("roborace-program-dock");
        const infoDock = DOCK_EDGES[savedInfoDock] ? savedInfoDock : "right";
        const programDock = DOCK_EDGES[savedProgramDock] && savedProgramDock !== infoDock ? savedProgramDock
            : infoDock === "bottom" ? "right" : "bottom";
        const boardHintsEnabled = localStorage.getItem("roborace-board-hints") !== "false";
        this.state = {inited: false, phase: "loading", playerNames: {}, playerSlots: [], robots: [], log: [], flags: [],
            boardViewportWidth: null, boardZoomSteps: 0, boardHintsEnabled,
            boardViewChoice, boardViewWindowWidth: window.innerWidth, infoDock, programDock,
            draggedDock: null, dockDropEdge: null,
            hudCollapsed: window.innerWidth < 1000, bottomDockCollapsed: false, guideOpen: false, fieldExample: null, gameSettingsOpen: false,
            guideExpanded:localStorage.getItem("roborace-guide-expanded")!=="false",
            programmingCueActive: false, timerCueActive: false};
        this.state = {...this.state, reentryChoice: null, reentryPoweredDown: null, reentryPending: false, reentryError: null};
        this.privateState = {hand: [], selected: [], locked: false};
        this.openGuide = this.openGuide.bind(this);
        this.closeGuide = this.closeGuide.bind(this);
        this.openConveyorGuide = this.openConveyorGuide.bind(this);
        this.openCollisionGuide = this.openCollisionGuide.bind(this);
        this.closeFieldExample = this.closeFieldExample.bind(this);
        this.openGameSettings = this.openGameSettings.bind(this);
        this.closeGameSettings = this.closeGameSettings.bind(this);
        this.setBottomDockRef = this.setBottomDockRef.bind(this);
        this.setInfoDockRef = this.setInfoDockRef.bind(this);
        this.setBoardColumnRef = this.setBoardColumnRef.bind(this);
        this.updateBoardViewWidth = this.updateBoardViewWidth.bind(this);
    }

    openGuide(event) {
        this.guideReturnFocus = event && event.currentTarget ? event.currentTarget : document.activeElement;
        this.setState({guideOpen: true});
    }

    closeGuide() {
        this.setState({guideOpen: false});
    }

    openConveyorGuide(event) {
        this.openFieldExample("conveyors",event);
    }

    openCollisionGuide(event) {
        this.openFieldExample("collisions",event);
    }

    openFieldExample(kind,event) {
        this.fieldExampleReturnFocus = event && event.currentTarget ? event.currentTarget : document.activeElement;
        this.setState({fieldExample:kind});
    }

    closeFieldExample() {
        this.setState({fieldExample:null});
    }

    openGameSettings(event) {
        this.settingsReturnFocus = event && event.currentTarget ? event.currentTarget : document.activeElement;
        this.setState({gameSettingsOpen: true});
    }

    closeGameSettings() {
        this.setState({gameSettingsOpen: false});
    }

    setBottomDockRef(element) {
        this.observeDock("program", element);
    }

    setInfoDockRef(element) {
        this.observeDock("info", element);
    }

    setBoardColumnRef(element) {
        if (this.boardColumnObserver) this.boardColumnObserver.disconnect();
        this.boardColumnElement = element;
        if (element) {
            this.boardColumnObserver = new ResizeObserver(() => this.scheduleBoardFit());
            this.boardColumnObserver.observe(element);
            this.scheduleBoardFit();
        }
    }

    scheduleBoardFit() {
        if (this.boardFitFrame) return;
        this.boardFitFrame = requestAnimationFrame(() => {
            this.boardFitFrame = null;
            const column = this.boardColumnElement;
            if (!column || !column.isConnected) return;
            const box = column.getBoundingClientRect();
            const root = column.closest(".roborace-app");
            const screen = column.closest(".game-screen");
            const reservedBelow = parseFloat(getComputedStyle(screen).paddingBottom)
                + parseFloat(getComputedStyle(root).paddingBottom) + 3;
            const bottom = window.innerHeight - reservedBelow;
            const aspect = this.boardViewAngle() % 180 ? 4 / 3 : 3 / 4;
            const availableWidth = Math.max(0, box.width);
            const availableHeight = Math.max(0, bottom - box.top - window.scrollY);
            const width = Math.round(Math.min(availableWidth, Math.max(Math.min(220, availableWidth), availableHeight * aspect)));
            if (Math.abs((this.state.boardViewportWidth || 0) - width) > 1)
                this.setState({boardViewportWidth: width});
        });
    }

    observeDock(panel, element) {
        const observerKey = `${panel}DockObserver`;
        if (this[observerKey]) this[observerKey].disconnect();
        this[observerKey] = null;
        this[`${panel}Reservation`] = null;
        if (!element) return;
        const updateReservedSpace = () => {
            const root = element.closest(".roborace-app");
            const compact = root.classList.contains("rr-docks-compact");
            const collapsed = element.classList.contains("collapsed");
            // Measure a CSS layout envelope, not the current hand or phase's content.
            const height = panel === "program"
                ? collapsed ? 35 : element.querySelector(".rr-program-reserve-probe").getBoundingClientRect().height
                : compact ? 0 : collapsed ? 39 : ["top", "bottom"].includes(root.dataset.infoDock)
                    ? Math.min(window.innerHeight * .34, 300) : element.getBoundingClientRect().height;
            element.closest(".game-screen")?.style.setProperty(
                `--rr-${panel}-reserved-space`, `${height ? Math.ceil(height) + 16 : 0}px`);
            this.scheduleBoardFit();
        };
        this[`${panel}Reservation`] = updateReservedSpace;
        updateReservedSpace();
        this[observerKey] = new ResizeObserver(updateReservedSpace);
        this[observerKey].observe(panel === "program" ? element.querySelector(".rr-program-reserve-probe") : element);
    }

    reentryDraft() {
        const {state, privateState} = this;
        const reentry = privateState.reentry;
        if (state.phase !== "reentry" || !reentry?.active || state.reentryUserId !== state.userId
            || state.historyReview?.actual === false) return null;
        const candidates = reentry.candidates || [];
        const previous = state.reentryChoice?.owner === state.reentryUserId ? state.reentryChoice : null;
        const candidate = candidates.find((point) => previous && point.x === previous.x && point.y === previous.y)
            || (candidates.length === 1 ? candidates[0] : null);
        if (!candidate) return null;
        const sameCell = previous && previous.x === candidate.x && previous.y === candidate.y;
        const direction = sameCell && candidate.directions.includes(previous.direction) ? previous.direction : null;
        return {x:candidate.x,y:candidate.y,direction,owner:state.reentryUserId};
    }

    selectReentry(candidate) {
        if (this.state.paused || this.state.reentryPending || this.state.phase !== "reentry"
            || this.state.reentryUserId !== this.state.userId
            || !this.privateState.reentry?.active || this.state.historyReview?.actual === false) return;
        const allowed = this.privateState.reentry.candidates.find((point) => point.x === candidate.x && point.y === candidate.y);
        if (!allowed) return;
        this.setState({reentryChoice:{x:allowed.x,y:allowed.y,owner:this.state.reentryUserId,direction:null},reentryError:null});
    }

    faceReentry(direction) {
        const draft = this.reentryDraft();
        if (!draft || this.state.paused || this.state.reentryPending) return;
        const candidate = this.privateState.reentry.candidates.find((point) => point.x === draft.x && point.y === draft.y);
        if (candidate.directions.includes(direction))
            this.setState({reentryChoice: {...draft, direction}, reentryError: null});
    }

    confirmReentry() {
        const draft = this.reentryDraft();
        const reentry = this.privateState.reentry;
        if (!draft?.direction || this.state.paused || this.state.reentryPending
            || (reentry.needsPowerDownChoice && this.state.reentryPoweredDown === null)) return;
        const payload = {x: draft.x, y: draft.y, direction: draft.direction,
            ...(reentry.needsPowerDownChoice ? {poweredDown: this.state.reentryPoweredDown} : {})};
        this.setState({reentryPending: true, reentryError: null});
        this.socket.emit("choose-reentry", payload);
        clearTimeout(this.reentryTimeout);
        this.reentryTimeout = setTimeout(() => {
            if (this.state.phase === "reentry") this.setState({reentryPending: false,
                reentryError: "Выбор не подтверждён. Проверьте соединение и повторите."});
        }, 5000);
    }

    setDockPosition(panel, position) {
        if (!DOCK_EDGES[position]) return;
        const selectedKey = `${panel}Dock`;
        const otherKey = panel === "info" ? "programDock" : "infoDock";
        const previous = this.state[selectedKey];
        const next = {[selectedKey]: position};
        if (this.state[otherKey] === position) next[otherKey] = previous;
        localStorage.setItem("roborace-info-dock", next.infoDock || this.state.infoDock);
        localStorage.setItem("roborace-program-dock", next.programDock || this.state.programDock);
        this.setState(next);
    }

    beginDockPointerDrag(panel, event) {
        if (event.button !== 0) return;
        const element = event.currentTarget.closest(panel === "info" ? ".game-side-hud" : ".bottom-dock");
        const box = element.getBoundingClientRect();
        this.dockPointerDrag = {panel, element, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
            offsetX: event.clientX - box.left, offsetY: event.clientY - box.top, width: box.width, height: box.height,
            originalStyle: element.getAttribute("style"), started: false};
        event.currentTarget.setPointerCapture(event.pointerId);
    }

    moveDockPointerDrag(event) {
        const drag = this.dockPointerDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (!drag.started && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
        if (!drag.started) {
            drag.started = true;
            Object.assign(drag.element.style, {position: "fixed", right: "auto", bottom: "auto", width: `${drag.width}px`,
                height: `${drag.height}px`, maxHeight: "none", transform: "none", zIndex: "130"});
            this.setState({draggedDock: drag.panel, dockDropEdge: dockEdgeAt(event.clientX, event.clientY)});
        }
        drag.element.style.left = `${event.clientX - drag.offsetX}px`;
        drag.element.style.top = `${event.clientY - drag.offsetY}px`;
        const edge = dockEdgeAt(event.clientX, event.clientY);
        if (this.state.dockDropEdge !== edge) this.setState({dockDropEdge: edge});
    }

    endDockPointerDrag(event, cancelled = false) {
        const drag = this.dockPointerDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        this.dockPointerDrag = null;
        if (!drag.started) return;
        if (drag.originalStyle === null) drag.element.removeAttribute("style");
        else drag.element.setAttribute("style", drag.originalStyle);
        if (!cancelled) this.setDockPosition(drag.panel, dockEdgeAt(event.clientX, event.clientY));
        this.setState({draggedDock: null, dockDropEdge: null});
        this.scheduleBoardFit();
    }

    effectiveDockPositions(showProgramDock = true) {
        const {infoDock, programDock, boardViewWindowWidth} = this.state;
        const bothSide = showProgramDock && ["left", "right"].includes(infoDock) && ["left", "right"].includes(programDock);
        const compact = boardViewWindowWidth < 1000 || (bothSide && boardViewWindowWidth < 1200);
        if (!compact) return {info: infoDock, program: programDock, compact};
        const info = infoDock === "bottom" ? "bottom" : "top";
        let program = programDock === "top" ? "top" : "bottom";
        if (info === program) program = info === "top" ? "bottom" : "top";
        return {info, program, compact};
    }

    boardViewAngle() {
        return this.state.boardViewChoice === null
            ? (this.state.boardViewWindowWidth >= 1000 ? 90 : 0) : this.state.boardViewChoice;
    }

    rotateBoardView(delta) {
        const angle = (this.boardViewAngle() + delta + 360) % 360;
        localStorage.setItem(BOARD_VIEW_STORAGE_KEY, String(angle));
        this.setState({boardViewChoice: angle});
    }

    resetBoardViewAngle() {
        localStorage.removeItem(BOARD_VIEW_STORAGE_KEY);
        this.setState({boardViewChoice: null});
    }

    updateBoardViewWidth() {
        if (this.state.boardViewWindowWidth !== window.innerWidth)
            this.setState({boardViewWindowWidth: window.innerWidth,
                ...(this.state.boardViewWindowWidth >= 1000 && window.innerWidth < 1000 && !this.state.paused
                    ? {hudCollapsed: true} : this.state.boardViewWindowWidth < 1000 && window.innerWidth >= 1000
                    ? {hudCollapsed: false} : {})});
        this.scheduleBoardFit();
    }

    componentDidUpdate(previousProps, previousState) {
        if (previousState.phase !== this.state.phase || previousState.reentryUserId !== this.state.reentryUserId
            || previousState.round !== this.state.round || previousState.userId !== this.state.userId) {
            clearTimeout(this.reentryTimeout);
            if (this.state.reentryChoice || this.state.reentryPoweredDown !== null || this.state.reentryPending || this.state.reentryError)
                this.setState({reentryChoice: null, reentryPoweredDown: null, reentryPending: false, reentryError: null});
        } else if (this.state.reentryChoice?.direction && !this.reentryDraft()?.direction) {
            // A changed candidate or a newly blocked heading requires another explicit choice.
            this.setState({reentryChoice:this.reentryDraft()});
        }
        this.programReservation?.();
        this.infoReservation?.();
        this.scheduleBoardFit();
    }

    componentDidMount() {
        window.addEventListener("resize", this.updateBoardViewWidth);
        const initArgs = CommonRoom.roomInit(this);
        this.socket.on("state", (state) => {
            CommonRoom.processCommonRoom(state, this.state, {
                maxPlayers: 8,
                largeImageKey: "roborace",
                details: "RoboRace"
            }, this);
            const isPlayer = (state.playerSlots || []).includes(this.userId);
            const isProgrammingPlayer = isPlayer && state.phase === "programming";
            const programmingCueKey = isProgrammingPlayer ? String(state.round) : null;
            const timerCueKey = isProgrammingPlayer && state.programmingTimer
                ? `${state.round}:last` : null;
            const localState = {};
            if (state.paused && !this.state.paused)
                localState.hudCollapsed = false;
            if (!programmingCueKey) {
                this.lastProgrammingCueKey = null;
                localState.programmingCueActive = false;
                clearTimeout(this.programmingCueTimeout);
            } else if (programmingCueKey !== this.lastProgrammingCueKey) {
                this.lastProgrammingCueKey = programmingCueKey;
                localState.programmingCueActive = true;
                clearTimeout(this.programmingCueTimeout);
                this.programmingCueTimeout = setTimeout(() => this.setState({programmingCueActive: false}), 1300);
            }
            if (!timerCueKey) {
                this.lastTimerCueKey = null;
                localState.timerCueActive = false;
                clearTimeout(this.timerCueTimeout);
            } else if (timerCueKey !== this.lastTimerCueKey) {
                this.lastTimerCueKey = timerCueKey;
                localState.timerCueActive = true;
                clearTimeout(this.timerCueTimeout);
                this.timerCueTimeout = setTimeout(() => this.setState({timerCueActive: false}), 1600);
            }
            if (isProgrammingPlayer) {
                const timer = state.programmingTimer;
                document.title = timer
                    ? (timer.paused || state.paused ? "Таймер на паузе · RoboRace" : `${Math.max(0, Number(timer.remaining) || 0)} сек · RoboRace`)
                    : "Программирование · RoboRace";
            } else document.title = "RoboRace";
            if (state.phase !== "lobby" && !state.paused) localState.gameSettingsOpen = false;
            if (state.phase === "lobby") {
                this.dockPointerDrag = null;
                localState.draggedDock = null;
                localState.dockDropEdge = null;
            }
            this.setState({...state, ...localState, userId: this.userId, inited: true});
        });
        this.socket.on("player-state", (playerState) => {
            this.privateState = playerState;
            this.forceUpdate();
        });
        this.socket.on("message", (message) => popup.alert({content: message}));
        this.socket.on("ping", (id) => this.socket.emit("pong", id));
        this.socket.emit("init", initArgs);
    }

    componentWillUnmount() {
        window.removeEventListener("resize", this.updateBoardViewWidth);
        clearTimeout(this.programmingCueTimeout);
        clearTimeout(this.timerCueTimeout);
        clearTimeout(this.reentryTimeout);
        if (this.bottomDockObserver) this.bottomDockObserver.disconnect();
        if (this.infoDockObserver) this.infoDockObserver.disconnect();
        if (this.boardColumnObserver) this.boardColumnObserver.disconnect();
        if (this.boardFitFrame) cancelAnimationFrame(this.boardFitFrame);
        document.title = "RoboRace";
    }

    render() {
        const state = this.state;
        if (!state.inited) return <main className="loading">Подключение к арене RoboRace…</main>;
        const isPlayer = state.playerSlots.includes(state.userId);
        const showBottomDock = state.phase !== "lobby";
        const dockProgramming = bottomDockProgrammingState(state, isPlayer);
        const dockCueClasses = `${state.programmingCueActive ? " rr-phase-cue-active" : ""}${state.timerCueActive ? " rr-timer-cue-active" : ""}`;
        const historyReview = state.historyReview || {actual: true, playing: false, revision: 0};
        const reviewingHistory = state.paused && !historyReview.actual;
        const replayKey = reviewingHistory ? `history-${historyReview.revision}` : "live";
        const viewAngle = this.boardViewAngle();
        const reentryChoice = this.reentryDraft();
        const choosingReentry = state.phase === "reentry" && this.privateState.reentry?.active
            && state.reentryUserId === state.userId && !reviewingHistory;
        const reentryRobot = state.robots.find((robot) => robot.userId === state.userId);
        const boardWidth = state.boardViewportWidth && Math.round(state.boardViewportWidth * Math.pow(1.15, state.boardZoomSteps));
        const dockPositions = this.effectiveDockPositions(showBottomDock);
        return <React.Fragment>
        <CommonRoom state={state} app={this}/>
        <HostControls app={this} data={state} timerControls={[]}
            emitEvent={(...args) => this.socket.emit(...args)}/>
        <main className={`roborace-app ${state.phase !== "lobby" ? "rr-playing" : ""} ${dockPositions.compact ? "rr-docks-compact" : ""}`}
            data-info-dock={dockPositions.info} data-program-dock={dockPositions.program}>
            <header>
                <div><h1>RoboRace</h1><p>Комната {state.roomId} · {state.phase === "programming" ? "программирование" : state.phase === "resolving" ? "исполнение" : state.phase === "power-down-choice" ? "решение Перезагрузка" : state.phase === "reentry" ? "возрождение" : state.phase === "finished" ? "финиш" : "лобби"}</p></div>
                {state.phase !== "lobby" && dockPositions.compact ? <button type="button" className="rr-players-open" aria-haspopup="dialog"
                    aria-expanded={!state.hudCollapsed} onClick={() => this.setState({hudCollapsed: false})}>Игроки · {state.playerSlots.filter(Boolean).length}</button> : null}
                {state.userId === state.hostId && state.phase !== "lobby" ? <button onClick={() => this.socket.emit("restart-game")}>В лобби</button> : null}
            </header>
            {state.phase === "lobby" ? <Lobby state={state} app={this} onOpenGuide={this.openGuide} onOpenSettings={this.openGameSettings}/> : <div className={`game-screen ${state.paused ? "is-paused" : ""} ${reviewingHistory ? "is-history-review" : ""} ${historyReview.playing ? "is-history-playing" : ""}`}>
                {state.draggedDock ? <div className="rr-dock-drop-overlay" aria-hidden="true">
                    <div className={`rr-dock-snap-preview rr-dock-snap-${state.dockDropEdge} rr-dock-snap-${state.draggedDock}`}>
                        {DOCK_EDGES[state.dockDropEdge]}
                    </div>
                </div> : null}
                <PauseBanner state={state}/>
                <ProgrammingTimer state={state}/>
                <section className="game-layout">
                    <div className="board-column" ref={this.setBoardColumnRef}>
                        <div className={`board-viewport ${viewAngle % 180 ? "rr-view-landscape" : ""}`}
                            style={{width: boardWidth ? `${boardWidth}px` : "100%",
                                marginLeft: boardWidth ? `calc(50% - ${boardWidth / 2}px)` : undefined,
                                marginRight: 0}}>
                        <div className={`board-wrap ${boardViewClass(viewAngle)}`} style={{...boardViewStyle(viewAngle),
                            width: "100%"}}>
                            <div className="board rr-view-canvas" aria-label={`Игровое поле ${state.board.name}`}>
                            {state.course.customFeatures ? <div className={`factory-card ${state.course.customFeatures.fullField ? "rr-full-field" : ""}`}>
                                <CustomFactoryArt features={state.course.customFeatures}/></div>
                                : <img className="factory-card" draggable="false" style={{transform: `rotate(${state.course.rotation || 0}deg)`}}
                                    src={boardImageUrl(state, state.board.name)} />}
                            {!state.course.customFeatures?.fullField ? <img className="start-card" draggable="false" src={boardImageUrl(state, state.course.board)} /> : null}
                            <div className="board-overlay">
                                <BoardCheckpoints state={state}/>
                                {state.robots.filter((robot) => robot.archive && robot.archive.x != null && robot.archive.y != null && !robot.eliminated).map((robot) => <div className="archive-marker"
                                    key={`archive-${robot.userId}`} style={{left: `${(robot.archive.x+.64) / 12 * 100}%`, top: `${(robot.archive.y+.64) / 16 * 100}%`, "--archive-color": robot.color}}
                                    title={`Точка восстановления: ${playerName(state, robot.userId)}`}><ArchiveSymbol/></div>)}
                                {state.robots.filter((robot) => robot.death).map((robot) => <RobotDeath key={`${replayKey}-${robot.userId}-${robot.death.id}`} robot={robot}/>)}
                                {state.robots.map((robot) => <Robot key={robot.userId} robot={robot} state={state} ownUserId={state.userId}/>)}
                                <FieldLaserOverlay features={state.fieldFeatures}/>
                                <BoardEvents events={state.boardEvents} replayKey={replayKey}/>
                                <LaserEffects shots={state.laserShots} robots={state.robots} replayKey={replayKey} viewAngle={viewAngle}/></div>
                            {choosingReentry ? <div className="rr-reentry-targets" role="group" aria-label="Клетки возрождения">
                                {this.privateState.reentry.candidates.filter(candidate => !reentryChoice
                                    || (candidate.x === reentryChoice.x && candidate.y === reentryChoice.y)).map((candidate) => {
                                    const selected = reentryChoice?.x === candidate.x && reentryChoice?.y === candidate.y;
                                    return <button type="button" className={`rr-reentry-cell${selected ? " selected" : ""}`}
                                        key={`${candidate.x},${candidate.y}`} aria-pressed={selected}
                                        aria-label={selected && this.privateState.reentry.candidates.length > 1 ? "Выбрать другую клетку"
                                            : `${candidate.archive ? "Точка восстановления" : "Возрождение"}: столбец ${candidate.x + 1}, строка ${candidate.y + 1}`}
                                        disabled={state.paused || state.reentryPending}
                                        style={{gridColumn: candidate.x + 1, gridRow: candidate.y + 1}}
                                        onClick={event => {
                                            if (selected && this.privateState.reentry.candidates.length > 1) {
                                                const targets=event.currentTarget.parentElement;
                                                this.setState({reentryChoice:null,reentryError:null},()=>targets.querySelector(".rr-reentry-cell")?.focus());
                                            } else if (!selected) this.selectReentry(candidate);
                                        }}/>;
                                })}
                                {reentryChoice ? <div className={`rr-reentry-ghost${reentryChoice.direction ? "" : " rr-direction-unset"}`} aria-hidden="true">
                                    <Robot state={state} robot={{...reentryRobot, ...reentryChoice, eliminated: false,
                                        color: reentryRobot?.color || state.playerColors?.[state.userId] || "#8de2d4",
                                        headingTurns: reentryChoice.direction ? DIRECTION_ANGLES[reentryChoice.direction] / 90 : 0}}/>
                                </div> : null}
                            </div> : null}
                            <BoardHints state={state} enabled={state.boardHintsEnabled && !choosingReentry} viewAngle={viewAngle}/>
                            </div>
                        </div>
                        {choosingReentry ? <ReentryDirections choice={reentryChoice} reentry={this.privateState.reentry}
                            viewAngle={viewAngle} width={boardWidth} disabled={state.paused || state.reentryPending} app={this}/> : null}
                        </div>
                    </div>
                    <PlayersOverlay open={dockPositions.compact && !state.hudCollapsed} onClose={() => this.setState({hudCollapsed: true})}>
                    <aside ref={this.setInfoDockRef} className={`game-side-hud ${state.hudCollapsed ? "collapsed" : ""} ${state.draggedDock === "info" ? "rr-dock-being-dragged" : ""}`}>
                        <div className="dock-title"><strong>
                            {state.hudCollapsed ? "Игроки" : `Раунд ${state.round}`}</strong>
                            <button type="button" className="rr-dock-collapse-button" aria-expanded={!state.hudCollapsed}
                                aria-label={dockPositions.compact ? "Закрыть игроков" : state.hudCollapsed ? "Показать информационную панель" : "Свернуть информационную панель"}
                                title={state.hudCollapsed ? "Показать панель" : "Свернуть панель"}
                                onClick={() => this.setState({hudCollapsed: !state.hudCollapsed})}>
                                {state.hudCollapsed ? "▴" : "▾"}</button>
                            <DockPlacementControl app={this} panel="info" effectivePosition={dockPositions.info}/></div>
                        <div className="dock-scroll">
                        <PlayerPanel state={state} app={this}/>
                        <details className="rr-game-disclosure rr-game-guide" open={state.guideExpanded} onToggle={event=>{
                            const open=event.currentTarget.open;
                            if(open!==this.state.guideExpanded){localStorage.setItem("roborace-guide-expanded",String(open));this.setState({guideExpanded:open});}
                        }}><summary>Справочник</summary>
                            <QuickGuide onOpen={this.openGuide} onOpenConveyors={this.openConveyorGuide} onOpenCollisions={this.openCollisionGuide}/>
                        </details>
                        <details className="rr-game-disclosure rr-game-journal"><summary>Системный журнал</summary>
                            <section className="rr-panel log" aria-label="Системный журнал">{state.log.map((item, index) => <p key={index}>{item}</p>)}</section>
                        </details>
                        <HistoryReviewPanel state={state} app={this}/>
                        <GamePauseControls state={state} app={this}/>
                        </div>
                        <div className="rr-hud-footer">
                        <div className="board-toolbar rr-panel" aria-label="Управление видом поля">
                            <div className="rr-board-zoom-controls" role="group" aria-label="Размер поля">
                                <button type="button" aria-label="Уменьшить поле" title="Уменьшить поле"
                                    disabled={state.boardZoomSteps <= -6}
                                    onClick={() => this.setState({boardZoomSteps: Math.max(-6, state.boardZoomSteps - 1)})}>−</button>
                                <button type="button" aria-label="Автоматический размер поля" title="Автоматический размер поля"
                                    disabled={state.boardZoomSteps === 0}
                                    onClick={() => this.setState({boardZoomSteps: 0})}>⤢</button>
                                <button type="button" aria-label="Увеличить поле" title="Увеличить поле"
                                    disabled={state.boardZoomSteps >= 8}
                                    onClick={() => this.setState({boardZoomSteps: Math.min(8, state.boardZoomSteps + 1)})}>+</button>
                            </div>
                            <BoardViewControls app={this}/>
                            <button type="button" className={`board-hints-toggle ${state.boardHintsEnabled ? "active" : ""}`}
                                title="Включить или отключить подсказки элементов поля" aria-label="Подсказки элементов поля"
                                aria-pressed={state.boardHintsEnabled} onClick={() => {
                                    const enabled = !state.boardHintsEnabled;
                                    localStorage.setItem("roborace-board-hints", String(enabled));
                                    this.setState({boardHintsEnabled: enabled});
                                }}>?</button>
                        </div>
                        <section className="rr-panel stage" role="status"><h2>{state.phase === "resolving" ? `Регистр ${state.register} / 5` : "Сейчас"}</h2>
                            <p>{reviewingHistory ? `Журнал: ${state.stage}` : state.paused ? "Игра на паузе" : state.phase === "resolving" ? state.stage : state.phase === "programming" ? "Выбор программы" : state.phase === "reentry" ? "Возрождение роботов" : state.phase === "power-down-choice" ? "Решение Перезагрузка" : "Заезд завершён"}</p></section>
                        </div>
                    </aside>
                    </PlayersOverlay>
                </section>
                {showBottomDock ? <section ref={this.setBottomDockRef} className={`bottom-dock ${["top", "bottom"].includes(dockPositions.program) ? "rr-personal-horizontal" : ""} ${state.bottomDockCollapsed ? "collapsed" : ""} ${state.draggedDock === "program" ? "rr-dock-being-dragged" : ""} ${dockProgramming.className}${dockCueClasses}`}>
                    <div className="rr-program-reserve-probe" aria-hidden="true"/>
                    <div className="rr-program-dock-actions"><button className="bottom-dock-toggle rr-dock-collapse-button" type="button"
                        onClick={() => this.setState({bottomDockCollapsed: !state.bottomDockCollapsed})}
                        aria-label={state.bottomDockCollapsed ? "Показать панель программирования" : "Свернуть панель программирования"}
                        aria-expanded={!state.bottomDockCollapsed}
                        title={state.bottomDockCollapsed ? "Показать панель" : "Свернуть панель"}>
                        <span className="rr-dock-status-text" role="status" aria-live="polite">
                            {dockProgramming.label || (state.bottomDockCollapsed ? "Показать игровую панель" : "Свернуть")}
                        </span>
                        <span className="rr-dock-chevron" aria-hidden="true">{state.bottomDockCollapsed ? "▴" : "▾"}</span>
                    </button>
                    <DockPlacementControl app={this} panel="program" effectivePosition={dockPositions.program}/></div>
                    <div className="bottom-dock-scroll">
                        <Program state={state} privateState={this.privateState} app={this}/>
                        {state.phase === "programming" && !isPlayer ? <section className="rr-panel rr-program-waiting" role="status"><p>Игроки выбирают программы.</p></section> : null}
                        <PowerDownChoicePanel state={state} privateState={this.privateState} app={this}/>
                        <ReentryPanel state={state} privateState={this.privateState} app={this} choice={reentryChoice} viewAngle={viewAngle}/>
                        {state.phase === "resolving" ? <p className="rr-live-stage" role="status">Регистр {state.register} / 5 · {state.stage}</p> : null}
                        {state.phase === "finished" ? <section className="winner rr-panel"><h2>Победитель: {playerName(state, state.winnerId)}</h2>
                            <p>{state.winnerReason === "last-robot-standing" ? "Все остальные роботы потеряли последние жизни." : "Все контрольные флаги активированы."}</p>
                        </section> : null}
                    </div>
                </section> : null}
            </div>}
            <GuideModal open={state.guideOpen} onClose={this.closeGuide} returnFocus={this.guideReturnFocus} options={state.gameOptions}/>
            <GameSettingsModal open={state.gameSettingsOpen} state={state} app={this} onClose={this.closeGameSettings} returnFocus={this.settingsReturnFocus}/>
            <FieldExampleModal open={!!state.fieldExample} kind={state.fieldExample} onClose={this.closeFieldExample} returnFocus={this.fieldExampleReturnFocus}/>
        </main>
        </React.Fragment>;
    }
}

ReactDOM.render(<Game/>, document.getElementById("root"));
