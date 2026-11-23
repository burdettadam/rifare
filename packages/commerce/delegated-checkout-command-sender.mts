import type { CommerceKernel, Scope } from './kernel.mts';
import { checkoutSnapshot } from './checkout-preview.mts';
import { DelegatedCheckoutStarts } from './delegated-checkout-starts.mts';
import type { CheckoutStartRequest } from './delegated-checkout-starts.mts';
import { DelegatedCommandClaims } from './delegated-command-claims.mts';
import type { CommandClaimView } from './delegated-command-claims.mts';
import { commandCorrelation } from './delegated-command-claim-records.mts';
import type { CommandCorrelation } from './delegated-command-claim-records.mts';
import { InternalDelegatedUseClient } from '../adapters/delegated-commands/internal-use-client.mts';
import { encodeDelegatedCommand } from '../adapters/delegated-commands/command-codec.mts';
import type { EncodedDelegatedCommand } from '../adapters/delegated-commands/command-codec.mts';

export type CommandSenderConfiguration = Readonly<{
  correlation: CommandCorrelation; starts?: DelegatedCheckoutStarts; transport: InternalDelegatedUseClient;
}>;
export type CommandSenderCode = 'COMMAND_SENDER_CONFIG_INVALID' | 'COMMAND_SENDER_UNAVAILABLE'
  | 'COMMAND_SENDER_INPUT_INVALID' | 'COMMAND_SENDER_ORIGINAL_CHANGED' | 'COMMAND_SENDER_TRANSACTION_OWNERSHIP';
export class CommandSenderDenied extends Error {
  readonly code: CommandSenderCode;
  constructor(code: CommandSenderCode) { super(code); this.code = code; this.name = 'CommandSenderDenied'; }
}
function fail(code: CommandSenderCode): never { throw new CommandSenderDenied(code); }
function configuration(input: unknown): CommandSenderConfiguration {
  try {
    if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
      fail('COMMAND_SENDER_CONFIG_INVALID');
    const keys = Reflect.ownKeys(input), result: Record<string, unknown> = Object.create(null);
    if (!keys.includes('correlation') || !keys.includes('transport') ||
      keys.some(key => !['correlation', 'starts', 'transport'].includes(key as string))) fail('COMMAND_SENDER_CONFIG_INVALID');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
      if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) fail('COMMAND_SENDER_CONFIG_INVALID');
      result[key as string] = descriptor.value;
    }
    return result as CommandSenderConfiguration;
  } catch { fail('COMMAND_SENDER_CONFIG_INVALID'); }
}

/** Native journal/source composition for the explicitly configured internal
 * machine profile. The journal remains the sole durable lifecycle owner. A
 * failed or uncertain START consumes local admission; only explicit recovery
 * is available for every preexisting original, including unsent C4 claims. */
export class DelegatedCheckoutCommandSender {
  readonly #kernel: CommerceKernel;
  readonly #hasStarts: boolean;
  readonly #claim: DelegatedCommandClaims['claimNewCheckoutStart'];
  readonly #current: DelegatedCommandClaims['currentCheckoutStart'];
  readonly #read: DelegatedCommandClaims['read'];
  readonly #recovery: DelegatedCommandClaims['recovery'];
  readonly #observe: DelegatedCommandClaims['observe'];
  readonly #start: InternalDelegatedUseClient['start'];
  readonly #recover: InternalDelegatedUseClient['recover'];
  #closed = false;

