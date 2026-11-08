(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.RaceArt = factory();
}(typeof window !== "undefined" ? window : this, function () {
    "use strict";
    const vectors = {north:[0,-1],east:[1,0],south:[0,1],west:[-1,0]};
    const opposite = {north:"south",east:"west",south:"north",west:"east"};
    const angles = {east:0,south:90,west:180,north:270};
    const list = value => value instanceof Set ? [...value] : value || [];
    const point = key => key.split(",").map(Number);
    const safeId = value => String(value || "arena").replace(/[^a-zA-Z0-9_-]/g,"-");
    function wallLine(x,y,direction) {
        if (direction === "north") return [x,y,x+1,y];
        if (direction === "south") return [x,y+1,x+1,y+1];
        if (direction === "west") return [x,y,x,y+1];
        return [x+1,y,x+1,y+1];
    }
    function boundaryEdge(x,y,direction,columns,offset,rows) {
        return direction==="north" ? y===offset : direction==="south" ? y+1===offset+rows
            : direction==="west" ? x===0 : x+1===columns;
    }
    function laserSegments(features,options={}){
        const walls=new Set(list(features.walls)),rows=options.rows||16,columns=options.columns||12,offset=options.offsetY||0;
        const blocked=(x,y,d)=>{const [dx,dy]=vectors[d];return walls.has(`${x},${y},${d}`)||walls.has(`${x+dx},${y+dy},${opposite[d]}`);};
        return (features.lasers||[]).flatMap((laser,index)=>{
            if(!vectors[laser.direction])return [];
            const [dx,dy]=vectors[laser.direction];let ex=laser.x,ey=laser.y;
            while(!blocked(ex,ey,laser.direction)){
                const nx=ex+dx,ny=ey+dy;if(nx<0||nx>=columns||ny<offset||ny>=offset+rows)break;
                ex=nx;ey=ny;
            }
            const mountedOutside=boundaryEdge(laser.x,laser.y,opposite[laser.direction],columns,offset,rows)
                &&blocked(laser.x,laser.y,opposite[laser.direction]);
            const hitsOutside=boundaryEdge(ex,ey,laser.direction,columns,offset,rows)&&blocked(ex,ey,laser.direction);
            const sourceReach=mountedOutside ? .09 : .37,endReach=hitsOutside ? .27 : .45;
            return Array.from({length:laser.count||1},(_,i)=>{
                const shift=(i-((laser.count||1)-1)/2)*.12;
                return {x1:laser.x+.5-dx*sourceReach-dy*shift,y1:laser.y+.5-dy*sourceReach+dx*shift,
                    x2:ex+.5+dx*endReach-dy*shift,y2:ey+.5+dy*endReach+dx*shift,source:index};
            });
        });
    }
    function render(features, options = {}) {
        const f = features || {}, rows = options.rows || 12, columns = options.columns || 12;
        const offset = options.offsetY || 0, id = safeId(options.id);
        const walls = new Set(list(f.walls)), pits = new Set(list(f.pits)), express = new Set(list(f.express));
        const conveyors = f.conveyors || {}, rawConnections = f.conveyorConnections;
        const connections = rawConnections == null ? null : new Set(list(rawConnections));
        const blocked = (x,y,d) => {
            const [dx,dy] = vectors[d];
            return walls.has(`${x},${y},${d}`) || walls.has(`${x+dx},${y+dy},${opposite[d]}`);
        };
        const out = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 ${offset*100} ${columns*100} ${rows*100}" class="race-arena-svg" aria-hidden="true"><defs>`];
        out.push(`<linearGradient id="${id}-surface" x2=".2" y2="1"><stop stop-color="#ffffff" stop-opacity=".15"/><stop offset=".4" stop-color="#ffffff" stop-opacity=".03"/><stop offset="1" stop-color="#2b3940" stop-opacity=".15"/></linearGradient>`,
            `<g id="${id}-panel"><path d="M6 2H94L98 6V94L94 98H6L2 94V6Z" fill="url(#${id}-surface)" stroke="#657378" stroke-opacity=".7" stroke-width="1.2"/><path d="M7 4H93L96 7M4 8V92" fill="none" stroke="#fbffff" stroke-opacity=".7" stroke-width="1.7"/><path d="M7 96H93L96 93V9" fill="none" stroke="#3c4a4d" stroke-opacity=".45" stroke-width="1.5"/><path d="M13 25V13H25M75 87h12V75" fill="none" stroke="#5b696c" stroke-opacity=".27" stroke-width="1"/><g fill="#58666a" stroke="#dbe0dc" stroke-width=".7"><circle cx="10" cy="10" r="2.5"/><circle cx="90" cy="90" r="2.5"/></g><path d="M8 10h4M88 90h4" stroke="#283d42" stroke-width=".8"/><path d="M20 90h17m3 0h5" stroke="#5b6b6d" stroke-opacity=".3" stroke-width="1.5"/><path d="M86 14h3v13h-3Z" fill="#edf1ec" fill-opacity=".4"/></g>`);
        out.push(`<linearGradient id="${id}-metal" x2=".2" y2="1"><stop stop-color="#b7c9d5"/><stop offset=".42" stop-color="#657d93"/><stop offset="1" stop-color="#324957"/></linearGradient>`,
            `<radialGradient id="${id}-platform-cw"><stop stop-color="#796443"/><stop offset=".7" stop-color="#4c4438"/><stop offset="1" stop-color="#263440"/></radialGradient>`,
            `<radialGradient id="${id}-platform-ccw"><stop stop-color="#65628c"/><stop offset=".7" stop-color="#45455f"/><stop offset="1" stop-color="#263040"/></radialGradient>`,
            `<linearGradient id="${id}-barrier" x2="0" y2="1"><stop stop-color="#8bb8df"/><stop offset=".24" stop-color="#5083b5"/><stop offset=".25" stop-color="#2e5c88"/><stop offset="1" stop-color="#163652"/></linearGradient>`,
            `<linearGradient id="${id}-rubber" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100"><stop stop-color="#34444a"/><stop offset=".3" stop-color="#19262c"/><stop offset=".7" stop-color="#233138"/><stop offset="1" stop-color="#0f1b22"/></linearGradient>`,
            `<linearGradient id="${id}-housing" x2=".8" y2="1"><stop stop-color="#bac8c9"/><stop offset=".22" stop-color="#748b93"/><stop offset=".23" stop-color="#3f555f"/><stop offset=".8" stop-color="#293a43"/><stop offset="1" stop-color="#14242c"/></linearGradient>`,
            `<radialGradient id="${id}-lens" cx=".3" cy=".3"><stop stop-color="#fff9e5"/><stop offset=".25" stop-color="#ffc5b0"/><stop offset=".6" stop-color="#e77770"/><stop offset="1" stop-color="#7e2c3d"/></radialGradient>`,
            `<g id="${id}-chevron"><path d="M-13-18 6 0-13 18H-2L17 0-2-18Z" stroke="#0b2028" stroke-width="2" stroke-linejoin="round"/><path d="M-11-16 6 0-11 16" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.5"/></g>`,
            `<filter id="${id}-rim" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter></defs>`,
            `<rect x="0" y="${offset*100}" width="${columns*100}" height="${rows*100}" fill="#b7bcb9"/>`);
        for(let y=offset;y<offset+rows;y++)for(let x=0;x<columns;x++){
            if((x+y)%2)out.push(`<rect x="${x*100}" y="${y*100}" width="100" height="100" fill="#24353c" opacity=".045"/>`);
            out.push(`<use href="#${id}-panel" x="${x*100}" y="${y*100}"/>`);
        }
        if (pits.size) {
            const area = [...pits].map(key => {const [x,y]=point(key);return `M${x*100} ${y*100}h100v100h-100Z`;}).join("");
            const edges = [],teeth=[];
            for (const key of pits) {
                const [x,y] = point(key);
                for (const [d,[dx,dy]] of Object.entries(vectors)) {
                    if (pits.has(`${x+dx},${y+dy}`)) continue;
                    const [x1,y1,x2,y2] = wallLine(x,y,d);
                    edges.push(`M${x1*100} ${y1*100}L${x2*100} ${y2*100}`);
                    for(const t of [.2,.5,.8]){
                        const cx=(x1+(x2-x1)*t)*100,cy=(y1+(y2-y1)*t)*100,tx=(x2-x1)*3.5,ty=(y2-y1)*3.5;
                        teeth.push(`M${cx-tx} ${cy-ty}L${cx+tx} ${cy+ty}L${cx-dx*8} ${cy-dy*8}Z`);
                    }
                }
            }
            out.push(`<defs><clipPath id="${id}-pit"><path d="${area}"/></clipPath></defs>`,
                `<g class="race-pits"><path class="race-pit" d="${area}" fill="#070d16"/>`,
                `<path d="${edges.join("")}" fill="none" stroke="#a17b6f" stroke-width="24" opacity=".48" filter="url(#${id}-rim)" clip-path="url(#${id}-pit)"/>`,
                `<path d="${edges.join("")}" fill="none" stroke="#241f22" stroke-width="10"/>`,
                `<path class="race-pit-edge" d="${edges.join("")}" fill="none" stroke="#b3764c" stroke-width="3"/>`,
                `<path class="race-pit-teeth" d="${teeth.join("")}" fill="#edb47c" clip-path="url(#${id}-pit)"/></g>`);
        }
        for (const [key,outgoing] of Object.entries(conveyors)) {
            if (!vectors[outgoing]) continue;
            const [x,y]=point(key), color=express.has(key)?"#65d9cf":"#f1ba66";
            const inlets = Object.keys(vectors).filter(d => {
                const [dx,dy]=vectors[d], from=`${x-dx},${y-dy}`;
                return conveyors[from]===d && outgoing!==opposite[d] && !blocked(x-dx,y-dy,d)
                    && (!connections || connections.has(`${from}|${key}`));
            });
            const flow = inlets.length ? inlets : [outgoing];
            const [ox,oy]=vectors[outgoing];
            const paths=flow.map(d=>{const [ix,iy]=vectors[d];const sx=50-ix*50,sy=50-iy*50,ex=50+ox*50,ey=50+oy*50;
                return d===outgoing ? `M${sx} ${sy}L${ex} ${ey}` : `M${sx} ${sy}C${sx+ix*34} ${sy+iy*34} ${ex-ox*34} ${ey-oy*34} ${ex} ${ey}`;});
            const joined=inlets.length>1 || inlets.some(d=>d!==outgoing);
            out.push(`<g class="race-belt${joined?" race-junction":""}${express.has(key)?" race-express":""}" data-cell="${key}" transform="translate(${x*100} ${y*100})">`);
            for (const d of paths) out.push(`<path d="${d}" fill="none" stroke="#202b30" stroke-width="94"/><path d="${d}" fill="none" stroke="#edf0e5" stroke-opacity=".7" stroke-width="88"/>`);
            for (const d of paths) out.push(`<path d="${d}" fill="none" stroke="#96aba9" stroke-width="85"/><path d="${d}" fill="none" stroke="${express.has(key)?"#85bab9":"#c8b384"}" stroke-width="80" stroke-dasharray="4 6"/>`);
            for (const d of paths) out.push(`<path d="${d}" fill="none" stroke="#121e24" stroke-width="66"/>`);
            for (const d of paths) out.push(`<path d="${d}" fill="none" stroke="url(#${id}-rubber)" stroke-width="61"/>`);
            // Slats meet at the junction, rather than crossing over each other.
            const treads=flow.length>1 ? [
                ...flow.map(d=>{const [ix,iy]=vectors[d];return `M${50-ix*50} ${50-iy*50}l${ix*22} ${iy*22}`;}),
                `M${50+ox*28} ${50+oy*28}l${ox*22} ${oy*22}`] : paths;
            for(const d of treads)out.push(`<path d="${d}" fill="none" stroke="#536065" stroke-opacity=".5" stroke-width="59" stroke-dasharray="1.5 8.5"/>`);
            const markId=`${id}-marks-${x}-${y}`;
            if(joined){
                out.push(`<defs><mask id="${markId}" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><g fill="none" stroke="#fff" stroke-width="54">${paths.map(d=>`<path d="${d}"/>`).join("")}</g></mask></defs>`);
            }
            out.push(`<g class="race-belt-markings"${joined?` mask="url(#${markId})"`:""}>`);
            if(joined){
                const arrows=flow.map(d=>{const [ix,iy]=vectors[d],sx=50-ix*35,sy=50-iy*35,ex=50+ox*30,ey=50+oy*30;
                    return d===outgoing?`M${sx} ${sy}L${ex} ${ey}`:`M${sx} ${sy}C${sx+ix*24} ${sy+iy*24} ${ex-ox*24} ${ey-oy*24} ${ex} ${ey}`;});
                for(const d of arrows)out.push(`<path class="race-flow-arrow" d="${d}" fill="none" stroke="#10232b" stroke-width="11" stroke-linecap="round"/>`);
                for(const d of arrows)out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="6.5" stroke-linecap="round"/>`);
                for(const d of arrows)out.push(`<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="1.5"/>`);
            }
            out.push(`<g transform="rotate(${angles[outgoing]} 50 50)" fill="${color}">`);
            for(const center of (joined?(express.has(key)?[74,87]:[80]):(express.has(key)?[38,65]:[51])))
                out.push(`<use href="#${id}-chevron" transform="translate(${center} 50)${joined?` scale(${express.has(key)?.66:.88})`:""}"/>`);
            out.push(`</g></g></g>`);
        }
        for (const key of list(f.repairs)) {
            const [x,y]=point(key);
            out.push(`<g class="race-repair" data-cell="${key}" transform="translate(${x*100+50} ${y*100+50})">${repairMarkup()}</g>`);
        }
        for (const [key,turn] of Object.entries(f.gears || {})) {
            const [x,y]=point(key);
            const clockwise=turn===1,accent=clockwise?"#f4c079":"#c3a8f0";
            out.push(`<g class="race-gear ${clockwise?"race-gear-cw":"race-gear-ccw"}" data-cell="${key}" transform="translate(${x*100+50} ${y*100+50})"><circle cy="3" r="43" fill="#243d50"/><circle r="42" fill="url(#${id}-metal)" stroke="#40576c" stroke-width="3"/><circle r="37" fill="none" stroke="${accent}" stroke-width="4" stroke-dasharray="4 5"/><circle r="31" fill="url(#${id}-platform-${clockwise?"cw":"ccw"})" stroke="#192d40" stroke-width="2"/><circle r="5" fill="#8d9ba7" stroke="#e4e9df" stroke-width="1.5"/><g class="race-gear-arrow" transform="scale(${clockwise?1:-1} 1)" fill="${accent}"><path d="M-14.14 14.14A20 20 0 1 1 17.32 10" fill="none" stroke="${accent}" stroke-width="4.5" stroke-linecap="round"/><path d="M15.82 12.6 15.62 .94 26.02 6.94Z"/></g></g>`);
        }
        const physical = new Set(),outerWalls=[];
        for (const wall of walls) {
            const [x,y,d]=wall.split(","), line=wallLine(+x,+y,d), key=[line[0],line[1],line[2],line[3]].join();
            if (physical.has(key)) continue;
            physical.add(key);
            const angle=line[0]===line[2]?90:0;
            // The solid rim reaches the image edge; its shadow faces into the arena.
            // Outer walls cover terrain and the recessed backs of mounted devices.
            let edge=null,normal=1;
            if(angle===90){
                if(line[0]===0){line[0]=.11;edge="west";normal=-1;}
                else if(line[0]===columns){line[0]=columns-.11;edge="east";}
            }else{
                if(line[1]===offset){line[1]=offset+.11;edge="north";}
                else if(line[1]===offset+rows){line[1]=offset+rows-.11;edge="south";normal=-1;}
            }
            (edge?outerWalls:out).push(`<g class="race-wall"${edge?` data-boundary="${edge}"`:""} transform="translate(${line[0]*100} ${line[1]*100}) rotate(${angle}) scale(1 ${normal})"><path d="M0-10H100V15H0Z" fill="#102534" opacity=".5"/><path d="M0-10H100V10H0Z" fill="url(#${id}-barrier)" stroke="#153752" stroke-width="2"/><path d="M4-7H96" stroke="#c1e0f7" stroke-width="2"/><path d="M4 7H96" stroke="#102e4b" stroke-width="2"/><path d="M24-3h52v6H24Z" fill="#152f4c"/><path d="M29-2h42v2H29Z" fill="#85b7e2"/><path d="M49-5v10" stroke="#173c5c" stroke-width="3"/><g fill="#d7dfe2" stroke="#153951" stroke-width="1.5"><circle cx="11" r="3.5"/><circle cx="89" r="3.5"/></g></g>`);
        }
        for (const laser of f.lasers || []) {
            if (!vectors[laser.direction]) continue;
            const count=laser.count||1;
            if(options.beams!==false)for(const segment of laserSegments({walls,lasers:[laser]},{rows,columns,offsetY:offset}))
                out.push(`<path class="race-static-laser" d="M${segment.x1*100} ${segment.y1*100}L${segment.x2*100} ${segment.y2*100}" fill="none" stroke="#f6818a" stroke-opacity=".65" stroke-width="3"/>`);
            out.push(`<g class="race-laser-source" transform="translate(${(laser.x+.5)*100} ${(laser.y+.5)*100}) rotate(${angles[laser.direction]})"><path d="M-48-27h25l9 10v38l-9 10h-25Z" fill="#14232d" opacity=".45"/><path d="M-48-29h24l8 9v40l-8 9h-24Z" fill="url(#${id}-housing)" stroke="#223941" stroke-width="2"/><path d="M-43-23v46M-36-21v42" stroke="#b4c4c3" stroke-width="2"/><path d="M-23-18h14v36h-14Z" fill="#1f2c36" stroke="#a67d77" stroke-width="2"/><path d="M-9-17v34" stroke="#ffd5b3" stroke-width="2"/><g fill="url(#${id}-lens)" stroke="#ed9d8e" stroke-width="1">${Array.from({length:count},(_,i)=>`<ellipse cx="-9" cy="${(i-(count-1)/2)*12}" rx="4" ry="5"/>`).join("")}</g><path d="M-42-24h14M-42 24h14" stroke="#dbad7b" stroke-width="2"/><g fill="#142d35" stroke="#93a3a5" stroke-width=".7"><circle cx="-43" cy="-19" r="2"/><circle cx="-43" cy="19" r="2"/></g></g>`);
        }
        for (const pusher of f.pushers || []) {
            if(!vectors[pusher.direction])continue;
            const[dx,dy]=vectors[pusher.direction],vertical=dx!==0,active=[...(pusher.active||[])].sort((a,b)=>a-b);
            const mounting=opposite[pusher.direction];
            const inset=boundaryEdge(pusher.x,pusher.y,mounting,columns,offset,rows)&&blocked(pusher.x,pusher.y,mounting)?20:0;
            const spacing=active.length>3?18:20,positions=active.map((_,i)=>(i-(active.length-1)/2)*spacing);
            const length=active.length>3?(active.length-1)*spacing+22:62,width=vertical?20:length,height=vertical?length:20;
            out.push(`<g class="race-pusher" data-cell="${pusher.x},${pusher.y}" data-direction="${pusher.direction}"${inset?' data-boundary-mount="true"':""} transform="translate(${pusher.x*100} ${pusher.y*100})"><rect x="12" y="12" width="76" height="76" rx="9" fill="#304b54" fill-opacity=".14"/><path d="M${50-dx*50} ${50-dy*50}L${50+dx*inset-dx*34} ${50+dy*inset-dy*34}" stroke="#29424d" stroke-width="16"/><g class="race-pusher-body" transform="translate(${50+dx*inset} ${50+dy*inset}) rotate(${angles[pusher.direction]}) scale(.72)"><path d="M-48-35h27v70h-27Z" fill="url(#${id}-housing)" stroke="#26383f" stroke-width="2"/><path d="M-20-21h22M-20 21H2" stroke="#243a43" stroke-width="10"/><path d="M-20-23h22M-20 19H2" stroke="#d5d8cc" stroke-width="5"/><path d="M-6-31H6V31H-6Z" fill="url(#${id}-metal)" stroke="#273e47" stroke-width="2"/><path d="M7-28V28" stroke="#d6b876" stroke-width="3"/><path d="M15-12 27 0 15 12" fill="none" stroke="#695e45" stroke-width="4"/><path d="M-43-28h13M-43 28h13" stroke="#bdc7b7" stroke-width="2"/></g>`);
            // The plate follows the mounting wall; each digit stays upright.
            out.push(`<g class="race-pusher-schedule" transform="translate(${50+dx*inset-dx*35} ${50+dy*inset-dy*35})"><rect x="${-width/2}" y="${-height/2}" width="${width}" height="${height}" rx="4" fill="#21353f" stroke="#d6bd85" stroke-width="1.5"/>`);
            for(let i=0;i<active.length;i++){
                out.push(`<text x="${vertical?0:positions[i]}" y="${5+(vertical?positions[i]:0)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#fff1c6">${active[i]}</text>`);
                if(i)out.push(`<circle cx="${vertical?0:(positions[i-1]+positions[i])/2}" cy="${vertical?(positions[i-1]+positions[i])/2:0}" r=".8" fill="#fff1c6"/>`);
            }
            out.push(`</g></g>`);
        }
        for (const [index,start] of (options.starts || f.starts || []).entries()) {
            const slot=start.slot||index+1;
            out.push(`<g class="race-start" transform="translate(${(start.x+.5)*100} ${(start.y+.5)*100})" opacity=".8"><path class="race-start-paint" d="M-23-29H-33V29H-23M23-29H33V29H23M-23 33H23M-9-23 0-32 9-23" fill="none" stroke="#365b61" stroke-width="3.5"/><text y="17" text-anchor="middle" font-family="monospace" font-weight="700" font-size="38" fill="#284d56" stroke="#e0e9da" stroke-width=".6" paint-order="stroke">${Number(slot)}</text></g>`);
        }
        if(outerWalls.length)out.push(`<g class="race-outer-walls">${outerWalls.join("")}</g>`);
        out.push("</svg>");
        // xlink keeps the offline bitmap renderer and browser output identical.
        return out.join("").replace(/\bhref=/g,"xlink:href=");
    }
    function repairMarkup(translucent=false) {
        const backing=translucent?' fill-opacity=".25"':"",ink=translucent?' stroke-opacity=".75"':"";
        return `<path d="M-35-21L0-40 35-21V21L0 40-35 21Z" fill="#2b615f"${backing} stroke="#1a4449" stroke-width="5"/><path d="M-29-17L0-33 29-17V17L0 33-29 17Z" fill="#439488"${backing} stroke="#b7f5cc" stroke-width="2"${ink}/><path d="M-15 0h30M0-15v30" fill="none" stroke="#dcffe5" stroke-width="9" stroke-linecap="round"${ink}/><circle cx="-27" cy="22" r="2" fill="#c6f7dc"/><circle cx="27" cy="-22" r="2" fill="#c6f7dc"/><circle r="44" fill="none" stroke="#347d72" stroke-opacity=".45" stroke-width="2"/>`;
    }
    // An open centre preserves the mechanism. The corner number and repair sign
    // stay upright together with the checkpoint, independently of the arena view.
    function checkpointMarkup(number) {
        const outline="M8 26V8H26M74 8H92V26M8 74V92H26M74 92H92V74";
        return `<g class="race-checkpoint" opacity=".85"><path d="${outline}" fill="none" stroke="#173b2b" stroke-width="8"/><path class="race-checkpoint-frame" d="${outline}" fill="none" stroke="#edff9b" stroke-width="3"/><text class="race-checkpoint-number" x="72" y="45" text-anchor="middle" font-family="Arial,sans-serif" font-size="44" font-weight="900" fill="#edff9b" stroke="#173b2b" stroke-width="6" paint-order="stroke">${Number(number)}</text><g class="race-checkpoint-repair" transform="translate(72 72) scale(.4)">${repairMarkup(true)}</g></g>`;
    }
    return {render,laserSegments,checkpointMarkup};
}));
