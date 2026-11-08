"use strict";
const assert=require("assert"),path=require("path");
const {COURSE_CARDS,BOARD_FEATURES}=require("../data/catalog");
const {startSandbox,stopSandbox,launchBrowser,openUser, screenshot}=require("./browser-support");

async function selectWithoutJump(page, option, courseId) {
    await option.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
        window.lobbyTrace = [];
        window.traceLobby = true;
        const sample = () => {
            const preview = document.querySelector(".selected-course-preview").getBoundingClientRect();
            const board = document.querySelector(".large-course-preview").getBoundingClientRect();
            const list = document.querySelector(".course-list");
            window.lobbyTrace.push({previewHeight:preview.height,boardTop:board.top,boardWidth:board.width,
                boardHeight:board.height,scroll:scrollY,listScroll:list.scrollTop});
            if (window.traceLobby) requestAnimationFrame(sample);
        };
        sample();
    });
    await option.click();
    await page.waitForFunction(id => document.querySelector(".selected-course-strip").dataset.courseId === id, courseId);
    const samples = await page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        window.traceLobby = false;
        return window.lobbyTrace;
    });
    for (const key of Object.keys(samples[0])) {
        const values = samples.map(sample => sample[key]);
        assert(Math.max(...values)-Math.min(...values)<=1,`${courseId} at ${page.viewportSize().width}px: ${key} jumped (${Math.min(...values)} → ${Math.max(...values)})`);
    }
}

