declare module 'qrcode-terminal' {
  interface Options {
    small?: boolean;
  }
  function generate(text: string, opts?: Options, cb?: (qrcode: string) => void): void;
  export = { generate };
}
