# Stats image design

The desktop and phone artwork was created with the built-in image tool using the existing main-branch Stats images as visual references. The main branch was not changed.

Reference commit: dab0e8831ca8c1b01a64cdc898902ce54a6cc446.

The finished images are img/Progress.jpg (1536 × 1024) and img/ProgressP.jpg (856 × 1838). Both are complete JPGs at quality 100, including all visible text. The page does not overlay HTML text.

The image tool creates the composition, title, headings, book titles, and icons. scripts/finish-stats.cjs typesets every numeric row from stats-data.json and draws the exact weekly chart and progress bar. It preserves the image-tool artwork. Running it with no artwork arguments uses the existing finished JPGs as its base. The old full-image code renderer has been removed.

## Desktop generation prompt

Use case: style-transfer / editorial design.
Asset: a finished-looking desktop Stats image for a literary website, landscape, ideally 1800 × 1200. Image 1 is the ORIGINAL approved desktop design, image 2 is its approved phone counterpart. These are the visual references. Revise this visual language; do not replace it with a generic dashboard.

Preserve the refined regular-weight black serif typography from the references, readable gray sans-serif supporting type, luminous cobalt-blue accents, pure white background, and especially the blue book, target, rising-bars, and calendar icons in soft pale-blue circles. Restore all four recognizable icons. No bold grotesk lettering, heavy headline weight, card boxes, shadows, decorative flourishes, or top/bottom horizontal border rules. No framing lines. Avoid tiny text. Elegant and immediately readable when displayed at 980px wide. Tight sensible spacing within each fact; balanced breathing room between sections.

Header: title in black, verbatim "History’s Most Prolific Writer", elegant serif, regular weight. Two lines permissible to maintain a spacious header. To its right, gray sans-serif subtitle on two lines, both exactly the same size and weight:
"Progress through"
"Sunday, November 15, 2026"
No line under header.

Body: two balanced columns. Left column contains the three principal icon sections from the reference, in this order:
1. book icon, small gray "THE RECORD HOLDER", "Masaoka Shiki" in prominent regular serif, then "25,091 catalogued haiku".
2. target icon, small gray "THE GOAL", then "Write 25,092 crumbs", the number blue.
3. rising-bars icon, small gray "PROGRESS", then "3,266 crumbs written", blue number and the descriptor directly beside it, not far below. Below, reserve a clean white empty band for a progress bar and its labels, to be inserted accurately later. Do not draw any progress bar or progress labels.
Directly beneath this progress section, a COMPACT calendar icon and modest supporting note: "AT A PACE OF" small, "20 crumbs/day", "Projected finish: 11 Nov 2029". This is secondary, much smaller and less tall than the record holder and goal. Not a large panel or important headline.

Right column:
Top: regular serif heading "Recent Weeks’ Output"; smaller gray subtitle "Number of crumbs written, by week ending date." Then leave a LARGE completely blank white rectangular plot region underneath. Do NOT draw bars, axes, grid lines, dates, values, or any chart. A mathematically exact chart will be inserted later. Design the blank region about 38% of overall image width and 29% of image height, with ample surrounding clearance.
Bottom: a matching smaller blue document/word-count icon, section label "CURRENT WORD COUNT".
Display "166,738 words in Crumbs" with blue number, descriptor close beside it, smaller than the main title.
Below that, two compact literary comparisons with clear spacing, regular typography:
"Uncle Tom’s Cabin"
"Harriet Beecher Stowe"
"166,622 words"
"The Grapes of Wrath"
"John Steinbeck"
"169,481 words"
Make these two book entries easy to scan, with authors and word totals in gray sans serif; titles in serif. They may be two rows with counts aligned on the right. Do NOT add comparison charts, difference numbers, percentages, ornaments or extra copy.

The numeric rows above serve as typographic position guides and will be deterministically re-typeset for exactness; provide a smooth pure white background around every metric so that process is clean. Keep everything flat, front-on, crisp, and unboxed. No top or bottom rules. Minimal outer padding. All text completely within canvas. Coherent design closely related to the two supplied originals, with comfortable lightness and a clear hierarchy.

