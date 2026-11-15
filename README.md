# Scriptdesk

A scriptwriting tool in the spirit of the old Celtx desktop app. It runs in the browser as a plain static site, so it works on GitHub Pages. There is no server, database or account. Your work lives in a project file on your own computer.

## Features

- **Script editor that formats as you type.** Use Enter and Tab to move between Scene Heading, Action, Character, Parenthetical, Dialogue, Transition and Shot.
- **Four script types:** Screenplay, Stage Play, Audio Play and Comic Book. Comic pages and panels are numbered automatically.
- **Autocomplete** for character names, `INT.`/`EXT.`, locations, times of day, transitions and `(V.O.)`/`(O.S.)`.
- **Project tree** that can hold several scripts plus notes documents.
- **Scene navigator** showing page-length estimates in eighths.
- **Scene panel** for each scene's synopsis, colour, notes, characters (detected automatically) and breakdown items (props, wardrobe, vehicles, effects…).
- **Master Catalog** of characters, locations, props and so on, shared by every script in the project.
- **Index cards** that you drag to reorder scenes.
- **Title page.**
- **Reports:** scene list, characters (speeches and word counts), locations, and breakdown sheets.
- **Print or save as PDF**, with standard screenplay margins and page numbers.
- **Import** `.celtx` (old Celtx desktop projects), `.fountain` and `.fdx` (Final Draft).
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

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout |
| `css/app.css` | Application UI |
| `css/script.css` | Script page formatting (screen and print) |
| `js/formats.js` | Script types, elements, page estimates, helpers |
| `js/formats-io.js` | Fountain, Final Draft and Celtx import/export |
| `js/editor.js` | The script editor |
| `js/app.js` | Project, views, files, dialogs |