(async()=>{
    const port=3097,sandbox=startSandbox(port);let browser;
    try{
        await sandbox.ready;browser=await launchBrowser();
        const {page}=await openUser(browser,{port,room:"new-lobby",name:"Host",viewport:{width:1440,height:1000}});
        const {page:guest}=await openUser(browser,{port,room:"new-lobby",name:"Guest",viewport:{width:1440,height:1000}});
        const errors=[],failed=[];page.on("pageerror",e=>errors.push(e.message));page.on("response",r=>{if(r.status()>=400)failed.push(r.url());});
        await page.getByRole("button",{name:"Присоединиться к игре"}).click();await guest.getByRole("button",{name:"Присоединиться к игре"}).click();
        await page.evaluate(()=>{
            const render=RaceArt.render;
            window.lobbyFieldRenders=0;
            RaceArt.render=(...args)=>{window.lobbyFieldRenders++;return render(...args);};
        });
        assert.equal(await page.locator(".race-arena-card").count(),11);assert.equal(await page.locator(".race-route-option").count(),3);
        assert.equal(await page.locator(".large-course-preview .board-overlay .robot .robot-heading svg").count(),2,"lobby must use the game robot component");
        assert.equal(await page.locator(".large-course-preview .robot.own-robot").count(),1,"lobby must highlight the local robot");
        assert.equal(await page.getByText("Тип поля",{exact:true}).count(),0);
        assert.equal(await page.locator(".race-course-description").count(),0);
        const dir=path.resolve(__dirname,"../artifacts");
        await screenshot(page,{path:path.join(dir,"lobby-initial.png"),fullPage:true});
        for(const board of Object.keys(BOARD_FEATURES)){
            await page.getByRole("option",{name:`Поле ${board}`,exact:true}).click();
            for(const course of COURSE_CARDS.filter(c=>c.board===board)){
                await page.locator(`[data-course-id="${course.id}"].race-route-option`).click();
                for(const client of [page,guest])await client.waitForFunction(id=>document.querySelector(".selected-course-strip")?.dataset.courseId===id,course.id);
                assert.equal(await page.locator(".large-course-preview .flag").count(),course.flags.length);
                await page.waitForFunction(()=>[...document.querySelectorAll(".large-course-preview img")].every(img=>img.complete&&img.naturalWidth>0));
                const images=await page.locator(".large-course-preview img").evaluateAll(nodes=>nodes.map(img=>({url:img.currentSrc,width:img.naturalWidth,height:img.naturalHeight})));
                assert.equal(new Set(images.map(img=>img.url)).size,1,"factory and start must use the same complete field image");
                assert(images.every(img=>img.width===1440&&img.height===1920),"prebuilt field image must include all 16 rows");
            }
        }
        const initial=await page.locator(".selected-course-strip").getAttribute("data-course-id");
        await page.getByLabel("Сложность маршрута").selectOption("Сложный");await page.getByText("Для нашего состава",{exact:true}).click();
        const matching=COURSE_CARDS.filter(c=>c.level==="Сложный"&&c.recommendedMin<=2&&c.recommendedMax>=2);
        assert.equal(await page.locator(".race-arena-card").count(),new Set(matching.map(c=>c.board)).size);
        assert.equal(await page.locator(".selected-course-strip").getAttribute("data-course-id"),initial,"filters changed the game selection");
        await page.getByRole("searchbox").fill("несуществующий маршрут");assert.equal(await page.locator(".race-arena-card").count(),0);assert(await page.locator(".course-empty").isVisible());
        await page.getByRole("button",{name:"Сбросить фильтры"}).click();assert.equal(await page.locator(".race-arena-card").count(),11);
        await page.getByRole("searchbox").fill(COURSE_CARDS[0].name);assert.equal(await page.locator(".race-arena-card").count(),1);
        await page.getByRole("button",{name:"Сбросить фильтры"}).click();
        await page.locator(".race-arena-card").first().click();await page.locator(".race-route-option").last().click();
        await page.waitForFunction(()=>document.querySelector(".selected-course-strip")?.dataset.courseId==="arena-02-c");
        await guest.locator(".race-arena-card").nth(3).click();await guest.locator(".race-route-option").last().click();
        assert.equal(await guest.locator(".selected-course-strip").getAttribute("data-course-id"),"arena-02-c","guest changed the host's selected route");
        // Keep server replies apart from the click so transient collapses cannot hide between frames.
        await page.evaluate(() => {
            const app=ReactDOM.render(React.createElement(Game),document.getElementById("root"));
            const emit=app.socket.emit.bind(app.socket);
            app.socket.emit=(event,...args)=>event==="select-course" ? setTimeout(()=>emit(event,...args),160) : emit(event,...args);
        });
        for(const [width,height] of [[1440,900],[1100,760],[800,650],[390,760],[320,640],[1366,600]]){
            await page.setViewportSize({width,height});await page.locator(".course-setup").scrollIntoViewIfNeeded();
            for(const board of Object.keys(BOARD_FEATURES)){
                const option=page.getByRole("option",{name:`Поле ${board}`,exact:true});
                const course=COURSE_CARDS.filter(c=>c.board===board).slice(-1)[0];
                await selectWithoutJump(page,option,course.id);
            }
            const routes=COURSE_CARDS.filter(c=>c.board===Object.keys(BOARD_FEATURES).slice(-1)[0]);
            for(const course of [routes[0],routes[2]])await selectWithoutJump(page,page.locator(`.race-route-option[data-course-id="${course.id}"]`),course.id);
            await screenshot(page,{path:path.join(dir,`lobby-${width}.png`),fullPage:true});
            assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}: lobby has horizontal overflow`);
            const overflowingThumbnails=await page.locator(".race-arena-card").evaluateAll(cards=>cards.filter(card=>{
                const box=card.getBoundingClientRect(),image=card.querySelector("img").getBoundingClientRect();
                return image.left<box.left+4||image.right>box.right-4||image.top<box.top+4||image.bottom>box.bottom-4;
            }).map(card=>card.dataset.board));
            assert.deepStrictEqual(overflowingThumbnails,[],`${width}: field thumbnails overflow their buttons`);
            const clipped=await page.locator(".race-route-option strong,.race-route-option small,.race-arena-card strong").evaluateAll(nodes=>nodes.filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>n.textContent));
            assert.deepStrictEqual(clipped,[],`${width}: catalog text is clipped`);
            const preview=await page.locator(".large-course-preview .race-checkpoint").evaluateAll(nodes=>nodes.map(n=>({
                height:n.querySelector("text").getBoundingClientRect().height,
                repair:!!n.querySelector(".race-checkpoint-repair"),
                open:[...n.querySelectorAll(":scope > path")].every(p=>p.getAttribute("fill")==="none")
            })));
            assert(preview.length>0&&preview.every(p=>p.height>=10&&p.open&&p.repair),`${width}: checkpoint preview must be legible, show repair and preserve the underlying element`);
            if(width>760){
                const heights=await page.locator(".course-browser-layout").evaluate(el=>({list:el.querySelector(".course-list").getBoundingClientRect().height,preview:el.querySelector(".selected-course-preview").getBoundingClientRect().height}));
                assert(Math.abs(heights.list-heights.preview)<2,`${width}: field list leaves an empty column below it`);
            }
        }
        const rapid=await page.evaluate(()=>{
            const app=ReactDOM.render(React.createElement(Game),document.getElementById("root"));
            window.lobbyAcknowledged=[];
            window.lobbyAck=state=>window.lobbyAcknowledged.push(state.course.id);
            app.socket.on("state",window.lobbyAck);
            const fields=[...document.querySelectorAll(".race-arena-card")];
            const clicked=[fields[0],fields[1],fields[fields.length-1]];
            const ids=clicked.map(field=>{
                field.click();
                return document.querySelector(".race-route-option[aria-pressed='true']").dataset.courseId;
            });
            const name=document.querySelector(".selected-course-heading strong").textContent;
            window.lobbyHeadings=[];
            window.lobbyObserver=new MutationObserver(()=>window.lobbyHeadings.push(document.querySelector(".selected-course-heading strong").textContent));
            window.lobbyObserver.observe(document.querySelector(".selected-course-heading"),{subtree:true,childList:true,characterData:true});
            return {ids,name};
        });
        await page.waitForFunction(ids=>ids.every(id=>window.lobbyAcknowledged.includes(id)),rapid.ids);
        const headings=await page.evaluate(()=>{
            window.lobbyObserver.disconnect();
            ReactDOM.render(React.createElement(Game),document.getElementById("root")).socket.off("state",window.lobbyAck);
            return [...window.lobbyHeadings,document.querySelector(".selected-course-heading strong").textContent];
        });
        assert(headings.every(name=>name===rapid.name),`Delayed replies replaced the last inspected field: ${headings.join(", ")}`);
        const session=await page.context().newCDPSession(page);
        await session.send("Emulation.setCPUThrottlingRate",{rate:4});
        for(const board of Object.keys(BOARD_FEATURES)){
            const course=COURSE_CARDS.filter(c=>c.board===board).slice(-1)[0];
            await selectWithoutJump(page,page.getByRole("option",{name:`Поле ${board}`,exact:true}),course.id);
        }
        await session.send("Emulation.setCPUThrottlingRate",{rate:1});
        assert.equal(await page.evaluate(()=>window.lobbyFieldRenders),0,"Lobby must use prebuilt images instead of generating SVG fields");
        assert(await page.locator(".large-course-preview img,.race-arena-thumbnail").evaluateAll(images=>images.every(img=>new URL(img.src).pathname.endsWith(".webp"))),"Lobby must use shared WebP backgrounds and thumbnails");
        assert.deepStrictEqual(errors,[]);assert.deepStrictEqual(failed,[]);
        assert(!sandbox.output().includes("[sandbox] WARNING"),sandbox.output());
        console.log("11-field lobby, all 33 routes, filters, host permissions and stable field switching with delayed replies on wide/short/narrow layouts passed.");
    }finally{if(browser)await browser.close();stopSandbox(sandbox.server);}
})().catch(e=>{console.error(e);process.exitCode=1;});
