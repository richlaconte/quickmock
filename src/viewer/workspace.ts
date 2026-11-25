// Which workspace this page is showing. The viewer lives at /w/<workspace>, and
// everything it asks the server for is under /api/w/<workspace>.

// Outside a browser (the tests draw the board without one) there is no workspace.
export const WORKSPACE = typeof window === "undefined" ? "" : (window.location.pathname.split("/")[2] ?? "");
export const API = `/api/w/${WORKSPACE}`;
