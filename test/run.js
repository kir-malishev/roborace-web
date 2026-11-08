"use strict";
const {spawnSync}=require("child_process");
const groups={
    core:["sandbox-contract","catalog","field-format","arena-art","board-events","programming-timer","power-down","game-options","field-editor","victory","pause","history-review","assets"],
    fields:["fields","routes"],
    browser:["browser-art","browser-lobby","browser-smoke","browser-guide","browser-layout","browser-dock-stability","browser-reentry","browser-programming-timer","browser-power-down","browser-pause","browser-history-review"],
    persistence:["browser-persistence"]
};
const group=process.argv[2]||"core";
const files=group==="all"?Object.values(groups).flat():groups[group];
if(!files)throw new Error(`Unknown test group: ${group}`);
const started=Date.now();
for(const file of files){const result=spawnSync(process.execPath,[require("path").join(__dirname,`${file}.js`)],{stdio:"inherit"});if(result.status!==0)process.exit(result.status||1);}
console.log(`${group}: ${files.length} scripts passed in ${((Date.now()-started)/1000).toFixed(1)}s`);
