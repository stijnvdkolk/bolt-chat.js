import { Socket } from 'net';
import { promises as dns } from 'dns';
import { isIP } from '../util/isIp';
import { BufferManager } from '../util/BufferManager';
import { IMessage, IConfig, EventType, IJoinLeave, IError, IMotd, IBaseEvent } from '../interfaces';
import { MessageManager } from './Message/MessageManager';
import { UserManager } from './User/UserManager';

/**
 * Main Bolt class.
 */
export class Bolt {
  /**
   * Everything that has to do with a user.
   */
  public user: UserManager;

  /**
   * Everything that has to do with a message.
   */
  public message: MessageManager;

  /**
   * The socet bolt-node.js uses to talk to the server. You probably shouldn't touch this.
   */
  public connection: Socket;

  /**
   * Config you passed thru when making a new Bolt() instance.
   */
  public config: IConfig;

  /**
   * @param config Config.
   */
  constructor(config: IConfig) {
    this.config = config;
    this.connection = new Socket();
    this.message = new MessageManager(this);
    this.user = new UserManager(this);
  }

  /**
   * Connect to the bolt.chat instance.
   *
   * @param callback Callback function.
   */
  async connect(callback?: () => void): Promise<void> {
    let { host, port } = this.config;

    if (!isIP(host)) {
      const srv = await dns.resolveSrv(`_bolt._tcp.${host}`);
      const ips = await dns.resolve(srv[0].name);

      port = srv[0].port;
      [host] = ips;
    }

    await this.user.readPrivKey();
    await this.user.readPubKey();

    return await new Promise((resolve, reject) => {
      this.connection.connect(
        {
          port: port ?? 3300,
          host
        },
        () => {
          resolve();
          if (callback) callback();
        }
      );

      this.connection.on('error', reject); // TODO: check if this is valid

      const joinData: IBaseEvent<IJoinLeave> = {
        d: {
          user: {
            pubkey: this.user.pubKey.armor(),
            nick: this.config.identity.username
          }
        },
        e: {
          t: 'join',
          c: Math.round(new Date().getTime() / 1000)
        }
      };

      this.connection.write(JSON.stringify(joinData));
    });
  }

  public on(event: 'msg', callback: (data: IBaseEvent<IMessage>) => void): void;

  public on(event: 'join', callback: (data: IBaseEvent<IJoinLeave>) => void): void;

  public on(event: 'leave', callback: (data: IBaseEvent<IJoinLeave>) => void): void;

  public on(event: 'err', callback: (data: IBaseEvent<IError>) => void): void;

  public on(event: 'motd', callback: (data: IBaseEvent<IMotd>) => void): void;

  /**
   * Execute the callback if event is fired.
   *
   * @param event Event to listen to.
   * @param callback Callback function.
   */
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
  public on(event: EventType, callback: (data: any) => void): void {
    const received = new BufferManager();

    this.connection.on('data', (data) => {
      received.push(data);
      // eslint-disable-next-line no-loops/no-loops
      while (!received.isFinished()) {
        const msg = JSON.parse(received.handleData());
        if (msg.e.t !== event) return;
        callback(msg);
      }
    });
  }
}
