#!/usr/bin/env node
// Rebuild both complete JPGs and their shared ALT text from stats-data.json.
// Requirements: Node.js, sharp, and Nimbus Sans (regular and bold).
// Run: node scripts/render-stats.cjs
// SVGs are intermediate artwork only; the page displays the finished JPGs.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const data = require('./stats-data.json');
const root = path.resolve(__dirname, '..');
const fmt = n => n.toLocaleString('en-US');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const asDate = s => new Date(`${s}T12:00:00Z`);
const date = asDate(data.through);
const remaining = data.goal - data.crumbs;
const completion = (100 * data.crumbs / data.goal).toFixed(1);
const finish = new Date(date.getTime() + Math.ceil(remaining / data.dailyPace) * 86400000);
const month = d => d.toLocaleDateString('en-US', {month:'short', timeZone:'UTC'});
const fullDate = date.toLocaleDateString('en-US', {weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});
const finishDate = `${finish.getUTCDate()} ${month(finish)} ${finish.getUTCFullYear()}`;
const weekDate = s => `${asDate(s).getUTCDate()} ${month(asDate(s))}`;
const C = {ink:'#11151A', muted:'#56616D', blue:'#075AD6', rule:'#DCE3EA', track:'#E8EDF3'};
const sans = 'Nimbus Sans';
const title = 'History’s Most Prolific Writer';
function difference(book) {
  const gap = data.words - book.words;
  return gap >= 0 ? `${fmt(gap)} words ahead` : `${fmt(-gap)} words to go`;
}
class Art {
  constructor(width,height) {this.width=width;this.height=height;this.parts=[];}
  raw(s) {this.parts.push(s);}
  text(x,y,s,size=28,{color=C.ink,family=sans,weight=400,anchor='start',spacing=0,italic=false}={}) {
    this.raw(`<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${color}" letter-spacing="${spacing}"${italic?' font-style="italic"':''}>${esc(s)}</text>`);
  }
  label(x,y,s,size=26) {this.text(x,y,s,size,{weight:700,spacing:1.5,color:C.ink});}
  line(x1,y1,x2,y2,color=C.rule,width=1.5) {this.raw(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"/>`);}
  rect(x,y,w,h,color,r=0) {this.raw(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${color}"/>`);}
  title(x,y,s,size) {this.text(x,y,s,size,{weight:700,color:'#000000',spacing:-0.8});}
  metric(x,y,value,label,size=80,labelSize=32,{color=C.blue,labelColor=C.ink,gap=12}={}) {
    // Inline text layout keeps the label close even as the number changes.
    this.raw(`<text x="${x}" y="${y}" font-family="${sans}" font-size="${size}" font-weight="700" fill="${color}">${esc(value)}<tspan dx="${gap}" font-size="${labelSize}" font-weight="400" fill="${labelColor}">${esc(label)}</tspan></text>`);
  }
  svg() {return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}"><rect width="100%" height="100%" fill="white"/>${this.parts.join('')}</svg>`;}
}
function bars(a,{x,y,w,h,font=24}) {
  const max = Math.max(250,Math.ceil(Math.max(...data.weeks.map(d=>d.count))/50)*50);
  for(let v=0;v<=max;v+=50){
    const yy=y+h-v/max*h;
    a.line(x,yy,x+w,yy,v===0?'#94A3B8':C.rule,v===0?1.7:1);
    a.text(x-16,yy+font*.34,String(v),font,{anchor:'end',color:C.muted});
  }
  const band=w/data.weeks.length;
  data.weeks.forEach((d,i)=>{
    const bw=band*.64,xx=x+band*i+(band-bw)/2,bh=d.count/max*h;
    a.rect(xx,y+h-bh,bw,bh,C.blue);
    a.text(xx+bw/2,y+h-bh-14,String(d.count),font+3,{anchor:'middle',weight:600,color:C.blue});
    const [day,mon]=weekDate(d.date).split(' ');
    a.text(xx+bw/2,y+h+font+16,`${day} ${mon}`,font,{anchor:'middle',color:C.muted});
  });
}
function desktop() {
  const a=new Art(1600,970);
  a.title(16,80,title,68);
  a.text(1584,42,'Progress through',28,{anchor:'end',color:C.muted});
  a.text(1584,80,fullDate,28,{anchor:'end',color:C.muted});
  a.line(16,124,1584,124);

  // Primary message: the existing record and the target that exceeds it.
  a.label(16,178,'THE RECORD HOLDER');
  a.text(16,252,'Masaoka Shiki',58,{weight:700});
  a.metric(16,312,fmt(data.record),'cataloged haiku',40,30,{color:C.ink,labelColor:C.muted});
  a.line(800,162,800,322);
  a.label(844,178,'THE GOAL');
  a.metric(844,262,fmt(data.goal),'crumbs',80,36);
  a.text(844,312,'One more than the record',30,{color:C.muted});
  a.line(16,352,1584,352);

  // Progress is the next level; pace remains a compact supporting note.
  a.label(16,406,'PROGRESS');
  a.metric(16,514,fmt(data.crumbs),'crumbs written',88,34);
  a.rect(16,553,728,18,C.track,9);
  a.rect(16,553,728*data.crumbs/data.goal,18,C.blue,9);
  a.text(16,631,`${completion}%`,40,{weight:700,color:C.blue});
  a.text(744,627,`${fmt(remaining)} remaining`,31,{anchor:'end',color:C.muted});
  a.text(16,687,`At a pace of ${data.dailyPace} crumbs/day`,28,{color:C.muted});
  a.text(16,726,`Projected finish: ${finishDate}`,28,{color:C.muted});
  a.label(844,406,'RECENT WEEKS’ OUTPUT');
  a.text(844,450,'Crumbs written, by week ending date',28,{color:C.muted});
  bars(a,{x:904,y:494,w:680,h:196,font:27});
  a.line(16,770,1584,770);

  // The total and benchmarks share one horizontal comparison panel.
  a.label(16,824,'CURRENT WORD COUNT');
  a.metric(16,914,fmt(data.words),'words in Crumbs',76,32);
  data.books.forEach((b,i)=>{
    const y=824+i*98;
    a.text(844,y,b.title,33,{weight:700});
    a.text(1584,y,fmt(b.words),32,{anchor:'end',weight:700});
    a.text(844,y+37,b.author,28,{color:C.muted});
    a.text(1584,y+37,difference(b),28,{anchor:'end',color:C.blue});
    if(!i)a.line(844,y+58,1584,y+58);
  });
  return a;
}
function phone() {
  const a=new Art(780,1824);
  a.title(12,74,'History’s Most',70);
  a.title(12,154,'Prolific Writer',70);
  a.text(12,214,'Progress through',34,{color:C.muted});
  a.text(12,260,fullDate,34,{color:C.muted});
  a.line(12,296,768,296);

  a.label(12,350,'THE RECORD HOLDER',30);
  a.text(12,417,'Masaoka Shiki',46,{weight:700});
  a.text(12,474,`${fmt(data.record)} haiku`,36,{color:C.muted});
  a.line(402,330,402,484);
  a.label(440,350,'THE GOAL',30);
  a.text(440,422,fmt(data.goal),72,{weight:700,color:C.blue});
  a.text(440,474,'crumbs to write',36,{color:C.muted});
  a.line(12,514,768,514);

  a.label(12,570,'PROGRESS',32);
  a.metric(12,667,fmt(data.crumbs),'crumbs written',90,38);
  a.rect(12,705,756,18,C.track,9);
  a.rect(12,705,756*data.crumbs/data.goal,18,C.blue,9);
  a.text(12,779,`${completion}%`,42,{weight:700,color:C.blue});
  a.text(768,775,`${fmt(remaining)} remaining`,35,{anchor:'end',color:C.muted});
  a.text(12,834,`At a pace of ${data.dailyPace} crumbs/day`,32,{color:C.muted});
  a.text(12,877,`Projected finish: ${finishDate}`,32,{color:C.muted});
  a.line(12,920,768,920);

  a.label(12,976,'RECENT WEEKS’ OUTPUT',32);
  a.text(12,1021,'Crumbs written, by week ending date',32,{color:C.muted});
  bars(a,{x:81,y:1082,w:687,h:224,font:32});
  a.line(12,1390,768,1390);

  a.label(12,1446,'CURRENT WORD COUNT',32);
  a.metric(12,1543,fmt(data.words),'words in Crumbs',84,34);
  data.books.forEach((b,i)=>{
    const y=1634+i*136;
    a.text(12,y,b.title,38,{weight:700});
    a.text(768,y,fmt(b.words),36,{anchor:'end',weight:700});
    a.text(12,y+42,b.author,32,{color:C.muted});
    a.text(768,y+42,difference(b),32,{anchor:'end',color:C.blue});
    if(!i)a.line(12,y+78,768,y+78);
  });
  return a;
}
function alternativeText() {
  return `${title}: Progress through ${fullDate} - The Record Holder: Masaoka Shiki: ${fmt(data.record)} cataloged haiku - The Goal: Write ${fmt(data.goal)} crumbs, one more than the record - Progress: ${fmt(data.crumbs)} crumbs written; ${completion}% completed; ${fmt(remaining)} remaining - At a pace of ${data.dailyPace} crumbs/day: Projected finish ${finishDate} - Weekly Output: Number of crumbs written, by week ending date: ${data.weeks.map(w=>`${weekDate(w.date)} ${asDate(w.date).getUTCFullYear()} = ${w.count}`).join(', ')} - Current Word Count: Crumbs: ${fmt(data.words)} words; ${data.books.map(b=>`${b.author}’s ${b.title}: ${fmt(b.words)} words (Crumbs: ${difference(b)})`).join('; ')}`;
}
async function main() {
  if(data.weeks.length!==6 || remaining<0 || data.dailyPace<=0)throw new Error('Invalid statistics snapshot');
  const out=path.join(root,'img');
  fs.mkdirSync(out,{recursive:true});
  for(const [name,art,density] of [['Progress',desktop(),90],['ProgressP',phone(),72]]) {
    const result=await sharp(Buffer.from(art.svg()),{density}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toFile(path.join(out,`${name}.jpg`));
    console.log(`${name}.jpg: ${result.width} × ${result.height}; ${result.size} bytes`);
    if(process.env.STATS_SVG_PREVIEW_DIR){
      fs.mkdirSync(process.env.STATS_SVG_PREVIEW_DIR,{recursive:true});
      fs.writeFileSync(path.join(process.env.STATS_SVG_PREVIEW_DIR,`${name}.svg`),art.svg());
    }
  }
  const index=path.join(root,'index.html');
  const source=fs.readFileSync(index,'utf8');
  const match=source.match(/<picture class="crumbs-stats-image">[\s\S]*?<\/picture>/g);
  if(!match || match.length!==1)throw new Error('Expected exactly one Stats picture');
  const picture=`<picture class="crumbs-stats-image">\n  <source media="(max-width: 600px)" srcset="img/ProgressP.jpg" />\n  <img src="img/Progress.jpg" alt="${esc(alternativeText())}" />\n</picture>`;
  fs.writeFileSync(index,source.replace(match[0],picture));
  console.log(alternativeText());
}
main().catch(e=>{console.error(e);process.exitCode=1;});
