import fetch from 'petitio';
import { EventEmitter } from "events";
import { Structures } from "../Structures";

import type { LoadTracksResponse } from "../../types";
import type WebSocket from "ws";

import type { Socket, SocketData } from "./Socket";
import type { Plugin } from "./Plugin";
import type { Player } from "./Player";

const defaults = {
  resuming: {
    key: Math.random().toString(32),
    timeout: 60000,
  },
  send:()=>{throw new Error("Please Provide Send Function")},
  auto_fallback_socket: true,
  reconnect: {
    auto: true,
    delay: 15000,
    maxTries: 5,
  },
  shards: 1,
} as ManagerOptions;

export class Manager extends EventEmitter {
  /**
   * A map of connected sockets.
   */
  readonly sockets: Map<string, Socket>;

  /**
   * A map of connected players.
   */
  readonly players: Map<string, Player>;

  /**
   * The options this manager was created with.
   */
  options: Required<ManagerOptions>;

  /**
   * The client's user id.
   */
  userId: string | undefined;

  /**
   * A send method for sending voice state updates to discord.
   */
  send: Send;

  /**
   * Resume options.
   */
  resuming: ResumeOptions;

  /**
   * An array of registered plugins.
   */
  private plugins: Plugin[] = [];

  /**
   * The array of socket data this manager was created with.
   */
  private readonly nodes: SocketData[];

  /**
   * @param nodes An array of sockets to connect to.
   * @param options
   */
  constructor(nodes: SocketData[], options: ManagerOptions) {
    super();

    options = Object.assign(defaults, options);

    this.sockets = new Map();
    this.players = new Map();
    this.nodes = nodes;

    this.options = options as Required<ManagerOptions>;
    this.userId = options.userId;
    this.send = options.send;
    this.resuming = (typeof options.resuming === "boolean"
      ? !options.resuming ? null : defaults.resuming
      : options.resuming ?? defaults.resuming) as ResumeOptions;

    if (!options.send || typeof options.send !== "function") {
      throw new TypeError("Please provide a send function for sending packets to discord.");
    }

    if (this.options.shards! < 1) {
      throw new TypeError("Shard count must be 1 or greater.");
    }

    if (options.plugins && options.plugins.length) {
      for (const plugin of options.plugins) {
        this.plugins.push(plugin);
        plugin.load(this);
      }
    }
    if(this.options.auto_fallback_socket){
      this.on("socketClose",(_,socket)=>this.fallback(socket))
    }
    
  }

  /**
   * Ideal nodes to use.
   */
  get ideal(): Socket[] {
    return [...this.sockets.values()].filter(s=>s.status==0).sort((a, b) => a.penalties - b.penalties)||[];
  }
  
  /**
   * Fallback player to other Fresh new Socket
   * @param socket Socket
   */
  fallback(socket: Socket): void {
    let manager = this
    this.players.forEach(async p=>{
      if(p.socket.id==socket.id){

        if(!p.channel) return this.players.delete(p.guild)//if channel is not exist delete this player
        let position = Math.max(p.position,0);
        let startfind = new Date().getTime();

        /**
         * Find New Fresh Socket
         */
        async function find_socket() {
          if(!manager.ideal[0]) return setTimeout(find_socket, 1000);
          let found_time = new Date().getTime();
          let offset = (found_time-startfind)+1000;
          await p.move(manager.ideal[0])
          await p.send("voiceUpdate", {
            sessionId: p._sessionId,
            event: p._server,
          });
          p.filters.apply()
          if(p.track) p.play(p.track,{startTime:position+offset})
        }

        find_socket()
      }
    })
  }
  /**
   * Initializes this manager. Connects all provided sockets.
   * @param userId The client user id.
   * @since 1.0.0
   */
  init(userId: string = this.userId!): void {
    if (!userId) {
      throw new Error("Provide a client id for lavalink to use.");
    } else {
      this.userId = userId;
    }

    for (const plugin of this.plugins) {
      plugin.init();
    }

    for (const s of this.nodes) {
      if (!this.sockets.has(s.id)) {
        const socket = new (Structures.get("socket"))(this, s);

        try {
          socket.connect();
          this.sockets.set(s.id, socket);
        } catch (e) {
          this.emit("socketError", e, socket);
        }
      }
    }
  }

  /**
   * Register a plugin for use.
   * @param plugin
   * @since 2.x.x
   */
  use(plugin: Plugin): Manager {
    plugin.load(this);
    this.plugins = this.plugins.concat([ plugin ]);
    return this;
  }

