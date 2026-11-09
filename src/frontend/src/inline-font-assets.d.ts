/** Vite ?inline embeds the licensed TTF as a data URI in the lazy PDF chunk. */
declare module "*?inline" {
  const dataUri: string;
  export default dataUri;
}
