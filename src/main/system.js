// The operating system Scorpion runs on: windows-control.js on Windows,
// linux-control.js on Linux (Scorpion OS). Both offer the same functions
// (apps, windows, files, settings, system controls, status), so the rest of
// Scorpion calls them the same way everywhere.
import * as windows from './windows-control.js';
import * as linux from './linux-control.js';

export default process.platform === 'linux' ? linux : windows;