  /**
   * Used for providing voice server updates to lavalink.
   * @param update The voice server update sent by Discord.
   * @since 1.0.0
   */
  async serverUpdate(update: DiscordVoiceServer): Promise<void> {
    const player = this.players.get(update.guild_id);
    if (player) {
      await player.handleVoiceUpdate(update);
    }

    return;
  }

  /**
   * Used for providing voice state updates to lavalink
   * @param update The voice state update sent by Discord.
   * @since 1.0.0
   */
  async stateUpdate(update: DiscordVoiceState): Promise<void> {
    const player = this.players.get(update.guild_id);
    if (player && update.user_id === this.userId) {
      if (update.channel_id !== player.channel) {
        player.emit("move", update.channel_id);
        player.channel = update.channel_id!;
      }

      await player.handleVoiceUpdate(update);
    }
  }

  /**
   * Create a player.
   * @param guild The guild this player is for.
   * @param socket The socket to use.
   * @since 2.1.0
   */
  create(guild: string | Dictionary, socket: Socket = this.ideal[0]): Player {
    const id = typeof guild === "string" ? guild : guild.id,
      existing = this.players.get(id);

    if (existing) {
      return existing;
    }

    if (!socket) {
      throw new Error("Manager#create(): No available nodes.");
    }

    const player = new (Structures.get("player"))(socket, id);
    this.players.set(id, player);

    return player;
  }

  /**
   * Destroys a player and leaves the connected voice channel.
   * @param guild The guild id of the player to destroy.
   * @since 2.1.0
   */
  async destroy(guild: string | Dictionary): Promise<boolean> {
    const id = typeof guild === "string" ? guild : guild.id;
    const player = this.players.get(id);

    if (player) {
      await player.destroy(true);
      return this.players.delete(id);
    } else {
      return false;
    }
  }

  /**
   * Search lavalink for songs.
   * @param query The search query.
   */
  async search(query: string): Promise<LoadTracksResponse> {
    const socket = this.ideal[0];
    if (!socket) {
      throw new Error("Manager#create(): No available sockets.");
    }

    return fetch(`http${socket.secure ? "s" : ""}://${socket.address}/loadtracks?identifier=${encodeURIComponent(query)}`)
      .header('authorization', socket.password)
      .json<LoadTracksResponse>();    
  }
}

export type Send = (guildId: string, payload: any) => any;

export type Dictionary<V = any> = Record<string, V>;

export interface Manager {
  /**
   * Emitted when a lavalink socket is ready.
   */
  on(event: "socketReady", listener: (socket: Socket) => any): this;

  /**
   * Emitted when a lavalink socket has ran into an error.
   */
  on(event: "socketError", listener: (error: any, socket: Socket) => any): this;

  /**
   * Emitted when a lavalink socket has been closed.
   */
  on(event: "socketClose", listener: (event: WebSocket.CloseEvent|WebSocket.ErrorEvent, socket: Socket) => any): this;

  /**
   * Emitted when a lavalink socket has ran out of reconnect tries.
   */
  on(event: "socketDisconnect", listener: (socket: Socket) => any): this;
}

export interface ManagerOptions {
  /**
   * A method used for sending discord voice updates.
   */
  send: Send;


  /**
   * Fallback Socket if socket die on playing
   */
  auto_fallback_socket?: Boolean;
  
  /**
   * The number of shards the client has.
   */
  shards?: number;

  /**
   * The user id of the bot (not-recommended, provide it in Manager#init)
   */
  userId?: string;

  /**
   * An array of plugins you want to use.
   */
  plugins?: Plugin[];

  /**
   * If you want to enable resuming.
   */
  resuming?: ResumeOptions | boolean;

  /**
   * Options for reconnection.
   */
  reconnect?: ReconnectOptions;
}

export interface ReconnectOptions {
  /**
   * The total amount of reconnect tries
   */
  maxTries?: number;

  /**
   * Whether or not reconnection's are automatically done.
   */
  auto?: boolean;

  /**
   * The delay between socket reconnection's.
   */
  delay?: number;
}

export interface ResumeOptions {
  /**
   * The resume timeout.
   */
  timeout?: number;

  /**
   * The resume key to use. If omitted a random one will be assigned.
   */
  key?: string;
}

/**
 * @internal
 */
export interface DiscordVoiceServer {
  token: string;
  guild_id: string;
  endpoint: string;
}

/**
 * @internal
 */
export interface DiscordVoiceState {
  channel_id?: string;
  guild_id: string;
  user_id: string;
  session_id: string;
}
