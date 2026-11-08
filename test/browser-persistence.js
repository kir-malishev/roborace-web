"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path"),{once}=require("events");
const {startSandbox,stopSandbox,launchBrowser,openUser}=require("./browser-support");
const sandboxDir=path.resolve(process.env.MEME_POLICE_SANDBOX_DIR||path.join(__dirname,"../../meme-police-sandbox"));
let port=Number(process.env.PERSISTENCE_PORT)||3100+process.pid%10000;
while(fs.existsSync(path.join(sandboxDir,".sandbox",`rooms-${port}.json`)))port++;
const dump=path.join(sandboxDir,".sandbox",`rooms-${port}.json`);
const room="roborace-persistence";
const stop=async server=>{if(!server||server.exitCode!==null)return;const done=once(server,"exit");stopSandbox(server);await done;};
(async()=>{
    let sandbox,browser;
    try {
        sandbox=startSandbox(port,{restore:true});await sandbox.ready;browser=await launchBrowser();
        const h=await openUser(browser,{port,room,name:"Host",viewport:{width:1440,height:900}});
        const g=await openUser(browser,{port,room,name:"Guest",viewport:{width:1440,height:900}});
        await h.page.locator(".login-menu").click();await h.page.getByText("Войти через Discord",{exact:true}).click();
        await h.page.locator(".profile-button").first().waitFor();
        const close=h.page.locator(".profile-container-close");if(await close.isVisible().catch(()=>false))await close.click();
        await h.page.getByRole("button",{name:"Присоединиться к игре"}).click();
        await g.page.getByRole("button",{name:"Присоединиться к игре"}).click();
        await h.page.getByRole("button",{name:"Начать игру"}).click();await h.page.locator(".program .card").first().waitFor();
        await h.page.getByRole("button",{name:"Авто",exact:true}).click();
        await h.page.locator(".game-pause-controls button").click();await h.page.locator(".pause-banner").waitFor();
        const before=await h.page.locator(".registers").innerText();
        const deadline=Date.now()+12000;let saved;
        while(Date.now()<deadline){try{saved=JSON.parse(fs.readFileSync(dump,"utf8")).data["/bg/roborace"][room];if(saved.room.paused&&saved.room.phase==="programming")break;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
        assert(saved?.room.paused,"official sandbox did not persist the paused room");assert.equal(saved.format,"roborace-room");
        await stop(sandbox.server);sandbox=startSandbox(port,{restore:true});await sandbox.ready;
        await Promise.all([h.page.reload({waitUntil:"domcontentloaded"}),g.page.reload({waitUntil:"domcontentloaded"})]);
        await h.page.locator(".pause-banner").waitFor();await h.page.locator(".program .card").first().waitFor();
        assert.equal(await h.page.locator(".registers").innerText(),before,"restart lost the private program");
        assert.equal(await h.page.locator(".board .robot").count(),2);assert.equal(await g.page.locator(".pause-banner").count(),1);
        assert.equal(sandbox.errors(),"");console.log("Authenticated host and paused private program restored after an actual sandbox restart.");
    }finally{
        if(browser)await browser.close();if(sandbox)await stop(sandbox.server);
        // This port's dump did not exist before this test; remove only its own runtime artifact.
        if(fs.existsSync(dump))fs.unlinkSync(dump);
    }
})().catch(e=>{console.error(e);process.exitCode=1});
