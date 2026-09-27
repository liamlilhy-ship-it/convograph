/// <reference types="vite/client" />

declare module '*.css?inline' {
  const css: string;
  export default css;
}

interface ImportMetaEnv {
  readonly VITE_GA_MEASUREMENT_ID?: string;
  readonly VITE_GA_API_SECRET?: string;
  readonly VITE_GA_DEBUG?: string;
}