## Desktop refinement prompt

Edit only the AT A PACE OF section at the bottom left of this Stats image. Every other part of the image, including the blank chart area, all typography, title, subtitle, icons, figures, word count, and white background, must remain unchanged.
The pace section is still too visually important. Reduce its calendar icon and pale-blue circular background to half its current diameter, keeping its center horizontally at about x115 (image width1536). Replace the three-line pace display with two modest gray sans-serif lines at about 29px, aligned with the left column text:
"At a pace of 20 crumbs/day"
"Projected finish: 11 Nov 2029"
No oversized blue number, no uppercase pace heading. Calendar icon now about65px across. Keep the note around y882–950. This is a small supporting note under the more important record, goal and progress. Maintain all other pixels and composition as faithfully as possible. No horizontal rules.

## Phone generation prompt

Use case: style-transfer / editorial design.
Create the PHONE version of the supplied desktop Stats design. Image 1 is the new desktop design and controls its visual style. Image 2 is the original phone version, whose stacked composition and blue icons must be retained. Produce one tall portrait image, ideally 1024 × 2200, white background, flat front-on, crisp polished typography. This will display at 358px wide, so keep all text generously sized and legible. Minimal side padding, no excessive blank margins.

Match image 1's regular serif typography, blue key numbers, gray sans-serif supporting type, and soft pale blue circles with cobalt icons. Retain book, target, rising-bars, and calendar icons from image 2. No heavy sans-serif headlines, no cards, borders, dividers, horizontal framing rules, or shadows. Clear hierarchy: record holder and goal are primary; pace is secondary and COMPACT.

Top title all black in a regular elegant serif, TWO lines exactly:
"History’s Most"
"Prolific Writer"
Below, subtitle in gray sans serif, two lines of identical font, weight and size:
"Progress through"
"Sunday, November 15, 2026"

Stack the following sections:
1. Book icon with "THE RECORD HOLDER", prominent "Masaoka Shiki", and "25,091 catalogued haiku".
2. Target icon with "THE GOAL", and "Write 25,092 crumbs" on one line if possible; number blue.
3. Rising-bars icon with "PROGRESS", and "3,266 crumbs written" on one line, number blue and label directly adjacent. Beneath this row leave a clean white band of 80px height for an accurate progress bar and its labels, inserted later. Do NOT draw progress bar or progress percentage/remaining labels.
4. A small calendar icon, ONLY ABOUT HALF the diameter of the three icons above, with a two-line supporting note:
"At a pace of 20 crumbs/day"
"Projected finish: 11 Nov 2029"
The ENTIRE pace section should be compact, no large headline, no overlarge blue 20. Font around 36px at 1024px wide, roughly half the main figure size. Use at most 100px height.
5. "Recent Weeks’ Output" in regular serif, then "Number of crumbs written, by week ending date." in legible gray sans serif. Leave a completely blank white rectangle below for a precise chart, about 90% canvas width and 300px high at 1024px width. Do NOT draw any axes, grids, bars, values or date labels. The blank chart will be added later.
6. Matching word-count/document icon, "CURRENT WORD COUNT", then "166,738 words in Crumbs". Blue number, descriptor directly beside it at a slightly smaller size. Readable at phone width.
7. Two clearly separated comparison rows, book titles serif, supporting text gray sans-serif. Exact text:
"Uncle Tom’s Cabin"
"Harriet Beecher Stowe"
"166,622 words"
and:
"The Grapes of Wrath"
"John Steinbeck"
"169,481 words"
Use a clear compact layout with the word totals aligned to the right if space allows, or a readable second line. No tiny text.

All numbers are typographic position guides and will be deterministically typeset to ensure accuracy; keep their background smoothly white. Use consistent alignment, modest spacing within each fact and comfortable spacing between groups. Strong resemblance to the supplied original phone image. Beautiful restrained editorial design, without ornamental additions or excess whitespace. All copy must fit.

