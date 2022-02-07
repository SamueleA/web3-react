import type {
  Actions,
  Provider,
  ProviderRpcError,
} from '@web3-react/types'
import { Connector } from '@web3-react/types'
import { sequence } from '0xsequence'
import { WalletProvider } from '0xsequence/dist/declarations/src/provider';

interface InjectedEthereumProvider extends Provider {
  isSequence?: boolean;
}

declare global {
  interface Window {
      ethereum?: InjectedEthereumProvider;
  }
}

export interface SequenceOptions {
  appName?: string;
}

function parseChainId(chainId: string | number) {
  if (typeof chainId === 'number') {
    return chainId
  }
  return Number.parseInt(chainId, 16)
}

export class Sequence extends Connector {
  public provider: Provider | undefined;

  private wallet?: WalletProvider
  private readonly options?: SequenceOptions

  /**
   * @param options - Options to pass to the sequence wallet
   * @param connectEagerly - A flag indicating whether connection should be initiated when the class is constructed.
   */
  constructor(actions: Actions, connectEagerly = false, options?: SequenceOptions) {
    super(actions)
    this.options = options

    if (connectEagerly) {
      this.initialize().catch(e => console.error(e));
    }
  }

  private async initialize () {
    await this.activate().catch(e => console.error(e))
  }

  private disconnectListener = (error?: ProviderRpcError): void => {
    this.actions.reportError(error)
  }

  private chainChangedListener = (chainId: number | string): void => {
    this.actions.update({ chainId: parseChainId(chainId) })
  }

  private accountsChangedListener = (accounts: string[]): void => {
    this.actions.update({ accounts })
  }

  private listenToEvents(): void {
    if (this.provider) {
      this.provider.on('disconnect', this.disconnectListener)
      this.provider.on('accountsChanged', this.accountsChangedListener)
      this.provider.on('chainChanged', this.chainChangedListener)
    }
  }

  public async activate(defaultNetwork?: string | number): Promise<void> {
    const cancelActivation = this.actions.startActivation()
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (window?.ethereum && window.ethereum.isSequence) {
      this.provider = window.ethereum;
      if (this.provider) {
        try {
          const accounts: any = await this.provider.request({ method: 'eth_requestAccounts' })
          let chainId: any = await this.provider.request({ method: 'eth_chainId' })
          chainId = parseChainId(chainId);
          this.actions.update({
            chainId: parseChainId(chainId),
            accounts: [
              accounts[0],
            ],
          })
          this.listenToEvents();
        } catch (error) {
          cancelActivation();
          this.actions.reportError(new Error("User Rejected"))
        }
        return;
      }
    }
  
    const wallet = new sequence.Wallet(defaultNetwork || 'mainnet');
  
    // disconnect prior to reconnecting to allow network switching by removing the previous connection
    wallet.disconnect();

    try {
      if (!wallet.isConnected()) {
        const connectDetails = await wallet.connect({
          app: this.options?.appName || 'app',
          authorize: true
        });
    
        if (!connectDetails.connected) {
          cancelActivation();
          this.actions.reportError(new Error("Failed to connect"))
        }
      }
    
      // The check for connection is necessary in case the user closes the popup or cancels
      if (wallet.isConnected()) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.provider = wallet.getProvider();
        const walletAddress = await wallet.getAddress()
        const chainId = await wallet.getChainId()
        this.actions.update({
          chainId: parseChainId(chainId),
          accounts: [
            walletAddress,
          ],
        })
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.provider.sequence = wallet;
        this.wallet = wallet;
        this.listenToEvents()
      }
    } catch(e) {
      cancelActivation()
      this.actions.reportError(new Error('Failed to connect'))
    }
  }

  public async deactivate(): Promise<void> {
    return (
      new Promise((resolve) => {
        this.wallet?.disconnect()
        this.wallet = undefined
        this.provider?.off('disconnect', this.disconnectListener)
        this.provider?.off('chainChanged', this.chainChangedListener)
        this.provider?.off('accountsChanged', this.accountsChangedListener)
        this.provider = undefined
        // Workaround for setting the isActive value to false upon disconnect
        this.actions.reportError(new Error('Disconnected'))
        this.actions.reportError(undefined)
        resolve();
      })
    )
  }
}
