// Runs before `npm start` and `npm run dev`.
//
// Vite 8 needs Node 22.12 or newer, or 20.19 or newer on the 20 line. On an older
// Node the server dies on an import error that never mentions Node, so say it
// plainly here instead. Plain syntax on purpose: this file has to run on the
// old versions it is checking for.

var parts = process.versions.node.split(".").map(Number);
var major = parts[0];
var minor = parts[1];
var ok = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22;

if (!ok) {
  console.error(
    [
      "",
      "  quickmock needs Node 22.12 or newer, or 20.19 or newer on the 20 line.",
      "  This shell is running Node " + process.versions.node + ".",
      "",
      "  Switch to a newer Node, then run npm install and npm start again.",
      "  With nvm, for example:  nvm install 22 && nvm use 22",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
