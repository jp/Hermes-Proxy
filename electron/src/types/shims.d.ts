declare module 'http-mitm-proxy' {
  export const Proxy: new () => any;
}

declare module 'node-forge' {
  const forge: any;
  export = forge;
}
