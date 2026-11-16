# Scriptdesk

A scriptwriting tool in the spirit of the old Celtx desktop app. It runs in the browser as a plain static site, so it works on GitHub Pages. There is no server, database or account. Your work lives in a project file on your own computer.

## Features

- **Script editor that formats as you type.** Use Enter and Tab to move between Scene Heading, Action, Character, Parenthetical, Dialogue, Transition and Shot.
- **Four script types:** Screenplay, Stage Play, Audio Play and Comic Book. Comic pages and panels are numbered automatically.
- **Autocomplete** for character names, `INT.`/`EXT.`, locations, times of day, transitions and `(V.O.)`/`(O.S.)`.
- **Project tree** that can hold several scripts plus notes documents.
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
- **Title page.**
- **Reports:** scene list, characters (speeches and word counts), locations, and breakdown sheets.
- **Print or save as PDF**, with standard screenplay margins and page numbers.
- **Import** `.fountain`, `.fdx` (Final Draft) and `.celtx`. A `.celtx` import (from the old Celtx desktop app) brings in scripts, text documents, the full catalog (with photos and actor links), scene synopses, colours, notes and breakdown tags.
- **Export** `.fountain`, `.fdx` and formatted `.txt`.
- **Undo/redo for each document** and light/dark themes.

## Saving

- **Save** (Ctrl+S) writes a `.scriptdesk` file, which is JSON. In Chrome and Edge, Save writes straight back to the same file after the first save. Other browsers download a fresh copy each time.
- **Open** (Ctrl+O) loads a project, or imports a script. You can also drag a file onto the window.
- The browser also keeps a working copy of the open project, so a refresh won't lose your work. That copy is **not a backup**. Save the file.

## Running it

Open `index.html` in a browser. No build step is needed.

To publish on GitHub Pages:

1. Push this folder to a GitHub repository.
2. In the repository, go to **Settings → Pages** and set **Source** to `Deploy from a branch`, branch `main`, folder `/ (root)`.
3. The site appears at `https://<user>.github.io/<repo>/`.

**After changing any CSS or JS file**, increase the `?v=` number on the `<link>` and `<script>` tags in `index.html` (for example `?v=3` to `?v=4`). GitHub Pages lets browsers cache files for 10 minutes. Without a new number, a visitor can get the new page together with old cached scripts, and new buttons then silently do nothing.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout |
| `css/app.css` | Application UI |
| `css/script.css` | Script page formatting (screen and print) |
| `js/formats.js` | Script types, elements, page estimates, helpers |
| `js/catalog.js` | Catalog categories, the form for each category, links between items |
| `js/storyline.js` | Storyline chart: data, layout, script sync, SVG drawing |
| `js/formats-io.js` | Fountain, Final Draft and Celtx import/export |
| `js/editor.js` | The script editor |
| `js/app.js` | Project, views, files, dialogs |
