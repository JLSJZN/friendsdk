// Bundle stand-in for "react" (tools/build-preview.mjs). src/slingshot.ts defines a React hook, useSlingshot, that the
// preview page never calls; the page only uses that file's pure flight maths.
const unavailable = () => { throw new Error("React is not bundled into the preview page."); };
export const useCallback = unavailable, useRef = unavailable, useState = unavailable;
