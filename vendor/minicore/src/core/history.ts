// Context storage: an append-only, transformable message buffer.
// Storage only — token policy and compaction are separate modules.

import type { Message } from "./types.ts";

/**
 * The kernel's context buffer. Append-only in normal operation; `replace` is
 * the single seam for compaction. `messages` exposes the live buffer typed as
 * read-only — mutating it via a cast would corrupt the kernel's history, so
 * treat it as immutable.
 */
export class ContextStore {
  #messages: Message[] = [];

  /** Live view of the buffer. Read-only by type; never cast and mutate. */
  get messages(): readonly Message[] {
    return this.#messages;
  }

  append(message: Message): void {
    this.#messages.push(message);
  }

  appendAll(messages: readonly Message[]): void {
    this.#messages.push(...messages);
  }

  /** Replace `deleteCount` messages starting at `start` with `replacement`. */
  replace(start: number, deleteCount: number, replacement: readonly Message[]): void {
    this.#messages.splice(start, deleteCount, ...replacement);
  }
}