# Scriptdesk

A scriptwriting tool in the spirit of the old Celtx desktop app. It runs in the browser as a plain static site, so it works on GitHub Pages. There is no server, database or account. Your work lives in a project file on your own computer.

## Features

- **Script editor that formats as you type.** Use Enter and Tab to move between Scene Heading, Action, Character, Parenthetical, Dialogue, Transition and Shot.
- **Five script types:** Screenplay, Stage Play, Audio Play, Comic Book and AV Script (two columns: video on the left, audio on the right). Comic pages and panels are numbered automatically.
- **Autocomplete** for character names, `INT.`/`EXT.`, locations, times of day, transitions and `(V.O.)`/`(O.S.)`.
- **Project tree** that can hold several scripts plus the other documents below.
- **Find & replace** (Ctrl+F, Ctrl+H) in one script or all of them, with match case and whole words. **Rename character** changes a name everywhere: cues, dialogue and action, the catalog, the storyline, storyboard captions and beat board cards.
- **Comments** on selected words or a line (Ctrl+Alt+M). Commented words are highlighted, the scene panel lists the scene's comments, and you can resolve or reopen them.
- **Table read:** the browser reads the script aloud from the cursor, with a narrator for headings and action and a voice for each character. You can choose the voices and the speed.
- **Scene navigator** showing page-length estimates in eighths.
- **Scene panel** for each scene's synopsis, colour, notes, characters (detected automatically) and breakdown items (props, wardrobe, vehicles, effects…).
- **Master Catalog** shared by every script in the project, with a detailed form for each kind of item, following the old Celtx forms:
  - **Character:** physical description, personality, motivation, background, voice, arc, and *Played by* (an Actor).
  - **Actor:** roles, availability, contact details and wardrobe sizes.
  - **Location:** address, contact and facility details.
  - **Props, wardrobe and other production items:** who uses them, size, era, procurement and supplier.
  - **Every item:** photos, tags, your own extra fields, and a list of the scenes it appears in.
- **Character sheets and actor packs:** printable pages that give an actor the full profile of their character, the scene list, and *sides* (the text of their scenes with their lines in bold).
- **Index cards** that you drag to reorder scenes.
- **Storyline:** a flow chart with one line per character, drawn across the moments of your story:
  - Lines bundle together when characters share a moment, split when they go separate ways, and turn into dashed lines while a character is off-screen.
  - You mark events (meetings, conflicts, turning points, revelations…) on the lines of the characters they affect.
  - You can build it from a script's scenes and update it later, or draw it by hand in the grid.
  - It downloads as SVG or prints to PDF.
- **Storyboard,** like the old Celtx one: a sequence for each scene, with a row of shots in each.
  - Every shot has a picture (open, drop or paste one), an optional drawing on top made with the built-in pen, arrow and box tools, a description, shot type, camera movement, lens, length, sound and notes.
  - Shots are numbered by scene (3A, 3B…) and can be dragged into a new order.
  - *Draft shots from the scene* suggests a shot for each action paragraph and speaker.
  - The **Shot list** tab shows every shot as an editable table, which also downloads as CSV.
  - **Play** shows the shots one after another, timed by their length, like an animatic.
  - Prints as frames (2, 3 or 4 across) or as a shot list.
- **Title page.**
- **Reports:** script health, scene list, characters (speeches and word counts), locations, and breakdown sheets.
  - **Health** shows scene lengths, dialogue against action per scene, who speaks where across the script, each character's share of the dialogue, the longest speeches, and things worth a look (very long scenes, one-line characters, characters who disappear in the middle).
- **Beat board:** pick a structure (three acts, Save the Cat, hero's journey, story circle, seven-point, or your own), then drag scenes onto the beats and add note cards. Empty beats show the gaps, and a scene far from where its beat usually falls is marked early or late.
- **Sketch:** a top-down plan of a set, like the old Celtx sketch tool. It has cameras that show what they see, lights, a boom mic, actors who face a direction, marks, furniture, doors, windows, cars and trees. You can also draw walls, movement arrows, areas and text, and put a floor plan or photo underneath. Sketches download as PNG or SVG, and a storyboard shot can use one as its camera setup.
- **Production schedule:** a strip board with strips coloured by interior/exterior and day/night, and cast numbers.
  - Drag scenes onto shoot days, or let **Auto-schedule** group them by location and day/night with a page limit per day.
  - It also has a calendar with shoot days and events, a one-line schedule, printable call sheets, *mark as shot*, and an `.ics` download for calendar apps.
- **Notes** with formatting: headings, bold, italic, lists, quotes.
- **Writing goals and sprint timer** (⏱ in the top bar): a daily word goal, target page count, sprint timer with optional scheduled breaks, a 14-day history and a streak. The history is saved in the project file.
- **Print or save as PDF**, with standard screenplay margins and page numbers.
- **Import** `.fountain`, `.fdx` (Final Draft) and `.celtx`. A `.celtx` import (from the old Celtx desktop app) brings in scripts, text documents, the full catalog (with photos and actor links), scene synopses, colours, breakdown tags, notes in the script (as comments), storyboards (with their pictures and camera setup sketches) and production schedules (shoot days, call times, scenes marked as shot, and call sheet details).
- **Export** `.fountain`, `.fdx` and formatted `.txt`.
- **Undo/redo for each document** and light/dark themes.

## Saving

- **Save** (Ctrl+S) writes a `.scriptdesk` file, which is JSON. In Chrome and Edge, Save writes straight back to the same file after the first save. Other browsers download a fresh copy each time.
- **Open** (Ctrl+O) loads a project, or imports a script. You can also drag a file onto the window.
- The browser also keeps a working copy of the open project (in IndexedDB, which has room for storyboard pictures), so a refresh won't lose your work. That copy is **not a backup**. Save the file.

## Running it

Open `index.html` in a browser. No build step is needed.

To publish on GitHub Pages:

1. Push this folder to a GitHub repository.
2. In the repository, go to **Settings → Pages** and set **Source** to `Deploy from a branch`, branch `main`, folder `/ (root)`.
3. The site appears at `https://<user>.github.io/<repo>/`.

**After changing any CSS or JS file**, increase the `?v=` number on the `<link>` and `<script>` tags in `index.html` (for example `?v=5` to `?v=6`). GitHub Pages lets browsers cache files for 10 minutes. Without a new number, a visitor can get the new page together with old cached scripts, and new buttons then silently do nothing.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout |
| `css/app.css` | Application UI |
| `css/script.css` | Script page formatting (screen and print) |
| `js/formats.js` | Script types, elements, page estimates, helpers |
| `js/catalog.js` | Catalog categories, the form for each category, links between items |
| `js/storyline.js` | Storyline chart: data, layout, script sync, SVG drawing |
| `js/storyboard.js` | Storyboard: sequences, shots, shot types, script sync, drafting shots |
| `js/beatboard.js` | Beat board: story structures, scene and note cards |
| `js/sketch.js` | Sketch: top-down set plans with cameras, lights, actors and set pieces |
| `js/schedule.js` | Production schedule: strip board, calendar, one-line schedule, call sheets, `.ics` |
| `js/formats-io.js` | Fountain, Final Draft and Celtx import/export |
| `js/editor.js` | The script editor |
| `js/app.js` | Project, views, files, dialogs |
