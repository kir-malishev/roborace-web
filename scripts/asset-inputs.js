"use strict";
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const Field=require("../public/field-format");
const digest=value=>crypto.createHash("sha256").update(value).digest("hex");
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const geometryHash=features=>digest(JSON.stringify(canonical(Field.geometry(features))));
function rendererHash(root){
    const hash=crypto.createHash("sha256");
    for(const file of ["public/arena-art.js","public/field-format.js","scripts/asset-inputs.js","scripts/build-assets.js"])
        hash.update(file).update("\0").update(fs.readFileSync(path.join(root,file))).update("\0");
    return hash.digest("hex");
}
function verifyAssets(root){
    try {
        const manifest=JSON.parse(fs.readFileSync(path.join(root,"public/assets/manifest.json"),"utf8"));
        if(manifest.rendererSha256!==rendererHash(root)) throw new Error("Изменились исходники генератора");
        const lockfile=path.join(root,"package-lock.json");
        if(fs.existsSync(lockfile)&&manifest.lockfileSha256!==digest(fs.readFileSync(lockfile)))
            throw new Error("Изменились зависимости генератора");
        const assets=new Map(manifest.assets.map(asset=>[asset.file,asset]));
        if(assets.size!==manifest.assets.length) throw new Error("В манифесте повторяются файлы");
        for(const source of require("../data/fields").FIELDS){
            const field=Field.read(source),hash=geometryHash(field.features);
            for(const suffix of ["","-thumb"]){
                const file=`public/assets/boards/arena-${field.id}${suffix}.webp`,asset=assets.get(file);
                if(!asset) throw new Error(`Нет изображения в манифесте: ${file}`);
                if(asset.geometrySha256!==hash) throw new Error(`Изменилась геометрия поля «${field.name}»`);
            }
        }
        for(const asset of manifest.assets){
            if(digest(fs.readFileSync(path.join(root,asset.file)))!==asset.sha256)
                throw new Error(`Не совпадает контрольная сумма: ${asset.file}`);
        }
    } catch(error){
        throw new Error(`RoboRace: проверка графики не пройдена. ${error.message}. Выполните npm run assets:build в папке roborace-web и перезапустите сервер.`);
    }
}
module.exports={geometryHash,rendererHash,verifyAssets};
