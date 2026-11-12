// The operating system Scorpion runs on: windows-control.js on Windows, linux-control.js on Linux (Scorpion OS) and mac-control.js
// on a Mac (which takes over the Mac's apps, windows, settings and controls; what a Mac has no use for stays as it was). They offer
// the same functions (apps, windows, files, settings, system controls, status), so the rest of Scorpion calls them the same way
// everywhere.
import * as windows from './windows-control.js';
import * as linux from './linux-control.js';
import * as mac from './mac-control.js';

export default process.platform === 'linux' ? linux : process.platform === 'darwin' ? { ...windows, ...mac } : windows;
