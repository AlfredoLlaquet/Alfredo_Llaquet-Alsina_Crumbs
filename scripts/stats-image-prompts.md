# Stats image design

The desktop and phone artwork was revised with the built-in image tool using the accepted development images from commit b46f0100a0b0cfe0c237d52ea280dc1f6b260a74. The original main-branch icon and serif style is retained. Main was not changed.

The finished images are img/Progress.jpg (1536 × 1024) and img/ProgressP.jpg (936 × 1680). Both are complete JPGs at quality 100, including all text. The page does not overlay HTML text.

The image tool creates the composition, title, headings, book titles, author names, and icons. scripts/finish-stats.cjs typesets numeric rows from stats-data.json, draws the exact smaller chart and progress bar, and selects the blue comparison signs from the word totals. The script preserves the image-tool artwork. With no artwork arguments, it uses the existing finished JPGs as its base.

## Desktop revision prompt

Edit this DESKTOP Stats image with a restrained editorial refinement. Preserve the established serif typography, cobalt blue, gray sans serif labels, pure white background, and illustrated blue icons in pale blue circular discs. The left panels are approved: keep THE RECORD HOLDER, THE GOAL, PROGRESS and the compact pace note, including their icons, hierarchy, positions and spacing, unchanged as faithfully as possible. No borders, horizontal framing rules, cards or shadows.

Only these changes:
HEADER: replace title with the exact all-black text "Becoming History’s Most Prolific Writer". Keep it on one line across the width, in the same serif style, slightly smaller as needed. Move the entire subtitle BELOW the title, left-aligned, on ONE continuous line:
"Progress through Sunday, November 15, 2026"
Use one consistent gray sans-serif font and size throughout that single line. Keep header comfortably separated from the first body panels, without pushing the left panels down.

RIGHT TOP PANEL: replace the current oversized serif heading with a gray sans-serif uppercase label "RECENT WEEKS’ OUTPUT", exactly the same style and scale as "THE RECORD HOLDER" and "CURRENT WORD COUNT". Add a LARGE round pale-blue icon to its left, similar in diameter to the left-side book and target discs (about150px at this1536px width). The new icon should be a cobalt outline of a calendar containing a small bar chart. To the right of the icon, below the uppercase label, use a smaller gray subtitle: "Crumbs written by week ending date". It can break into two lines if needed.
Below this header, reserve a clean blank white rectangle for a smaller precise chart. Do NOT draw bars, axes, tick labels, dates, values or any chart in this rectangle. It will be added accurately afterward. The reserved region should be about550px wide and230px high, inside the right column; aim for its top around y350 and bottom around y580. Preserve balanced padding and space before the word-count panel.

RIGHT LOWER PANEL: keep "CURRENT WORD COUNT" (WORD, not WORLD) and the figure "166,738 words in Crumbs" with descriptor close to the number. Keep the document icon and coordinate it visually with the new weekly icon. Improve the spacing within this panel and its separation from the weekly panel.
Make the two book titles about25% smaller than currently, and their author names about15% smaller. Use regular elegant serif for titles and gray sans serif for authors, without heavy black emphasis. Add a blue GREATER-THAN sign ">" immediately BEFORE "Uncle Tom’s Cabin", and a blue LESS-THAN sign "<" immediately BEFORE "The Grapes of Wrath". These are clear mathematical signs, not arrows or chevrons pointing to links. Each sign is part of the corresponding book comparison.
Exact comparison text:
"> Uncle Tom’s Cabin"
"Harriet Beecher Stowe"
"166,622 words"
"< The Grapes of Wrath"
"John Steinbeck"
"169,481 words"
Keep word totals neatly aligned on the right. Each book title and its author form a tight pair, with more space between the two books. Avoid giant titles or wide gaps between a title and its author.

Output a full1536×1024 desktop graphic. Numeric rows are visual position guides and will be typeset exactly afterward; keep their backgrounds pure white. Preserve the approved left-side layout. Improve coherence in the right column and make the two right-panel headings match the left-panel headings. All text within the canvas.

