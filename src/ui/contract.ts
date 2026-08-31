// Kontrak presentasi — satu-satunya jendela komunikasi antara lapisan UI dan
// sistem di luarnya.
//
// Aturan arah dependensi (dijaga test/ui-boundary.test.ts):
// - src/ui/ TIDAK BOLEH mengimpor cli/, src/ non-ui, atau #minicore.
// - src/ non-ui TIDAK BOLEH mengimpor src/ui/ — komunikasi lewat kontrak ini
//   dan callback yang di-inject dari cli/ (composition root).
//
// Semua event kernel dipetakan ke tipe STRUKTURAL di sini. EventBus kernel
// (#minicore) kompatibel secara struktural dengan UiBus, jadi cli/ bisa
// menyerahkan bus kernel apa adanya tanpa adapter runtime.

export interface UiToolCallRef {
  name: string
  args?: unknown
}

export interface UiStep {
  index: number
  toolCalls: readonly UiToolCallRef[]
}

export interface UiExecution {
  call: UiToolCallRef
  result: { isError?: boolean; content?: unknown }
}

/**
 * Subset event agen yang dikonsumsi lapisan presentasi. Field meniru bentuk
 * payload kernel (flat, ber-`type`) tetapi didefinisikan ulang di sini supaya
 * UI tidak pernah menyentuh tipe vendor.
 */
export type UiEvent =
  | { type: "turn:started"; turn: number }
  | { type: "turn:completed"; result?: unknown }
  | { type: "step:started"; step: UiStep }
  | { type: "step:completed"; step: UiStep }
  | { type: "execution:started"; execution: UiExecution }
  | { type: "execution:completed"; execution: UiExecution }
  | { type: "provider:text"; text: string }
  | { type: "provider:extension"; kind: string; data: unknown }
  | { type: "context:compacted"; reason: string }

export type UiEventType = UiEvent["type"]

export interface UiBus {
  on<K extends UiEventType>(
    type: K,
    handler: (event: Extract<UiEvent, { type: K }>) => void,
  ): () => void
}
