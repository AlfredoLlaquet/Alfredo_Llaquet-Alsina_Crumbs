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
const C={ink:'#090909',muted:'#454D5D',blue:'#0662EF',baseline:'#C8D1DC',track:'#E7EAF0'};
const paperSample = {left: 0, top: 0, width: 192, height: 12};
const serif='Nimbus Roman',sans='Open Sans',title='Becoming History’s Most Prolific Writer';
const comparison=book=>data.words>book.words?'>':data.words<book.words?'<':'=';
class Overlay{
  constructor(width,height){this.width=width;this.height=height;this.parts=[];}
  raw(s){this.parts.push(s);}
  rect(x,y,w,h,color='url(#paper)',r=0){this.raw(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${color}"/>`);}
  text(x,y,s,size,{color=C.muted,family=sans,weight=400,anchor='start'}={}){this.raw(`<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${color}">${esc(s)}</text>`);}
  metric(x,y,value,label,size,labelSize){this.raw(`<text x="${x}" y="${y}" font-family="${serif}" font-size="${size}" font-weight="400" fill="${C.blue}">${esc(value)}<tspan dx="9" font-size="${labelSize}" fill="${C.ink}">${esc(label)}</tspan></text>`);}
  goal(x,y,size){this.raw(`<text x="${x}" y="${y}" font-family="${serif}" font-size="${size}" font-weight="400" fill="${C.ink}">Write <tspan fill="${C.blue}">${fmt(data.goal)}</tspan> crumbs</text>`);}
  line(x1,y1,x2,y2,color,width){this.raw(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"/>`);}
  svg(paper) {
    const {width, height} = paperSample;
    const pattern = `<pattern id="paper" patternUnits="userSpaceOnUse" width="${width}" height="${height}"><image width="${width}" height="${height}" xlink:href="data:image/png;base64,${paper.toString('base64')}"/></pattern>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${this.width}" height="${this.height}"><defs>${pattern}</defs>${this.parts.join('')}</svg>`;
  }
}
function progress(a,{x,y,w,font,labelY}){
  a.rect(x,y,w,16,C.track,8);a.rect(x,y,w*data.crumbs/data.goal,16,C.blue,8);
  a.text(x,labelY,`${completion}%`,font,{color:C.blue,weight:600});
  a.text(x+w,labelY,`${fmt(remaining)} remaining`,font,{anchor:'end'});
}
function chart(art, {x, y, w, h, font}) {
  const peak = Math.max(...data.weeks.map(week => week.count));
  // Leave headroom for the count above the tallest bar as weekly output changes.
  const scaleMax = Math.max(250, Math.ceil(peak * 1.2 / 50) * 50);
  const baseline = y + h;
  const slot = w / data.weeks.length;
  const barWidth = slot * 0.7;

  art.line(x, baseline, x + w, baseline, C.baseline, 2);
  data.weeks.forEach((week, index) => {
    const center = x + (index + 0.5) * slot;
    const barHeight = h * week.count / scaleMax;
    const top = baseline - barHeight;
    art.rect(center - barWidth / 2, top, barWidth, barHeight, C.blue);
    art.text(center, top - 12, fmt(week.count), font + 2, {anchor:'middle', weight:600, color:C.blue});
    art.text(center, baseline + font + 14, weekDate(week.date), font, {anchor:'middle'});
  });
}
function desktop(){
  const a=new Overlay(1536,1024);
  // A single subtitle line sits beneath the image-tool title.
  a.rect(47,87,1450,55);a.text(55,122,`Progress through ${fullDate}`,32);
  a.rect(211,310,540,52);a.text(220,348,`${fmt(data.record)} cataloged haiku`,35);
  a.rect(208,465,560,77);a.goal(217,525,64);
  a.rect(208,666,555,76);a.metric(215,724,fmt(data.crumbs),'crumbs written',66,61);
  a.rect(210,752,553,80);progress(a,{x:218,y:765,w:522,font:28,labelY:816});
  a.rect(184,860,580,81);a.text(192,891,`At a pace of ${data.dailyPace} crumbs/day`,28);a.text(192,929,`Projected finish: ${finishDate}`,28);
  a.rect(862,347,646,254);chart(a,{x:882,y:370,w:613,h:173,font:24});
  a.rect(939,664,576,77);a.metric(948,720,fmt(data.words),'words in Crumbs',59,49);
  a.rect(1278,807,226,46);a.text(1495,840,`${fmt(data.books[0].words)} words`,30,{anchor:'end'});
  a.rect(1278,918,226,44);a.text(1495,950,`${fmt(data.books[1].words)} words`,30,{anchor:'end'});
  a.rect(811,776,40,42);a.text(820,811,comparison(data.books[0]),44,{color:C.blue});
  a.rect(811,887,40,42);a.text(820,922,comparison(data.books[1]),44,{color:C.blue});
  return a;
}
function phone(){
  const a=new Overlay(936,1680);
  a.rect(47,150,857,56);a.text(54,190,`Progress through ${fullDate}`,35);
  a.rect(206,337,665,54);a.text(215,373,`${fmt(data.record)} cataloged haiku`,35);
  a.rect(208,464,662,77);a.goal(217,520,64);
  a.rect(208,619,672,79);a.metric(215,674,fmt(data.crumbs),'crumbs written',64,60);
  a.rect(208,705,680,87);progress(a,{x:216,y:716,w:645,font:32,labelY:773});
  a.rect(163,806,727,90);a.text(170,839,`At a pace of ${data.dailyPace} crumbs/day`,32);a.text(170,881,`Projected finish: ${finishDate}`,32);
  a.rect(73,1050,821,219);chart(a,{x:84,y:1071,w:772,h:144,font:30});
  a.rect(190,1326,710,78);a.metric(199,1382,fmt(data.words),'words in Crumbs',64,52);
  a.rect(655,1457,247,49);a.text(892,1492,`${fmt(data.books[0].words)} words`,32,{anchor:'end'});
  a.rect(655,1572,247,51);a.text(892,1608,`${fmt(data.books[1].words)} words`,32,{anchor:'end'});
  a.rect(47,1448,44,44);a.text(53,1484,comparison(data.books[0]),48,{color:C.blue});
  a.rect(47,1557,44,50);a.text(53,1599,comparison(data.books[1]),48,{color:C.blue});
  return a;
}
function difference(book){const gap=data.words-book.words;return gap>=0?`${fmt(gap)} words ahead`:`${fmt(-gap)} words to go`;}
function alternativeText(){return `${title}: Progress through ${fullDate} - The Record Holder: Masaoka Shiki: ${fmt(data.record)} cataloged haiku - The Goal: Write ${fmt(data.goal)} crumbs, one more than the record - Progress: ${fmt(data.crumbs)} crumbs written; ${completion}% completed; ${fmt(remaining)} remaining - At a pace of ${data.dailyPace} crumbs/day: Projected finish ${finishDate} - Weekly Output: Number of crumbs written, by week ending date: ${data.weeks.map(w=>`${weekDate(w.date)} ${asDate(w.date).getUTCFullYear()} = ${w.count}`).join(', ')} - Current Word Count: Crumbs: ${fmt(data.words)} words; ${data.books.map(b=>`${b.author}’s ${b.title}: ${fmt(b.words)} words (Crumbs: ${difference(b)})`).join('; ')}`;}
// Each pair marks a boundary in the original artwork and the new gap at that
// boundary, in source pixels. The desktop columns can be spaced independently.
const desktopSpacing = {
  height: 1128,
  columns: [
    {left: 0, width: 768, gaps: [[158, 16], [382, 43], [594, 45]]},
    {left: 768, width: 768, gaps: [[158, 16], [346, 12], [604, 76]]}
  ]
};
const phoneSpacing = {
  height: 2016,
  columns: [
    {left: 0, width: 936, gaps: [[212, 32], [394, 64], [564, 72], [906, 82], [1269, 86]]}
  ]
};

// The same placements move whole panels when opening an earlier master, or
// just the data overlay when updating a finished, already-spaced picture.
function artworkStrips(layout, originalHeight) {
  const strips = [];
  for (const {left, width, gaps} of layout.columns) {
    let top = 0;
    let offset = 0;
    for (const [end, gap] of [...gaps, [originalHeight, 0]]) {
      strips.push({source: {left, top, width, height: end - top}, left, top: top + offset});
      top = end;
      offset += gap;
    }
  }
  return strips;
}

async function renderStatsImage(source, art, layout) {
  const meta = await sharp(source).metadata();
  const originalSize = meta.height === art.height;
  if (meta.width !== art.width || (!originalSize && meta.height !== layout.height)) {
    throw new Error(`Expected ${art.width}px artwork at ${art.height}px or ${layout.height}px tall; received ${meta.width} × ${meta.height}`);
  }
  // Sample the unprinted edge for both the new gaps and the numeric rows.
  const paper = await sharp(source).extract(paperSample).png().toBuffer();
  const overlay = await sharp(Buffer.from(art.svg(paper))).png().toBuffer();
  const layer = originalSize
    ? await sharp(source).composite([{input: overlay}]).png().toBuffer()
    : overlay;
  const canvas = originalSize
    ? sharp({create: {width: art.width, height: layout.height, channels: 3, background: 'white'}})
    : sharp(source);
  const strips = await Promise.all(artworkStrips(layout, art.height).map(async segment => ({
    input: await sharp(layer).extract(segment.source).png().toBuffer(),
    left: segment.left,
    top: segment.top
  })));
  if (originalSize) strips.unshift({input: paper, tile: true, gravity: 'northwest'});
  return canvas.composite(strips).jpeg({quality: 100, chromaSubsampling: '4:4:4'}).toBuffer();
}

async function main(){
  if(data.weeks.length!==6||data.books.length!==2||remaining<0||data.dailyPace<=0)throw new Error('Invalid statistics snapshot');
  const args=process.argv.slice(2);function input(flag,fallback){const i=args.indexOf(flag);return i<0?fallback:args[i+1];}
  const variants = [
    ['Progress', desktop(), desktopSpacing, '--desktop-art'],
    ['ProgressP', phone(), phoneSpacing, '--phone-art']
  ];
  const index=path.join(root,'index.html'),source=fs.readFileSync(index,'utf8'),matches=source.match(/<picture class="crumbs-stats-image">[\s\S]*?<\/picture>/g);
  if(!matches||matches.length!==1)throw new Error('Expected exactly one Stats picture');
  const alt = alternativeText();
  const altAttribute = /(<img\b[^>]*?\balt=")[^"]*(")/;
  if (!altAttribute.test(matches[0])) throw new Error('Expected Stats image with alt text');
  const picture = matches[0].replace(altAttribute, (_, start, end) => start + esc(alt) + end);
  const outputs = await Promise.all(variants.map(async ([name, art, layout, flag]) => {
    const output = path.join(root, 'img', `${name}.jpg`);
    const image = await renderStatsImage(fs.readFileSync(input(flag, output)), art, layout);
    return {output, image};
  }));
  for (const {output, image} of outputs) {
    fs.writeFileSync(output, image);
    console.log(`${path.basename(output)}: ${image.length} bytes`);
  }
  fs.writeFileSync(index, source.replace(matches[0], () => picture));
  console.log(alt);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
