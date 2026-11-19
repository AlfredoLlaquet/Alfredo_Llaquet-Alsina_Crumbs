#!/usr/bin/env node
// Add exact statistics to image-tool artwork; retain its typography and icons.
// Requires Node.js, sharp, Nimbus Roman, and Open Sans.
// Defaults to the existing JPGs. To seed a new design:
// node scripts/finish-stats.cjs --desktop-art /path/desktop.png --phone-art /path/phone.png
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const data=require('./stats-data.json'),root=path.resolve(__dirname,'..');
const fmt=n=>n.toLocaleString('en-US');
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const asDate=s=>new Date(`${s}T12:00:00Z`),date=asDate(data.through);
const remaining=data.goal-data.crumbs,completion=(100*data.crumbs/data.goal).toFixed(1);
const finish=new Date(date.getTime()+Math.ceil(remaining/data.dailyPace)*86400000);
const month=d=>d.toLocaleDateString('en-US',{month:'short',timeZone:'UTC'});
const fullDate=date.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});
const finishDate=`${finish.getUTCDate()} ${month(finish)} ${finish.getUTCFullYear()}`;
const weekDate=s=>`${asDate(s).getUTCDate()} ${month(asDate(s))}`;
const C={ink:'#090909',muted:'#454D5D',blue:'#0662EF',rule:'#DDE1E7',track:'#E7EAF0'};
const serif='Nimbus Roman',sans='Open Sans',title='History’s Most Prolific Writer';
class Overlay{
  constructor(width,height){this.width=width;this.height=height;this.parts=[];}
  raw(s){this.parts.push(s);}
  rect(x,y,w,h,color='white',r=0){this.raw(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${color}"/>`);}
  text(x,y,s,size,{color=C.muted,family=sans,weight=400,anchor='start'}={}){this.raw(`<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${color}">${esc(s)}</text>`);}
  metric(x,y,value,label,size,labelSize){this.raw(`<text x="${x}" y="${y}" font-family="${serif}" font-size="${size}" font-weight="400" fill="${C.blue}">${esc(value)}<tspan dx="9" font-size="${labelSize}" fill="${C.ink}">${esc(label)}</tspan></text>`);}
  goal(x,y,size){this.raw(`<text x="${x}" y="${y}" font-family="${serif}" font-size="${size}" font-weight="400" fill="${C.ink}">Write <tspan fill="${C.blue}">${fmt(data.goal)}</tspan> crumbs</text>`);}
  line(x1,y1,x2,y2,color=C.rule,width=1){this.raw(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"/>`);}
  svg(){return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">${this.parts.join('')}</svg>`;}
}
function progress(a,{x,y,w,font,labelY}){
  a.rect(x,y,w,16,C.track,8);a.rect(x,y,w*data.crumbs/data.goal,16,C.blue,8);
  a.text(x,labelY,`${completion}%`,font,{color:C.blue,weight:600});
  a.text(x+w,labelY,`${fmt(remaining)} remaining`,font,{anchor:'end'});
}
function chart(a,{x,y,w,h,font}){
  const max=Math.max(250,Math.ceil(Math.max(...data.weeks.map(d=>d.count))/50)*50);
  for(let v=0;v<=max;v+=50){const yy=y+h-v/max*h;a.line(x,yy,x+w,yy,v===0?'#778393':C.rule,v===0?1.4:1);a.text(x-14,yy+font*.34,String(v),font,{anchor:'end'});}
  const band=w/data.weeks.length;
  data.weeks.forEach((d,i)=>{const bw=band*.7,xx=x+band*i+(band-bw)/2,bh=d.count/max*h;a.rect(xx,y+h-bh,bw,bh,C.blue);a.text(xx+bw/2,y+h-bh-12,String(d.count),font+2,{anchor:'middle',weight:600,color:C.blue});a.text(xx+bw/2,y+h+font+14,weekDate(d.date),font,{anchor:'middle'});});
}
function desktop(){
  const a=new Overlay(1536,1024);
  // Both date lines have identical type size and weight.
  a.rect(1010,39,510,103);a.text(1019,81,'Progress through',34);a.text(1019,126,fullDate,34);
  a.rect(211,310,540,52);a.text(220,348,`${fmt(data.record)} cataloged haiku`,35);
  a.rect(208,465,560,77);a.goal(217,525,64);
  a.rect(208,666,555,76);a.metric(215,724,fmt(data.crumbs),'crumbs written',66,61);
  a.rect(210,752,553,80);progress(a,{x:218,y:765,w:522,font:28,labelY:816});
  a.rect(184,860,580,81);a.text(192,891,`At a pace of ${data.dailyPace} crumbs/day`,28);a.text(192,929,`Projected finish: ${finishDate}`,28);
  a.rect(805,299,704,303);chart(a,{x:858,y:318,w:637,h:230,font:24});
  a.rect(939,664,576,77);a.metric(948,720,fmt(data.words),'words in Crumbs',59,49);
  a.rect(1278,807,226,46);a.text(1495,840,`${fmt(data.books[0].words)} words`,30,{anchor:'end'});
  a.rect(1278,918,226,44);a.text(1495,950,`${fmt(data.books[1].words)} words`,30,{anchor:'end'});
  return a;
}
function phone(){
  const a=new Overlay(856,1838);
  a.rect(34,195,800,98);a.text(43,234,'Progress through',37);a.text(43,281,fullDate,37);
  a.rect(208,444,625,53);a.text(215,484,`${fmt(data.record)} cataloged haiku`,36);
  a.rect(207,581,626,82);a.goal(215,642,66);
  a.rect(207,754,628,79);a.metric(215,814,fmt(data.crumbs),'crumbs written',68,62);
  a.rect(208,858,625,91);progress(a,{x:215,y:870,w:605,font:32,labelY:929});
  a.rect(155,962,680,92);a.text(164,1000,`At a pace of ${data.dailyPace} crumbs/day`,34);a.text(164,1044,`Projected finish: ${finishDate}`,34);
  a.rect(24,1205,810,244);chart(a,{x:87,y:1234,w:733,h:166,font:29});
  a.rect(180,1508,657,77);a.metric(188,1567,fmt(data.words),'words in Crumbs',66,55);
  a.rect(576,1641,257,54);a.text(821,1682,`${fmt(data.books[0].words)} words`,34,{anchor:'end'});
  a.rect(576,1754,257,54);a.text(821,1794,`${fmt(data.books[1].words)} words`,34,{anchor:'end'});
  return a;
}
function difference(book){const gap=data.words-book.words;return gap>=0?`${fmt(gap)} words ahead`:`${fmt(-gap)} words to go`;}
function alternativeText(){return `${title}: Progress through ${fullDate} - The Record Holder: Masaoka Shiki: ${fmt(data.record)} cataloged haiku - The Goal: Write ${fmt(data.goal)} crumbs, one more than the record - Progress: ${fmt(data.crumbs)} crumbs written; ${completion}% completed; ${fmt(remaining)} remaining - At a pace of ${data.dailyPace} crumbs/day: Projected finish ${finishDate} - Weekly Output: Number of crumbs written, by week ending date: ${data.weeks.map(w=>`${weekDate(w.date)} ${asDate(w.date).getUTCFullYear()} = ${w.count}`).join(', ')} - Current Word Count: Crumbs: ${fmt(data.words)} words; ${data.books.map(b=>`${b.author}’s ${b.title}: ${fmt(b.words)} words (Crumbs: ${difference(b)})`).join('; ')}`;}
async function main(){
  if(data.weeks.length!==6||data.books.length!==2||remaining<0||data.dailyPace<=0)throw new Error('Invalid statistics snapshot');
  const args=process.argv.slice(2);function input(flag,fallback){const i=args.indexOf(flag);return i<0?fallback:args[i+1];}
  for(const [name,art,flag] of [['Progress',desktop(),'--desktop-art'],['ProgressP',phone(),'--phone-art']]){
    const output=path.join(root,'img',`${name}.jpg`),source=fs.readFileSync(input(flag,output)),meta=await sharp(source).metadata();
    if(meta.width!==art.width||meta.height!==art.height)throw new Error(`Unexpected dimensions for ${name}; new artwork needs matching placement coordinates`);
    const jpg=await sharp(source).composite([{input:Buffer.from(art.svg())}]).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();
    fs.writeFileSync(output,jpg);console.log(`${name}.jpg: ${art.width} × ${art.height}; ${jpg.length} bytes`);
  }
  const index=path.join(root,'index.html'),source=fs.readFileSync(index,'utf8'),matches=source.match(/<picture class="crumbs-stats-image">[\s\S]*?<\/picture>/g);
  if(!matches||matches.length!==1)throw new Error('Expected exactly one Stats picture');
  const picture=`<picture class="crumbs-stats-image">\n  <source media="(max-width: 600px)" srcset="img/ProgressP.jpg" />\n  <img src="img/Progress.jpg" alt="${esc(alternativeText())}" />\n</picture>`;
  fs.writeFileSync(index,source.replace(matches[0],picture));console.log(alternativeText());
}
main().catch(e=>{console.error(e);process.exitCode=1;});
