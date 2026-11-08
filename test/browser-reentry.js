"use strict";

const assert = require("assert");
const path = require("path");
const {startSandbox, stopSandbox, launchBrowser, openUser, screenshot}=require("./browser-support");
const port = process.env.REENTRY_BROWSER_PORT || "3078";

(async () => {
    const sandbox = startSandbox(port); let browser;
    try {
        await sandbox.ready;
        browser = await launchBrowser();
        const {page} = await openUser(browser, {port, room:"reentry-ui", name:"Host", hasTouch:true, viewport:{width:1440,height:900}});
        const guest = (await openUser(browser, {port, room:"reentry-ui", name:"Guest"})).page;
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.getByRole("button", {name:"Присоединиться к игре"}).click();
        await guest.getByRole("button", {name:"Присоединиться к игре"}).click();
        await page.getByRole("button", {name:"Начать игру"}).click();
        await page.locator(".program .card").first().waitFor();
        await page.locator(".game-pause-controls .pause").click();
        await page.locator(".pause-banner").waitFor();
        await page.evaluate(() => {
            const app = ReactDOM.render(React.createElement(Game), document.getElementById("root"));
            window.__reentryUI = {app, base:{...app.state}, saved:JSON.parse(JSON.stringify(app.privateState)), events:[]};
            app.socket.emit = (event, value) => window.__reentryUI.events.push({event, value});
        });
        const fixture = options => page.evaluate(async options => {
            const {app, base, saved} = window.__reentryUI;
            window.__reentryUI.events = [];
            app.privateState = {...saved, reentry:{active:true, needsPowerDownChoice:false, candidates:[
                {x:4,y:12,archive:true,directions:["north","east","south","west"]}
            ], ...options.reentry}};
            await new Promise(resolve => app.setState({phase:"reentry", paused:false, register:null,
                userId:base.userId, reentryUserId:base.userId, playerSlots:base.playerSlots,
                playerNames:base.playerNames, playerStats:base.playerStats, programs:{},
                robots:base.robots.map(robot => robot.userId === base.userId
                    ? {...robot,x:null,y:null,destroyed:true,direction:"west"} : robot),
                historyReview:{actual:true, entries:[]}, reentryChoice:null, reentryPoweredDown:null,
                reentryPending:false, reentryError:null, hudCollapsed:innerWidth<1000, bottomDockCollapsed:false,
                ...options.state}, resolve));
        }, options || {});
        const events = () => page.evaluate(() => window.__reentryUI.events.filter(item => item.event === "choose-reentry"));
        const heading = () => page.locator(".rr-reentry-ghost .robot").evaluate(robot => robot.closest(".rr-direction-unset")
            ? null : robot.style.getPropertyValue("--robot-angle"));
        const confirm = page.getByRole("button", {name:"Возродиться", exact:true});

        await fixture();
        assert.equal(await page.locator(".rr-reentry-cell.selected").count(),1,"Free archive is not previewed automatically");
        assert.equal(await heading(),null,"A direction was selected before user input");
        assert(!await page.locator(".rr-reentry-ghost .robot-heading").isVisible(),"Unselected preview still points in a default direction");
        assert.equal(await page.locator('.rr-reentry-direction[aria-pressed="true"]').count(),0);
        assert(await confirm.isDisabled(),"A free archive bypasses explicit direction selection");
        await page.evaluate(()=>window.__reentryUI.app.confirmReentry());
        assert.deepStrictEqual(await events(),[],"Confirmation handler accepts an unspecified direction");
        await page.locator('.rr-reentry-direction[data-direction="north"]').click();
        assert.equal(await heading(),"0deg");
        assert(await confirm.isEnabled());
        assert.deepStrictEqual(await events(),[],"A preview rotation already committed the placement");

        const alternatives = {candidates:[
            {x:4,y:12,directions:["north","east","south","west"]},
            {x:5,y:12,directions:["north","south"]}
        ]};
        for (const width of [1440,390]) {
            await page.setViewportSize({width,height:900});
            for (const angle of [0,90,180,270]) {
                await fixture({reentry:alternatives,state:{boardViewChoice:angle}});
                assert(await confirm.isDisabled(),"Multiple candidates silently chose a cell");
                const target = page.locator(".rr-reentry-cell").nth(1);
                if(width===390) await target.tap(); else await target.click();
                assert.equal(await heading(),null,"Selecting a cell preselected its direction");
                assert(await confirm.isDisabled());
                assert.equal(await page.locator(".rr-reentry-cell.selected").count(),1);
                assert.equal(await page.locator(".rr-reentry-cell").count(),1,"Neighboring cell targets compete with the direction arrows");
                assert.equal(await page.locator('.rr-reentry-direction[aria-disabled="true"]').count(),2,"Forbidden headings are selectable");
                if(width===390) await page.locator('.rr-reentry-direction[data-direction="south"]').tap();
                else {
                    await page.locator('.rr-reentry-direction[data-direction="north"]').focus();
                    await page.keyboard.press(["ArrowUp","ArrowRight","ArrowDown","ArrowLeft"][(angle/90+2)%4]);
                }
                assert.equal(await heading(),"180deg","On-field direction did not rotate the preview");
                assert(await page.locator(".rr-reentry-compass").evaluate(compass => {
                    const board=compass.closest(".board-viewport").getBoundingClientRect();
                    return [...compass.querySelectorAll(".rr-reentry-direction")].every(sector => {
                        const box=sector.getBoundingClientRect();
                        return box.left>=board.left && box.right<=board.right && box.top>=board.top && box.bottom<=board.bottom;
                    });
                }),"Direction buttons escape the rotated field");
                assert.deepStrictEqual(await events(),[]);
                await confirm.click();
                assert.deepStrictEqual(await events(),[{event:"choose-reentry",value:{x:5,y:12,direction:"south"}}]);
                assert(await page.locator(".rr-reentry-confirm").isDisabled(),"Double submission remains possible");
            }
        }

        for(const angle of [0,90,180,270])for(const [x,y] of [[0,0],[11,15]]){
            await fixture({reentry:{candidates:[{x,y,archive:true,directions:["north","east","south","west"]}]},
                state:{boardViewChoice:angle,boardZoomSteps:-6}});
            assert(await page.locator(".rr-reentry-compass").evaluate(compass=>{
                const field=compass.closest(".board-viewport").getBoundingClientRect(),box=compass.getBoundingClientRect();
                return box.left>=field.left&&box.right<=field.right&&box.top>=field.top&&box.bottom<=field.bottom;
            }),"Corner archive loses direction controls at reduced zoom");
        }

        await fixture({reentry:{...alternatives,needsPowerDownChoice:true},state:{boardViewChoice:0,boardZoomSteps:0}});
        await page.locator(".rr-reentry-cell").nth(1).tap();
        await page.locator('.rr-reentry-direction[data-direction="south"]').tap();
        await page.getByRole("button",{name:"Выбрать другую клетку"}).tap();
        assert.equal(await page.locator(".rr-reentry-cell").count(),2,"Returning to cell selection does not restore alternatives");
        assert.equal(await page.locator(".rr-reentry-compass").count(),0,"Direction sectors block changing to a neighboring cell");
        assert(await confirm.isDisabled());
        await page.locator(".rr-reentry-cell").first().focus();
        await page.keyboard.press("Enter");
        assert.equal(await heading(),null);
        assert(await confirm.isDisabled(),"Required mode was silently chosen");
        await page.getByRole("button", {name:"Обычный режим",exact:true}).click();
        assert(await confirm.isDisabled(),"Selecting a reboot mode also selected a direction");
        await page.locator('.rr-reentry-direction[data-direction="west"]').focus();
        await page.keyboard.press("ArrowDown");
        assert.equal(await heading(),"180deg");
        await confirm.focus(); await page.keyboard.press("Enter");
        assert.deepStrictEqual(await events(),[{event:"choose-reentry",value:{x:4,y:12,direction:"south",poweredDown:false}}]);

        await fixture({reentry:{needsPowerDownChoice:true}});
        await page.getByRole("button",{name:"Перезагрузка",exact:true}).click();
        assert(await confirm.isDisabled());
        await page.locator('.rr-reentry-direction[data-direction="east"]').click();
        await confirm.click();
        assert.equal((await events())[0].value.poweredDown,true);
        await fixture({state:{paused:true}});
        assert(await confirm.isDisabled());
        assert(await page.locator(".rr-reentry-cell").first().isDisabled());
        assert.equal(await page.locator('.rr-reentry-direction[aria-disabled="true"]').count(),4);

        await fixture({reentry:alternatives});
        await page.locator(".rr-reentry-cell").first().click();
        await page.locator('.rr-reentry-direction[data-direction="west"]').click();
        await page.evaluate(() => {
            const {app} = window.__reentryUI;
            app.privateState.reentry.candidates = [{x:5,y:12,directions:["east"]}];
            app.forceUpdate();
        });
        assert.equal(await heading(),null,"Changed cell preselected its only available direction");
        assert(await confirm.isDisabled());
        assert.equal(await page.locator('.rr-reentry-direction[aria-disabled="true"]').count(),3);
        await page.locator('.rr-reentry-direction[data-direction="east"]').click();
        assert(await confirm.isEnabled());
        await page.evaluate(()=>{
            const {app}=window.__reentryUI;
            app.privateState.reentry.candidates[0].directions=["north"];
            app.forceUpdate();
        });
        assert.equal(await heading(),null,"Newly blocked heading remained selected");
        assert(await confirm.isDisabled());
        await page.evaluate(()=>{
            const {app}=window.__reentryUI;
            app.privateState.reentry.candidates[0].directions=["east"];
            app.forceUpdate();
        });
        assert.equal(await heading(),null,"Previously invalidated heading silently reappeared");
        await page.evaluate(() => {
            const {app,base} = window.__reentryUI;
            // Public owner can advance before the next private packet arrives.
            app.setState({reentryUserId:base.playerSlots.find(id => id !== base.userId),reentryPoweredDown:true});
        });
        assert.equal(await page.locator(".rr-reentry-targets").count(),0,"Next player inherited interactive targets");
        assert.equal(await page.locator(".rr-reentry-confirm").count(),0);
        assert.equal(await page.evaluate(() => window.__reentryUI.app.state.reentryPoweredDown),null);

        // All 8×5 public slots fit the single players dialog, without resizing the board.
        await fixture({state:{phase:"resolving",register:2}});
        await page.evaluate(() => {
            const {app,base,saved} = window.__reentryUI;
            const ids = [base.userId,...Array.from({length:7},(_,i)=>`observer-${i}`)];
            const card = {type:"move3",label:"Вперёд 3",priority:810};
            app.privateState = {...saved,hand:[{type:"move1",label:"Секретная карта",priority:9999}],reentry:{active:false,candidates:[]}};
            app.setState({playerSlots:ids,playerNames:Object.fromEntries(ids.map((id,i)=>[id,`Игрок ${i+1}`])),
                playerStats:Object.fromEntries(ids.map(id=>[id,{lives:3,damage:0,checkpoints:0}])),
                programs:Object.fromEntries(ids.map(id=>[id,{cards:[card,null,null,null,null],lockedRegisters:[0]}]))});
        });
        const boardBox = () => page.locator(".board-viewport").evaluate(el => el.getBoundingClientRect().toJSON());
        const before = await boardBox();
        await page.locator(".rr-players-open").tap();
        const dialog = page.getByRole("dialog",{name:"Игроки и регистры"});
        assert(await dialog.isVisible());
        assert.equal(await dialog.locator(".rr-player-registers").count(),8);
        assert.equal(await dialog.locator(".public-register").count(),40);
        assert.equal(await dialog.locator(".public-register.closed").count(),32);
        assert(!(await dialog.innerText()).includes("9999"),"Private hand leaked into observation");
        const first = dialog.locator(".public-register").first();
        await first.tap();
        assert((await dialog.locator(".rr-register-detail").innerText()).includes("Вперёд 3, приоритет 810"));
        assert.equal(await first.locator(".rr-command-symbol b").innerText(),"3");
        await dialog.locator(".public-register").last().focus();
        await page.keyboard.press("Escape"); // Close the register explanation first.
        await page.keyboard.press("Escape");
        assert(!await dialog.isVisible());
        assert.deepStrictEqual(await boardBox(),before,"Opening players changed the field geometry");
        assert(await page.locator(".rr-players-open").evaluate(el => el === document.activeElement));
        await page.locator(".rr-players-open").tap();
        const fit = await dialog.locator(".rr-player-registers").evaluateAll(rows => rows.every(row =>
            row.scrollWidth <= row.clientWidth + 1 && [...row.children].filter(el=>el.tagName==="BUTTON").every(button => button.scrollWidth <= button.clientWidth + 1)));
        assert(fit,"Compact register symbols or priorities overflow");

        await screenshot(page,{path:path.resolve(__dirname,"../artifacts/players-mobile.png")});
        await page.getByRole("button",{name:"Закрыть игроков"}).click();
        await fixture({reentry:alternatives});
        await page.locator(".rr-reentry-cell").first().tap();
        await screenshot(page,{path:path.resolve(__dirname,"../artifacts/reentry-mobile-unselected.png")});
        const appearance=()=>page.locator(".rr-reentry-compass").evaluate(compass=>{
            const buttons=[...compass.querySelectorAll(".rr-reentry-direction")].map(button=>{
                const style=getComputedStyle(button);
                return {background:style.backgroundColor,image:style.backgroundImage,shadow:style.boxShadow,
                    width:button.getBoundingClientRect().width,glyph:button.querySelector("svg").getBoundingClientRect().width};
            });
            return {buttons,sectors:compass.querySelectorAll(".rr-direction-sector").length};
        });
        const unobtrusive=visual=>visual.sectors===0&&visual.buttons.length===4&&visual.buttons.every(button=>
            button.background==="rgba(0, 0, 0, 0)"&&button.image==="none"&&button.shadow==="none"&&button.width>=31&&button.glyph<=24);
        let visual=await appearance();
        assert(unobtrusive(visual),"Direction controls obscure the field: "+JSON.stringify(visual));
        const hovered=page.locator('.rr-reentry-direction[data-direction="east"]');
        await hovered.hover();
        visual=await appearance();
        assert(unobtrusive(visual),"Hover paints over the field: "+JSON.stringify(visual));
        // The full transparent button is clickable, including outside the small glyph.
        await hovered.click({position:{x:2,y:16}});
        assert.equal(await heading(),"90deg");
        await hovered.focus();
        assert(unobtrusive(await appearance()),"Keyboard focus paints over the field");
        await page.mouse.move(0,0);
        await page.getByRole("button",{name:"Возродиться",exact:true}).focus();
        await screenshot(page,{path:path.resolve(__dirname,"../artifacts/reentry-mobile.png")});
        assert.deepStrictEqual(errors,[]);
        console.log("On-field arrow choices, mandatory explicit heading, modes, rotated touch/keyboard controls, pause, candidate changes, queue reset and 8-player observation passed.");
    } finally {if(browser)await browser.close();stopSandbox(sandbox.server);}
})().catch(error => {console.error(error);process.exitCode=1;});
