// `server-only` is resolved by the Next.js bundler, not installed as a package,
// so it can't be imported under vitest. It's a build-time marker with no runtime
// behaviour — aliasing it to this empty module lets unit tests import pure
// helpers that happen to live in server-only files.
export {};