## Desktop alignment refinement

Make one precise refinement to this desktop image: align the two RIGHT-HAND panel headers. Change only the new weekly-output icon, heading and subtitle; every other part must stay unchanged.
Move the weekly calendar-and-bars icon so its center aligns horizontally with the document icon below it, around x866. Keep its large pale-blue circular disc; position it around y205–335.
Set "RECENT WEEKS’ OUTPUT" in exactly the SAME font, size, weight and letter spacing as "CURRENT WORD COUNT", not larger. Align both headings to the same left edge, x948. Put the weekly heading baseline around y220, and its smaller gray subtitle "Crumbs written by week ending date" below it around y266. Keep all text within the right column. Preserve the entirely blank chart space below and above the word-count panel.
Do not change the main title or single-line subtitle, left panels, pace note, book titles, authors, comparison signs, figures, colors, or white background. No horizontal rules.

## Phone revision prompt

Edit the PHONE Stats image (image1) to match the refined desktop artwork (image2). Preserve image1's established serif style, cobalt blue and gray palette, pure white background, and soft pale-blue circles with blue book, target, progress, calendar and document icons. Preserve the accepted record-holder, goal, progress and compact pace sections with their existing typography, icon sizes and hierarchy. No borders, framing lines, cards or shadows.

HEADER: exact all-black serif title, on exactly TWO lines:
"Becoming History’s"
"Most Prolific Writer"
Keep the entire title within the narrow canvas, reduce its size from image1 if necessary. Immediately BELOW it put this exact subtitle on ONE line:
"Progress through Sunday, November 15, 2026"
Use the same gray sans-serif font throughout the line. Make the single-line subtitle as large as fits, around29px on this856px-wide image. Do not split it or omit any word. Keep a moderate gap to the first panel; avoid a large empty header.

RECORD HOLDER, GOAL, PROGRESS, PACE: keep these approved sections, their content and proportionate spacing. They can move upward slightly together if the shorter subtitle frees space. Preserve the small calendar icon and modest two-line pace note.

WEEKLY PANEL: make this a matching icon-led panel, like PROGRESS and CURRENT WORD COUNT. Add a large pale-blue circular disc containing a blue calendar with small bars inside, matching the NEW weekly icon in image2. Its diameter should be about the same as the book and target icon discs.
To the right use gray uppercase sans-serif "RECENT WEEKS’ OUTPUT", same scale and weight as the other panel labels. Below it use a smaller gray subtitle "Crumbs written by week ending date", wrapping into two lines if necessary.
Remove the old large serif heading. Below the icon/title block leave a clean blank white plot rectangle, modestly smaller than the old chart, about700px wide and230px tall including future axis labels. Do NOT draw chart bars, axes, grid lines, date labels or values. The mathematically exact chart will be added afterward. Ensure a comfortable visible gap between the blank plot region and the next panel.

WORD COUNT PANEL: retain uppercase "CURRENT WORD COUNT" (WORD, not WORLD), its document icon, and the blue number "166,738" close beside "words in Crumbs". Below, reduce both book titles and authors compared with image1: titles about34–36px regular serif, authors around30px gray sans-serif at856px image width. Add a clear blue greater-than symbol ">" directly before "Uncle Tom’s Cabin", and a clear blue less-than symbol "<" directly before "The Grapes of Wrath".
Exact entries:
"> Uncle Tom’s Cabin"
"Harriet Beecher Stowe"
"166,622 words"
"< The Grapes of Wrath"
"John Steinbeck"
"169,481 words"
Make word totals align neatly at the right; keep each title and its author close together. Separate the two comparison entries with breathing room. Symbols are mathematical > and <, not link arrows. Retain the overall established editorial look and make the two lower panels more coherent and less dominant. All text fully within the canvas.
Use a portrait aspect ratio similar to image1 (about856×1838). Numeric rows are only typographic guides and will be accurately typeset afterward. Keep backgrounds around them pure white.
