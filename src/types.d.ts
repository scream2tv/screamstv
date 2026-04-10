declare module 'node-media-server' {
  interface NmsConfig {
    rtmp?: Record<string, any>;
    http?: Record<string, any>;
    trans?: Record<string, any>;
  }
  class NodeMediaServer {
    constructor(config: NmsConfig);
    run(): void;
    stop(): void;
    on(event: string, callback: (...args: any[]) => void): void;
    getSession(id: string): any;
  }
  export = NodeMediaServer;
}
