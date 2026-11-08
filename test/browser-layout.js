"use strict";

const assert = require("assert");
const {launchBrowser, openUser, startSandbox, stopSandbox} = require("./browser-support");

const port = process.env.LAYOUT_BROWSER_PORT || "3051";
const {server, ready} = startSandbox(port);
let browser;

(async () => {
    await ready;
    browser = await launchBrowser();
    const host = (await openUser(browser, {port, room: "layout-browser", name: "Host", timeout: 15000})).page;
    const guest = (await openUser(browser, {port, room: "layout-browser", name: "Guest", timeout: 15000})).page;
    await host.getByRole("button", {name: "Присоединиться к игре"}).click();
    await guest.getByRole("button", {name: "Присоединиться к игре"}).click();
    const trackFieldRenders=()=>host.evaluate(()=>{const render=RaceArt.render;window.gameFieldRenders=0;
        RaceArt.render=(...args)=>{window.gameFieldRenders++;return render(...args);};});
    await trackFieldRenders();
    await host.getByRole("button", {name: "Начать игру"}).click();
    await host.locator(".program .cards .card").first().waitFor();

    for (const viewport of [{width: 1440, height: 900}, {width: 1366, height: 650},
        {width: 1230, height: 530}, {width: 1024, height: 650}, {width: 800, height: 600},
        {width: 390, height: 760}]) {
        await host.setViewportSize(viewport);
        await host.waitForFunction((landscape) => document.querySelector(".board-viewport")
            ?.classList.contains("rr-view-landscape") === landscape, viewport.width >= 1000);
        await host.waitForFunction((compact) => document.querySelector(".roborace-app")
            ?.classList.contains("rr-docks-compact") === compact, viewport.width < 1000);
        if([1440,800,390].includes(viewport.width)){
            const toggle=host.locator(".rr-program-dock-actions > .bottom-dock-toggle");
            await toggle.click();
            await host.waitForFunction(()=>document.querySelector(".bottom-dock")?.classList.contains("collapsed"));
            const reachable=await toggle.evaluate(button=>{
                const b=button.getBoundingClientRect(),dock=button.closest(".bottom-dock").getBoundingClientRect();
                return b.width>20&&b.height>20&&b.left>=dock.left&&b.right<=dock.right+1&&b.top>=dock.top&&b.bottom<=dock.bottom+1
                    &&button.contains(document.elementFromPoint(b.left+b.width/2,b.top+b.height/2));
            });
            assert(reachable,`${viewport.width}: collapsed program dock has no reachable expand button`);
            await toggle.click();
            await host.waitForFunction(()=>!document.querySelector(".bottom-dock")?.classList.contains("collapsed"));
        }
        const view = await host.locator(".board-viewport").evaluate((element) => {
            const frame = element.getBoundingClientRect();
            const start = element.querySelector(".start-card").getBoundingClientRect();
            const factory = element.querySelector(".factory-card").getBoundingClientRect();
            return {landscape: element.classList.contains("rr-view-landscape"), ratio: frame.width / frame.height,
                startBeforeFactory: start.right <= factory.left + 2, startBelowFactory: start.top >= factory.bottom - 2};
        });
        assert.equal(view.landscape, viewport.width >= 1000,
            `${viewport.width}×${viewport.height}: automatic field orientation is wrong`);
        assert(Math.abs(view.ratio - (view.landscape ? 4/3 : 3/4)) < .03,
            `${viewport.width}×${viewport.height}: field frame has wrong aspect ratio`);
        assert(view.landscape ? view.startBeforeFactory : view.startBelowFactory,
            `${viewport.width}×${viewport.height}: start card is on the wrong side`);
        if(viewport.width<1000)await host.locator(".rr-players-open").click();
        const controls = await host.locator(".board-toolbar").evaluate((toolbar) => {
            const zoom = toolbar.querySelector(".rr-board-zoom-controls").getBoundingClientRect();
            const view = toolbar.querySelector(".rr-view-controls").getBoundingClientRect();
            const hints = toolbar.querySelector(".board-hints-toggle").getBoundingClientRect();
            return {fits: toolbar.scrollWidth <= toolbar.clientWidth + 1,
                hasZoom: toolbar.querySelectorAll(".rr-board-zoom-controls > button").length === 3,
                hasView: !!toolbar.querySelector(".rr-view-controls"),
                hasHints: !!toolbar.querySelector(".board-hints-toggle"),
                sameRow: Math.abs(zoom.top - view.top) <= 4 && Math.abs(view.top - hints.top) <= 4,
                hintsHaveNeighbor: Math.abs(zoom.top - hints.top) <= 4 || Math.abs(view.top - hints.top) <= 4};
        });
        assert(controls.fits && controls.hasZoom && controls.hasView && controls.hasHints,
            `${viewport.width}×${viewport.height}: field controls overflow or are missing`);
        assert(controls.hintsHaveNeighbor,
            `${viewport.width}×${viewport.height}: hint button is stranded on its own row`);
        if (viewport.width === 1440 && viewport.height === 900)
            assert(controls.sameRow, `field controls do not fit one row: ${JSON.stringify(controls)}`);
        if(viewport.width<1000)await host.getByRole("button",{name:"Закрыть игроков"}).click();
        const layout = await host.locator(".bottom-dock").evaluate((dock) => {
            const scroll = dock.querySelector(".bottom-dock-scroll");
            const program = dock.querySelector(".program");
            const token = dock.querySelector(".power-down-token");
            const tokenLabel = token?.querySelector("span");
            const box = dock.getBoundingClientRect();
            return {overflow: scroll.scrollHeight - scroll.clientHeight,
                dockHeight: box.height, programHeight: program.getBoundingClientRect().height,
                dockWidth: box.width, scrollWidth: scroll.clientWidth,
                registerColumns: getComputedStyle(program.querySelector(".registers")).gridTemplateColumns,
                cardsHeight: program.querySelector(".cards").getBoundingClientRect().height,
                tokenFits: !tokenLabel || tokenLabel.scrollWidth <= tokenLabel.clientWidth + 1,
                inside: box.left >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1};
        });
        assert(layout.inside, `${viewport.width}×${viewport.height}: dock escapes viewport`);
        assert(layout.overflow <= 2, `${viewport.width}×${viewport.height}: needless vertical dock scrollbar (${JSON.stringify(layout)})`);
        if (viewport.width === 1440 && viewport.height === 900) {
            const compactProgram = await host.locator(".program").evaluate((program) => {
                const intro = program.querySelector(".program-heading > div:first-child").getBoundingClientRect();
                const actions = program.querySelector(".program-actions").getBoundingClientRect();
                const registers = program.querySelector(".registers").getBoundingClientRect();
                const cards = program.querySelector(".cards").getBoundingClientRect();
                return {introBottom: intro.bottom, actionsBottom: actions.bottom,
                    registersTop: registers.top, registersBottom: registers.bottom, cardsTop: cards.top};
            });
            assert(layout.dockHeight < 270 && compactProgram.registersTop < compactProgram.actionsBottom - 8
                && compactProgram.cardsTop >= compactProgram.registersBottom,
            `wide programming dock still wastes vertical space: ${JSON.stringify({layout, compactProgram})}`);
        }
        assert(layout.tokenFits, `${viewport.width}×${viewport.height}: Перезагрузка label overflows its token`);
        await host.waitForFunction(() => {
            const dock = document.querySelector(".bottom-dock");
            const screen = document.querySelector(".game-screen");
            return Math.abs(parseFloat(getComputedStyle(screen).paddingBottom) - dock.querySelector(".rr-program-reserve-probe").getBoundingClientRect().height - 16) <= 2;
        });
        if (viewport.width === 1440 && viewport.height === 900)
            await host.waitForFunction(() => document.documentElement.scrollHeight <= innerHeight + 2);
        const boardGap = await host.evaluate(() => {
            window.scrollTo(0, document.documentElement.scrollHeight);
            const board = document.querySelector(".board-viewport").getBoundingClientRect();
            const dock = document.querySelector(".bottom-dock").getBoundingClientRect();
            const gameScreen = document.querySelector(".game-screen");
            return {gap: dock.top - board.bottom, scrollable: document.documentElement.scrollHeight > innerHeight + 2,
                boardBottom: board.bottom, dockTop: dock.top, dockHeight: dock.height,
                gameBottom: gameScreen.getBoundingClientRect().bottom,
                paddingBottom: getComputedStyle(gameScreen).paddingBottom,
                scrollY, maxScroll: document.documentElement.scrollHeight - innerHeight,
                scrollWidth: document.documentElement.scrollWidth, innerWidth,
                boardLeft: board.left, boardRight: board.right,
                column: document.querySelector(".board-column").getBoundingClientRect().toJSON()};
        });
        assert(!boardGap.scrollable || boardGap.gap >= 0 && boardGap.gap <= 36,
            `${viewport.width}×${viewport.height}: board-to-dock gap is wrong (${JSON.stringify(boardGap)})`);
        if (viewport.width === 1440 && viewport.height === 900)
            assert(boardGap.maxScroll <= 2,
                `automatic board size still causes page scrolling (${JSON.stringify(boardGap)})`);
    }

    const dragDock = async (panel, edge) => {
        const handle = host.locator(panel === "info" ? ".game-side-hud .rr-dock-placement"
            : ".bottom-dock .rr-program-dock-actions > .rr-dock-placement");
        await host.evaluate(() => window.scrollTo(0, 0));
        const source = await handle.boundingBox();
        await host.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
        await host.mouse.down();
        await host.mouse.move(source.x + source.width / 2 + 18, source.y + source.height / 2 + 18, {steps: 6});
        await host.locator(".rr-dock-drop-overlay").waitFor({state: "visible"});
        const viewport = host.viewportSize();
        const destination = edge === "left" ? {x: 24, y: viewport.height / 2}
            : edge === "right" ? {x: viewport.width - 24, y: viewport.height / 2}
            : edge === "top" ? {x: viewport.width / 2, y: 24}
            : {x: viewport.width / 2, y: viewport.height - 24};
        await host.mouse.move(destination.x, destination.y, {steps: 8});
        await host.waitForFunction((requested) => document.querySelector(".rr-dock-snap-preview")
            ?.classList.contains(`rr-dock-snap-${requested}`), edge);
        await host.mouse.up();
        await host.locator(".rr-dock-drop-overlay").waitFor({state: "detached"});
    };
    const dockState = () => host.locator(".roborace-app").evaluate((root) => ({
        info: root.dataset.infoDock, program: root.dataset.programDock,
        compact: root.classList.contains("rr-docks-compact")
    }));
    const dockBoxes = () => host.evaluate(() => {
        const box = (selector) => {
            const rect = document.querySelector(selector).getBoundingClientRect();
            return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom};
        };
        return {info: box(".game-side-hud"), program: box(".bottom-dock"), board: box(".board-viewport")};
    });
    await host.setViewportSize({width: 1440, height: 900});
    await host.waitForFunction(() => !document.querySelector(".roborace-app")?.classList.contains("rr-docks-compact"));
    const nearRegisterDrop = await host.evaluate(() => {
        const register = document.querySelector(".program .register").getBoundingClientRect();
        const card = document.querySelector(".program .card");
        const transfer = new DataTransfer();
        card.dispatchEvent(new DragEvent("dragstart", {bubbles: true, dataTransfer: transfer}));
        const x = register.left + register.width / 2;
        const y = register.top - 14;
        const target = document.elementFromPoint(x, y);
        const over = new DragEvent("dragover", {bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfer});
        target.dispatchEvent(over);
        const drop = new DragEvent("drop", {bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfer});
        target.dispatchEvent(drop);
        return {accepted: over.defaultPrevented, dropped: drop.defaultPrevented};
    });
    assert(nearRegisterDrop.accepted && nearRegisterDrop.dropped,
        `a card dropped just above the first register was ignored: ${JSON.stringify(nearRegisterDrop)}`);
    await host.waitForFunction(() => !document.querySelector(".program .register span")?.textContent.includes("—"));
    await dragDock("info", "left");
    await dragDock("program", "right");
    assert.deepStrictEqual(await dockState(), {info: "left", program: "right", compact: false});
    let docks = await dockBoxes();
    assert(docks.info.right <= docks.board.left + 1 && docks.board.right <= docks.program.left + 1,
        `side docks cover the board: ${JSON.stringify(docks)}`);
    const sideRegisters=await host.locator(".program .register-label").evaluateAll(nodes=>nodes.map(node=>({
        fits:node.scrollWidth<=node.clientWidth+1,inside:node.getBoundingClientRect().right<=node.closest(".register").getBoundingClientRect().right+1
    })));
    assert(sideRegisters.length===5&&sideRegisters.every(label=>label.fits&&label.inside),"Personal register labels do not fit in the side dock");
    const hostGearAccess = await host.evaluate(() => {
        const gear = document.querySelector(".host-controls .settings-hover-button");
        const box = gear.getBoundingClientRect();
        const dock = document.querySelector(".bottom-dock").getBoundingClientRect();
        return {gap: box.top - dock.bottom,
            reachable: gear.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))};
    });
    assert(hostGearAccess.gap >= 8 && hostGearAccess.reachable,
        `right programming dock blocks the room settings gear: ${JSON.stringify(hostGearAccess)}`);
    assert.deepStrictEqual(await guest.locator(".roborace-app").evaluate((root) =>
        [root.dataset.infoDock, root.dataset.programDock]), ["right", "bottom"],
    "one player's dock settings changed another player's layout");
    await host.setViewportSize({width: 1100, height: 800});
    await host.waitForFunction(() => document.querySelector(".roborace-app")?.classList.contains("rr-docks-compact"));
    assert.deepStrictEqual(await dockState(), {info: "top", program: "bottom", compact: true},
        "two side docks were not adapted on a medium screen");
    await host.setViewportSize({width: 1440, height: 900});
    await host.waitForFunction(() => !document.querySelector(".roborace-app")?.classList.contains("rr-docks-compact"));
    await dragDock("info", "bottom");
    assert.deepStrictEqual(await dockState(), {info: "bottom", program: "right", compact: false});
    await host.waitForFunction(() => document.querySelector(".game-side-hud")?.getBoundingClientRect().width > 900);
    const wideInfo = await host.locator(".game-side-hud").evaluate((hud) => {
        const players = hud.querySelector(".players-panel").getBoundingClientRect();
        const footer = hud.querySelector(".rr-hud-footer").getBoundingClientRect();
        const scroll = hud.querySelector(".dock-scroll");
        const zoom = hud.querySelector(".rr-board-zoom-controls").getBoundingClientRect();
        const hints = hud.querySelector(".board-hints-toggle").getBoundingClientRect();
        return {width: hud.getBoundingClientRect().width, playersRight: players.right, footerLeft: footer.left,
            overflow: scroll.scrollHeight - scroll.clientHeight,
            hintsBesideZoom: Math.abs(zoom.top - hints.top) <= 4};
    });
    assert(wideInfo.width > 900 && wideInfo.playersRight <= wideInfo.footerLeft + 1
        && wideInfo.overflow <= 2 && wideInfo.hintsBesideZoom,
        `horizontal information dock did not use the available width: ${JSON.stringify(wideInfo)}`);
    await dragDock("program", "bottom");
    assert.deepStrictEqual(await dockState(), {info: "right", program: "bottom", compact: false},
        "choosing an occupied docking place did not exchange the panels");
    await dragDock("program", "top");
    assert(!await host.locator(".bottom-dock").evaluate((element) => element.classList.contains("collapsed")),
        "dragging the programming dock also collapsed it");
    docks = await dockBoxes();
    assert(docks.program.bottom <= docks.board.top + 1,
        `top programming dock covers the board: ${JSON.stringify(docks)}`);
    assert(await host.locator(".game-screen").evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom) < 50),
        "top programming dock still reserves a large empty area at the bottom");
    await host.setViewportSize({width: 2048, height: 991});
    const topDockPage = await host.evaluate(() => ({
        overflow: document.documentElement.scrollHeight - innerHeight,
        boardBottom: document.querySelector(".board-viewport").getBoundingClientRect().bottom,
        paddingBottom: parseFloat(getComputedStyle(document.querySelector(".game-screen")).paddingBottom)
    }));
    assert(topDockPage.paddingBottom < 50 && topDockPage.overflow <= 2,
        `top dock leaves unnecessary page scrolling: ${JSON.stringify(topDockPage)}`);
    await host.setViewportSize({width: 1440, height: 900});
    await dragDock("info", "top");
    assert.deepStrictEqual(await dockState(), {info: "top", program: "right", compact: false});
    await dragDock("program", "left");
    await dragDock("info", "bottom");
    assert.deepStrictEqual(await dockState(), {info: "bottom", program: "left", compact: false});
    const beforeLeftDockZoom = await dockBoxes();
    await host.locator(".board-toolbar").getByRole("button", {name: "Увеличить поле"}).click();
    await host.locator(".board-toolbar").getByRole("button", {name: "Увеличить поле"}).click();
    const afterLeftDockZoom = await dockBoxes();
    assert(afterLeftDockZoom.board.left < beforeLeftDockZoom.board.left - 20
        && afterLeftDockZoom.board.right > beforeLeftDockZoom.board.right + 20,
    `field with a left dock did not expand in both directions: ${JSON.stringify({beforeLeftDockZoom, afterLeftDockZoom})}`);
    await host.locator(".board-toolbar").getByRole("button", {name: "Автоматический размер поля"}).click();
    assert.equal(await host.evaluate(()=>window.gameFieldRenders),0,"standard game generated SVG geometry during layout changes");
    await host.reload();
    await trackFieldRenders();
    await host.locator(".bottom-dock").waitFor();
    assert.deepStrictEqual(await dockState(), {info: "bottom", program: "left", compact: false},
        "panel positions did not survive page reload");
    await host.setViewportSize({width: 390, height: 760});
    await host.waitForFunction(() => document.querySelector(".roborace-app")?.classList.contains("rr-docks-compact"));
    assert.deepStrictEqual(await dockState(), {info: "bottom", program: "top", compact: true});
    docks = await dockBoxes();
    assert(docks.program.bottom <= docks.board.top + 1 && await host.locator(".rr-players-open").isVisible(),
        `compact docks overlap the board: ${JSON.stringify(docks)}`);
    await host.setViewportSize({width: 1440, height: 900});
    await host.waitForFunction(() => !document.querySelector(".roborace-app")?.classList.contains("rr-docks-compact"));
    await dragDock("info", "right");
    await dragDock("program", "bottom");
    await host.evaluate(() => window.scrollTo(0, 0));

    await host.locator(".board-toolbar").getByRole("button", {name: "Повернуть вид по часовой стрелке"}).click();
    assert.equal(await host.evaluate(() => localStorage.getItem("roborace-board-view-angle")), "180",
        "manual view rotation was not persisted");
    await host.locator(".board-toolbar").getByRole("button", {name: "Автоматический ракурс поля"}).click();
    assert.equal(await host.evaluate(() => localStorage.getItem("roborace-board-view-angle")), null,
        "reset field view did not restore automatic orientation");
    await host.waitForFunction(() => {
        const board = document.querySelector(".board-viewport");
        const column = document.querySelector(".board-column");
        return board?.classList.contains("rr-view-landscape")
            && board.getBoundingClientRect().width > column.getBoundingClientRect().width * .6;
    });
    const autoWidth = await host.locator(".board-viewport").evaluate((element) => element.getBoundingClientRect().width);
    await host.locator(".board-toolbar").getByRole("button", {name: "Увеличить поле"}).click();
    const enlargedWidth = await host.locator(".board-viewport").evaluate((element) => element.getBoundingClientRect().width);
    assert(enlargedWidth > autoWidth * 1.1, "manual enlargement did not change the field size");
    for (let index = 0; index < 7; index++)
        await host.locator(".board-toolbar").getByRole("button", {name: "Увеличить поле"}).click();
    const enlargedPosition = await host.evaluate(() => {
        const board = document.querySelector(".board-viewport").getBoundingClientRect();
        const column = document.querySelector(".board-column").getBoundingClientRect();
        return {boardCenter: (board.left + board.right) / 2,
            columnCenter: (column.left + column.right) / 2,
            boardWidth: board.width, columnWidth: column.width};
    });
    assert(enlargedPosition.boardWidth > enlargedPosition.columnWidth
        && Math.abs(enlargedPosition.boardCenter - enlargedPosition.columnCenter) <= 2,
    `oversized field no longer grows equally to the left and right: ${JSON.stringify(enlargedPosition)}`);
    await host.locator(".board-toolbar").getByRole("button", {name: "Автоматический размер поля"}).click();
    await host.waitForTimeout(150);
    const resetSize = await host.evaluate(() => ({width: document.querySelector(".board-viewport").getBoundingClientRect().width,
        columnWidth: document.querySelector(".board-column").getBoundingClientRect().width,
        scrollY, innerWidth, screenPadding: getComputedStyle(document.querySelector(".game-screen")).paddingBottom}));
    assert(Math.abs(resetSize.width - autoWidth) <= 2,
        `automatic field size did not return after manual enlargement: ${JSON.stringify({autoWidth, resetSize})}`);

    // Side docks leave the rest of a wide window available to the automatic fit.
    await host.setViewportSize({width:1935,height:1150});
    await dragDock("program","left");
    for(const viewport of [{width:1935,height:1150},{width:2560,height:1100},{width:1440,height:900}]){
        await host.setViewportSize(viewport);
        await host.waitForFunction(()=>{
            const b=document.querySelector(".board-viewport").getBoundingClientRect();
            const c=document.querySelector(".board-column").getBoundingClientRect();
            const capacity=Math.min(c.width,(innerHeight-c.top-28)*4/3);
            return Math.abs(b.width-capacity)<4;
        });
        const fit=await host.evaluate(()=>{
            const b=document.querySelector(".board-viewport").getBoundingClientRect();
            const c=document.querySelector(".board-column").getBoundingClientRect();
            return {width:b.width,column:c.width,bottom:b.bottom,viewport:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth};
        });
        assert(fit.column>=viewport.width-662&&fit.bottom<=fit.viewport&&fit.overflow<=1,`automatic fit wastes space or escapes the screen: ${JSON.stringify(fit)}`);
    }
    await dragDock("program","bottom");
    await host.getByRole("button",{name:"Авто",exact:true}).click();
    await guest.getByRole("button",{name:"Авто",exact:true}).click();
    await host.getByRole("button",{name:"Готов",exact:true}).click();
    await guest.getByRole("button",{name:"Готов",exact:true}).click();
    await host.locator(".players-panel .public-register.revealed").first().waitFor();
    const publicRegisters=await host.locator(".rr-player-registers").evaluateAll(rows=>rows.map(row=>{
        const cards=[...row.querySelectorAll(".public-register")],bounds=cards.map(card=>card.getBoundingClientRect());
        return cards.length===5&&cards.every((card,index)=>card.scrollWidth<=card.clientWidth+1
            &&bounds[index].right<=row.getBoundingClientRect().right+1&&(!index||bounds[index-1].right<=bounds[index].left+1));
    }));
    assert(publicRegisters.length>=2&&publicRegisters.every(Boolean),"Revealed public registers overlap or overflow the side dock");
    await host.locator(".game-pause-controls .pause").click();
    await host.locator(".pause-banner").waitFor();
    for (const viewport of [{width: 1440, height: 900}, {width: 1024, height: 650}, {width: 390, height: 760}]) {
        await host.setViewportSize(viewport);
        await host.waitForFunction((compact) => document.querySelector(".roborace-app")
            ?.classList.contains("rr-docks-compact") === compact, viewport.width < 1000);
        const banner = await host.locator(".pause-banner").evaluate((element) => {
            const box = element.getBoundingClientRect();
            return {inside: box.left >= -1 && box.right <= innerWidth + 1 && box.top >= 0,
                noOverflow: element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1,
                height: box.height, width: box.width, computedWidth: getComputedStyle(element).width,
                rootClasses: document.querySelector(".roborace-app")?.className,
                mode: element.querySelector("span")?.innerText};
        });
        assert(banner.inside && banner.noOverflow && banner.height <= 105,
            `${viewport.width}×${viewport.height}: pause notice is clipped or too tall (${JSON.stringify(banner)})`);
        assert.equal(banner.mode, "Актуальное состояние");
    }
    // Filling, clearing and locking cards must leave every register in place.
    for(const width of [320,390,540,800,1440]){
        await host.setViewportSize({width,height:900});
        let emptyPositions;
        for(const mode of ["empty","mixed","filled","empty"]){
            await host.evaluate(({width,mode})=>{
                const hand=[["move1","Вперёд 1"],["right","Повернуть вправо"],["left","Повернуть влево"],["uturn","Разворот"],["backup","Назад"],["move2","Вперёд 2"],["move3","Вперёд 3"]]
                    .map(([type,label],i)=>({id:`card-${i}`,type,label,priority:680+i}));
                const state={phase:"programming",userId:"one",playerSlots:["one"],round:1};
                const selected=mode==="empty"?[]:mode==="mixed"?[null,null,hand[0].id,hand[3].id,hand[5].id]:hand.slice(0,5).map(c=>c.id);
                const privateState={hand,selected,lockedRegisters:mode==="empty"?[]:[3,4],lives:3};
                ReactDOM.render(React.createElement("main",{className:`roborace-app rr-playing${width<1000?" rr-docks-compact":""}`},
                    React.createElement("div",{style:{containerType:"inline-size",containerName:"rr-dock"}},
                        React.createElement(Program,{state,privateState,app:{socket:{emit(){}}}}))),document.getElementById("root"));
            },{width,mode});
            const positions=await host.locator(".register").evaluateAll(nodes=>nodes.map(n=>{
                const r=n.getBoundingClientRect();return {top:r.top,height:r.height};
            }));
            if(!emptyPositions)emptyPositions=positions;
            assert.deepStrictEqual(positions,emptyPositions,`${width}/${mode}: selecting or locking cards moved the registers`);
            const clipped=await host.locator(".register").evaluateAll(nodes=>nodes.filter(n=>{
                const label=n.querySelector(".register-label"),box=n.getBoundingClientRect(),priority=n.querySelector(".priority-badge")?.getBoundingClientRect();
                const range=document.createRange();range.selectNodeContents(label);
                return label.scrollWidth>label.clientWidth+1||(priority&&priority.right>box.right)||[...range.getClientRects()].some(r=>
                    r.left<box.left||r.right>box.right||r.bottom>box.bottom||(priority&&r.right>priority.left&&r.left<priority.right&&r.bottom>priority.top&&r.top<priority.bottom));
            }).map(n=>n.textContent));
            assert.deepStrictEqual(clipped,[],`${width}/${mode}: selected command or priority is clipped in a register`);
            if(mode==="filled"){
                assert.deepStrictEqual(await host.locator(".register-label").evaluateAll(nodes=>nodes.map(n=>n.getAttribute("aria-label"))),["Вперёд 1","Вправо","Влево","Разворот","Назад"]);
                assert.equal(await host.locator('.rr-register-lock[aria-label="Заблокирован"]').count(),2);
            }
        }
    }
    await host.setViewportSize({width:1440,height:900});
    await host.evaluate(()=>{
        const hand=["right","uturn","uturn","left","move1","move2","right","left","move3"].map((type,i)=>({id:`hand-${i}`,type,priority:100+i*70,label:({move1:"Вперёд 1",move2:"Вперёд 2",move3:"Вперёд 3",uturn:"Разворот",left:"Влево",right:"Вправо"})[type]}));
        const locked=[{id:"lock-1",type:"uturn",label:"Разворот",priority:10},{id:"lock-2",type:"move1",label:"Вперёд 1",priority:650}];
        const state={phase:"programming",userId:"one",playerSlots:["one"],playerNames:{one:"Игрок 1"},round:7,
            programs:{one:{cards:[null,null,null,...locked],lockedRegisters:[3,4]}}};
        const privateState={hand,selected:[hand[8].id,hand[1].id,hand[6].id,locked[0].id,locked[1].id],
            registerCards:[hand[8],hand[1],hand[6],...locked],lockedRegisters:[3,4],lives:3,canPowerDown:true,damage:5};
        const render=count=>ReactDOM.render(React.createElement("main",{className:"roborace-app rr-playing","data-program-dock":"bottom","data-info-dock":"right"},
            React.createElement("section",{className:"bottom-dock rr-personal-horizontal rr-dock-programming"},
                React.createElement("div",{className:"rr-program-dock-actions"},
                    React.createElement("button",{className:"bottom-dock-toggle rr-dock-collapse-button"},"▾"),
                    React.createElement("button",{className:"rr-dock-placement"},"⠿")),
                React.createElement("div",{className:"bottom-dock-scroll"},
                    React.createElement(Program,{state,privateState:{...privateState,hand:hand.slice(0,count)},app:{socket:{emit(){}}}})))),document.getElementById("root"));
        window.__renderCompactPanel=render;render(9);
    });
    const compact=await host.locator(".bottom-dock").evaluate(n=>({height:n.getBoundingClientRect().height,
        overflow:n.querySelector(".bottom-dock-scroll").scrollHeight-n.querySelector(".bottom-dock-scroll").clientHeight}));
    assert(compact.height<225&&compact.overflow<=1,`programming with nine cards and public locked registers is too tall: ${JSON.stringify(compact)}`);
    const alignment=await host.locator(".program-actions").evaluate(n=>{
        const buttons=[...n.querySelectorAll(":scope > button,.power-down-token")].map(b=>b.getBoundingClientRect());
        const note=n.querySelector(".power-down-action > small"),hint=note.getBoundingClientRect(),power=n.querySelector(".power-down-token").getBoundingClientRect();
        const dock=n.closest(".bottom-dock"),height=dock.getBoundingClientRect().height;
        note.style.display="none";const withoutNote=dock.getBoundingClientRect().height;note.style.removeProperty("display");
        return {aligned:buttons.length===3&&buttons.every(b=>Math.abs(b.top-buttons[0].top)<1&&Math.abs(b.height-buttons[0].height)<1),
            contained:hint.left>=power.left&&hint.right<=power.right&&hint.top>=power.top&&hint.bottom<=power.bottom,
            stable:height===withoutNote};
    });
    assert(alignment.aligned&&alignment.contained&&alignment.stable,`program buttons or recovery hint disturb the layout: ${JSON.stringify(alignment)}`);
    assert(!await host.locator(".bottom-dock .program-heading h2").isVisible(),"programming heading still occupies space in the dock");
    assert.equal(await host.locator(".register-label").count(),5);
    assert.equal(await host.locator(".bottom-dock .public-register").count(),0);
    const cardWidth=await host.locator(".program .card").first().evaluate(n=>n.getBoundingClientRect().width);
    for(const count of [3,1]){
        await host.evaluate(count=>window.__renderCompactPanel(count),count);
        const widths=await host.locator(".program .card").evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().width));
        assert(widths.length===count&&widths.every(w=>w<=156&&Math.abs(w-cardWidth)<1),`cards expand when only ${count} remain: ${widths}`);
    }
    await host.evaluate(()=>delete window.__renderCompactPanel);
    assert.equal(await host.evaluate(()=>window.gameFieldRenders),0,"standard game regenerated SVG geometry during play or layout changes");
    console.log("Stable registers, compact programming, maximal automatic field fit and pause layouts passed.");
})().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
}).finally(async () => {
    if (browser) await browser.close();
    stopSandbox(server);
});
