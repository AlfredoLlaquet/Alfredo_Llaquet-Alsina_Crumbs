#!/usr/bin/env node
// Rebuild both complete JPGs and their shared ALT text from stats-data.json.
// Requirements: Node.js, sharp, Liberation Serif, and DejaVu Sans.
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
const C = {ink:'#101722', muted:'#475569', blue:'#075AD6', pale:'#EAF1FC', rule:'#D4DEE9', track:'#E6EBF2'};
const serif = 'Liberation Serif';
const sans = 'DejaVu Sans';
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
  label(x,y,s,size=24) {this.text(x,y,s,size,{weight:600,spacing:1.8,color:C.muted});}
  line(x1,y1,x2,y2,color=C.rule,width=1.5) {this.raw(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"/>`);}
  rect(x,y,w,h,color,r=0) {this.raw(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${color}"/>`);}
  title(x,y,size) {this.raw(`<text x="${x}" y="${y}" font-family="${serif}" font-size="${size}" font-weight="700" fill="${C.ink}">The Road to <tspan fill="${C.blue}">${fmt(data.goal)}</tspan></text>`);}
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
  const a=new Art(1600,980);
  a.title(16,86,79);
  a.text(1584,44,'Progress through',28,{anchor:'end',color:C.muted});
  a.text(1584,86,fullDate,30,{anchor:'end',color:C.muted});
  a.line(16,124,1584,124);
  a.line(784,162,784,934);
  a.label(16,185,'THE RECORD HOLDER');
  a.text(16,249,'Masaoka Shiki',48,{family:serif});
  a.text(16,294,`${fmt(data.record)} cataloged haiku`,27,{color:C.muted});
  a.line(401,165,401,300);
  a.label(440,185,'THE GOAL');
  a.text(440,251,fmt(data.goal),64,{family:serif,weight:700,color:C.blue});
  a.text(440,294,'crumbs',29,{color:C.muted});
  a.line(16,334,744,334);
  a.label(16,382,'PROGRESS');
  a.text(16,486,fmt(data.crumbs),106,{family:serif,weight:700,color:C.blue});
  a.text(306,481,'crumbs written',36);
  a.rect(16,519,728,20,C.track,10);
  a.rect(16,519,728*data.crumbs/data.goal,20,C.blue,10);
  a.text(16,591,`${completion}%`,42,{weight:600,color:C.blue});
  a.text(744,588,`${fmt(remaining)} remaining`,31,{anchor:'end',color:C.muted});
  a.line(16,630,744,630);
  a.label(16,681,'AT A PACE OF');
  a.text(16,791,String(data.dailyPace),106,{family:serif,weight:700,color:C.blue});
  a.text(140,785,'crumbs/day',43,{family:serif});
  a.text(16,856,'Projected finish',29,{color:C.muted});
  a.text(16,924,finishDate,57,{family:serif,color:C.blue});
  a.label(824,185,'RECENT WEEKS’ OUTPUT');
  a.text(824,229,'Crumbs written, by week ending date',26,{color:C.muted});
  bars(a,{x:884,y:278,w:700,h:262,font:25});
  a.line(824,630,1584,630);
  a.label(824,681,'WORD COUNT');
  a.text(824,757,fmt(data.words),76,{family:serif,weight:700,color:C.blue});
  a.text(1122,753,'words in Crumbs',29,{color:C.muted});
  data.books.forEach((b,i)=>{
    const y=815+i*108;
    a.text(824,y,b.title,35,{family:serif,italic:true});
    a.text(1584,y,fmt(b.words),31,{anchor:'end',weight:600});
    a.text(824,y+39,b.author,25,{color:C.muted});
    a.text(1584,y+39,difference(b),25,{anchor:'end',color:C.blue});
    if(!i)a.line(824,y+59,1584,y+59);
  });
  return a;
}
function phone() {
  const a=new Art(780,1954);
  a.title(12,85,80);
  a.text(12,143,'Progress through',34,{color:C.muted});
  a.text(12,188,fullDate,34,{color:C.muted});
  a.line(12,222,768,222);
  a.label(12,274,'THE RECORD HOLDER',28);
  a.text(12,334,'Masaoka Shiki',45,{family:serif});
  a.text(12,380,`${fmt(data.record)} haiku`,34,{color:C.muted});
  a.line(402,260,402,386);
  a.label(438,274,'THE GOAL',28);
  a.text(438,339,fmt(data.goal),64,{family:serif,weight:700,color:C.blue});
  a.text(438,380,'crumbs',34,{color:C.muted});
  a.line(12,416,768,416);
  a.label(12,470,'PROGRESS',32);
  a.text(12,568,fmt(data.crumbs),96,{family:serif,weight:700,color:C.blue});
  a.text(290,562,'crumbs written',38);
  a.rect(12,604,756,20,C.track,10);
  a.rect(12,604,756*data.crumbs/data.goal,20,C.blue,10);
  a.text(12,678,`${completion}%`,43,{weight:600,color:C.blue});
  a.text(768,674,`${fmt(remaining)} remaining`,34,{anchor:'end',color:C.muted});
  a.line(12,716,768,716);
  a.label(12,771,'AT A PACE OF',32);
  a.text(12,861,String(data.dailyPace),94,{family:serif,weight:700,color:C.blue});
  a.text(125,855,'crumbs/day',47,{family:serif});
  a.text(12,918,`Projected finish: ${finishDate}`,35,{color:C.muted});
  a.line(12,958,768,958);
  a.label(12,1013,'RECENT WEEKS’ OUTPUT',32);
  a.text(12,1060,'Crumbs written, by week ending date',32,{color:C.muted});
  bars(a,{x:81,y:1126,w:687,h:242,font:30});
  a.line(12,1442,768,1442);
  a.label(12,1497,'WORD COUNT',32);
  a.text(12,1584,fmt(data.words),84,{family:serif,weight:700,color:C.blue});
  a.text(342,1578,'words in Crumbs',34,{color:C.muted});
  data.books.forEach((b,i)=>{
    const y=1657+i*183;
    a.text(12,y,b.title,43,{family:serif,italic:true});
    a.text(768,y,fmt(b.words),36,{anchor:'end',weight:600});
    a.text(12,y+47,b.author,32,{color:C.muted});
    a.text(768,y+91,difference(b),32,{anchor:'end',color:C.blue});
    if(!i)a.line(12,y+112,768,y+112);
  });
  return a;
}
function alternativeText() {
  return `The Road to ${fmt(data.goal)}: Progress through ${fullDate} - The Record Holder: Masaoka Shiki: ${fmt(data.record)} cataloged haiku - The Goal: Write ${fmt(data.goal)} crumbs - Progress: ${fmt(data.crumbs)} crumbs written; ${completion}% completed; ${fmt(remaining)} remaining - At a pace of ${data.dailyPace} crumbs/day: Projected finish ${finishDate} - Weekly Output: Number of crumbs written, by week ending date: ${data.weeks.map(w=>`${weekDate(w.date)} ${asDate(w.date).getUTCFullYear()} = ${w.count}`).join(', ')} - Word Count: Crumbs: ${fmt(data.words)} words; ${data.books.map(b=>`${b.author}’s ${b.title}: ${fmt(b.words)} words (${difference(b)})`).join('; ')}`;
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
