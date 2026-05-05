// Vite-specific module type shims. The reference deck uses `?raw` to
// import the .sw source as a string and direct image imports for
// assets; both are Vite built-ins.

declare module '*.sw?raw' {
  const source: string;
  export default source;
}

declare module '*.jpg' {
  const url: string;
  export default url;
}

declare module '*.png' {
  const url: string;
  export default url;
}

declare module '*.svg' {
  const url: string;
  export default url;
}
