import fs from 'node:fs/promises';
import {FileBlob, PresentationFile} from '@oai/artifact-tool';
const p = await PresentationFile.importPptx(await FileBlob.load('C:/Users/79824/Downloads/DomDelo_MAX_umnyi_gorod_2026.pptx'));
await fs.writeFile('source-inspect.ndjson',(await p.inspect({kind:'slide,textbox,shape,layout',maxChars:200000})).ndjson);
console.log('slides',p.slides.items.length,'masters',p.masters.items.length,'layouts',p.layouts.items.length);
console.log('slide collection',Object.getOwnPropertyNames(Object.getPrototypeOf(p.slides)));
console.log('shape',Object.getOwnPropertyNames(Object.getPrototypeOf(p.slides.items[0].shapes.items[0])));
await fs.mkdir('before',{recursive:true});
for(let i=0;i<p.slides.items.length;i++){
  const png=await p.slides.items[i].export({format:'png',scale:1});
  await fs.writeFile(`before/slide-${i+1}.png`,new Uint8Array(await png.arrayBuffer()));
  console.log('rendered',i+1);
}