  constructor(kernel: CommerceKernel, input: CommandSenderConfiguration) {
    try {
      const config = configuration(input), correlation = commandCorrelation(config.correlation);
      if (!(config.transport instanceof InternalDelegatedUseClient) ||
        !InternalDelegatedUseClient.prototype.boundTo.call(config.transport, correlation)) fail('COMMAND_SENDER_CONFIG_INVALID');
      if (config.starts !== undefined && (!(config.starts instanceof DelegatedCheckoutStarts) ||
        !DelegatedCheckoutStarts.prototype.boundTo.call(config.starts, kernel))) fail('COMMAND_SENDER_CONFIG_INVALID');
      const claims = new DelegatedCommandClaims(kernel, correlation, config.starts);
      this.#kernel = kernel; this.#hasStarts = config.starts !== undefined;
      this.#claim = DelegatedCommandClaims.prototype.claimNewCheckoutStart.bind(claims);
      this.#current = DelegatedCommandClaims.prototype.currentCheckoutStart.bind(claims);
      this.#read = DelegatedCommandClaims.prototype.read.bind(claims);
      this.#recovery = DelegatedCommandClaims.prototype.recovery.bind(claims);
      this.#observe = DelegatedCommandClaims.prototype.observe.bind(claims);
      this.#start = InternalDelegatedUseClient.prototype.start.bind(config.transport);
      this.#recover = InternalDelegatedUseClient.prototype.recover.bind(config.transport);
    } catch { fail('COMMAND_SENDER_CONFIG_INVALID'); }
  }
  /** Injected source/transport owners retain their own lifetimes. Closing this
   * sender makes pending guards/observations fail, without closing shared owners. */
  close(): void { this.#closed = true; }
  #available(): void { if (this.#closed) fail('COMMAND_SENDER_UNAVAILABLE'); }
  #outside(): void {
    if (this.#kernel.db.isTransaction) fail('COMMAND_SENDER_TRANSACTION_OWNERSHIP');
  }
  #original(view: CommandClaimView): EncodedDelegatedCommand {
    if (view.retired || view.minimized || view.state === 'cancelled' || view.canonical_request === null ||
      view.command_kind !== 'START_USE') fail('COMMAND_SENDER_UNAVAILABLE');
    try {
      const encoded = encodeDelegatedCommand(Buffer.from(view.canonical_request));
      if (encoded.request.command !== 'START_USE' || encoded.canonical_json !== view.canonical_request ||
        encoded.original_command_id !== view.original_command_id || encoded.command_digest !== view.command_digest)
        fail('COMMAND_SENDER_ORIGINAL_CHANGED');
      return encoded;
    } catch { fail('COMMAND_SENDER_ORIGINAL_CHANGED'); }
  }
  #sameOriginal(first: CommandClaimView, current: CommandClaimView): void {
    if (current.claim_id !== first.claim_id || current.original_command_id !== first.original_command_id ||
      current.namespace_digest !== first.namespace_digest || current.command_kind !== first.command_kind ||
      current.command_digest !== first.command_digest || current.canonical_request !== first.canonical_request ||
      current.created_at !== first.created_at) fail('COMMAND_SENDER_ORIGINAL_CHANGED');
    this.#original(current);
  }
  #fresh(view: CommandClaimView): void {
    if (view.state !== 'claimed' || view.revision !== 1 || view.retired || view.minimized || view.response !== null ||
      view.observed_at !== null || view.updated_at !== view.created_at) fail('COMMAND_SENDER_ORIGINAL_CHANGED');
  }
  async start(scope: Scope, input: CheckoutStartRequest): Promise<CommandClaimView> {
    this.#available(); this.#outside();
    if (!this.#hasStarts) fail('COMMAND_SENDER_UNAVAILABLE');
    let selected: CheckoutStartRequest;
    try { selected = checkoutSnapshot(input); } catch { fail('COMMAND_SENDER_INPUT_INVALID'); }
    // This top-level transaction commits before the transport can connect. There
    // is deliberately no read-then-claim inference about a fresh send opportunity.
    const first = this.#claim(scope, selected), original = this.#original(first);
    this.#fresh(first); this.#available();
    const current = () => {
      this.#available(); this.#outside();
      const retained = this.#current(scope, selected);
      this.#sameOriginal(first, retained); this.#fresh(retained);
      this.#available(); this.#outside();
    };
    const bound = await this.#start(original.request, current);
    this.#available(); this.#outside();
    // The current-proof journal owner reauthorizes after awaited network work;
    // cancellation/retirement cannot be bypassed by a successful TLS response.
    return this.#observe(scope, first.original_command_id, bound.response);
  }
  async recover(scope: Scope, originalCommandId: string): Promise<CommandClaimView> {
    this.#available(); this.#outside();
    const first = this.#read(scope, originalCommandId), original = this.#original(first);
    const recovery = this.#recovery(scope, originalCommandId);
    const current = () => {
      this.#available(); this.#outside();
      const retained = this.#read(scope, originalCommandId);
      this.#sameOriginal(first, retained);
      const selected = this.#recovery(scope, originalCommandId);
      if (selected.canonical_json !== recovery.canonical_json || selected.command_digest !== original.command_digest ||
        selected.original_command_id !== original.original_command_id) fail('COMMAND_SENDER_ORIGINAL_CHANGED');
      this.#available(); this.#outside();
    };
    const bound = await this.#recover(original.request, recovery.request, current);
    this.#available(); this.#outside();
    return this.#observe(scope, originalCommandId, bound.response, { recovery: recovery.request });
  }
}
