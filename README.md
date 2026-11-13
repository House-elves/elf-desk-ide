# Elf Desk IDE

The Elf Desk as a desktop app, built on [Eclipse Theia](https://theia-ide.org). It's another way to use the desk:
the desk in your browser, the runner and the elves stay as they are, and this app talks to the same local desk.

- **Desk panel** (`Ctrl+Shift+D`): the desk itself, in its own Electron view laid over the panel. It's the page
  itself, not framed, so the desk's frame and cookie protections stay as they are. It signs in with the one-time code,
  as `house-elves open` does, and keeps its own cookie.
- **Elf Desk: Open a Session as the Workspace…**: opens a Sessions chat's clone, with its files, changes and a terminal.
- Theia's editor, file tree, search and terminal, and Source Control with diffs (VS Code's git extension, from
  Open VSX). Git works once you trust the folder, when Theia asks.
- Its settings are in `~/.elf-desk-ide`, apart from other Theia apps.

## Build and run

Needs Node 20+, and on Linux: `gcc-c++ make libsecret-devel libX11-devel libxkbfile-devel`.

```
npm install
npm run build   # also downloads the git extensions into plugins/
npm start
```

The desk has to be running (`house-elves start`).

## Installers

```
npm run package
```

builds `electron-app/dist/elf-desk-<version>-*.AppImage`, `.deb` and `.rpm` on Linux (the rpm needs `rpm-build`),
a `.dmg` on macOS and an installer `.exe` on Windows. The Build workflow makes all of them on each push to main, as
the run's artifacts. They aren't signed yet, so macOS and Windows warn before opening them.
