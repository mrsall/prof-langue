declare module "espeak-ng" {
  /** Instance Emscripten d'eSpeak NG lancée comme une ligne de commande. */
  type ESpeakModule = {
    FS: { readFile: (path: string, options: { encoding: "utf8" }) => string };
  };
  type ESpeakOptions = {
    arguments: string[];
    print?: (line: string) => void;
    printErr?: (line: string) => void;
  };
  const ESpeakNg: (options: ESpeakOptions) => Promise<ESpeakModule>;
  export default ESpeakNg;
}
