# INDUSTRY FEATURE ROADMAP
## FlowMetrics Fluid Tester - Path to an Industry-Grade Diagnostic Station

**Scope of this document:** Discovery only. No source files, configs, or tests were modified.
All conclusions are grounded in the current codebase (`web/src/**`, `firmware/esp32/main.ino`,
`.github/workflows/ci.yml`, `tools/mock_esp32.cjs`) as of commit `03bb799`.

---

## 1. EXECUTIVE EVALUATION

### 1.1 What FlowMetrics already gets right (from an automotive engineering view)

| Strength | Evidence |
| --- | --- |
| **Honest-data contract** | `NO_DATA` / `hasError` are first-class states (types/fluid.ts:12-14, results-mapper.ts:53-88). The UI never invents a fake reading - a serious trust factor for a workshop tool. |
| **Closed status enum with safety colors** | LCD human strings ("EXCELLENT", "GOOD/SVC DUE", "WATER DETECT", "EMPTY TUBE/ERR") survive into the web layer via `rawStatus` and map to green/yellow/red/gray (status-colors.ts:93-124). This is exactly the mental model a mechanic already has from the LCD. |
| **Live streaming with integrity watchdogs** | 500 ms snapshot ticks + 1 s heartbeats (main.ino:90-97) vs. a 15 s browser staleness watchdog (`useFluidStream`) - the UI distinguishes "device alive, no change" from "socket dead", which most hobby IoT dashboards do not. |
| **Offline-first architecture** | 100% of UI served from LittleFS SoftAP, single-pager with a deferred PDF chunk (398.70 kB separate; app JS is 85.46 kB raw / ~26 kB gzip at build time). No cloud calls anywhere in `web/src/lib/api.ts` - the base URL is derived from `window.location`, i.e. the device itself. |
| **Disciplined test bed** | 154 tests across 13 suites, contract tests pin the firmware JSON field order (esp32-engine-firmware.test.ts), and the PDF pipeline is composition-locked behind `canGenerateReport` / `generateReport` with mocked side effects in integration tests. This makes additive evolution genuinely low-risk. |
| **Deterministic single-writer measurement semantics** | The firmware keeps one measurement state machine (main.ino:76-120); every connected browser sees the same session. For a bench tool where one device = one probe, "everyone sees the bench" is actually the correct model. |

### 1.2 Commercial / capability gaps (why it is not yet an industry-grade station)

1. **Amnesia.** Nothing is persisted. Closing the tab destroys the session; a mechanic cannot answer "what was this truck's moisture reading at 25,000 km?" - the single most valuable question in preventive maintenance.
2. **One-size-fits-all thresholds.** `getOilStatus()` (main.ino:751-757) and `getBrakeStatusFromMoisture()` (main.ino:682-693) hardcode a single cutoff set. Real workshops deal with DOT 3 vs DOT 4 brake fluid (2% vs 3% moisture concern thresholds, depending on standard quoted) and mineral vs synthetic oils whose dielectric signatures differ measurably.
3. **No calibration story.** The raw-to-pF conversion (main.ino:59-61, 228, 247) uses two flashed constants (`refRaw`, `refPF`) with no tare for probe-in-air drift, probe aging, or ambient humidity. An uncalibrated dielectric of "2.28" vs "2.31" flips a vehicle between "GOOD/SVC DUE" and "CRITICAL" - the bands are 0.05 wide.
4. **Measurement quality is invisible.** The 20-sample buffer is averaged (main.ino:225-234) and the standard deviation is discarded. A dirty probe, unseated connector, or oxidized pins shows up as widened variance long before it shows up as a wrong average - the perfect cheap health signal, currently thrown away.
5. **Data leaves nowhere.** The PDF customer copy is excellent, but fleet operators ingest CSV/JSON into maintenance spreadsheets; there is no machine-readable session export. Notably, `webBrakeResistance` is parsed and shown on the LCD (main.ino:583, 619, 643) but **never emitted in `buildResultsJson()`** - parsed data is being dropped at the wire.
6. **No device vitals.** No uptime, VCC/battery, or firmware version on the wire; field units are impossible to triage remotely or even diagnose during a bench visit.
7. **No workshop ergonomics depth.** No technician notes, no visual inspection codes (oil color/odor/level), nothing anchoring the report to the human context that makes the measurement actionable.

**Verdict:** the platform is an excellent *measurement viewer*. The gap to an *industry-grade diagnostic station* is persistence, configurability, calibration, and data egress - all achievable in pure additive layers with the existing bundle budget.

### 1.3 Bundle budget reality check

| Asset | Current size | Budget | Headroom |
| --- | --- | --- | --- |
| App JS (`index-*.js`) | 85.46 kB raw / **~26 kB gzip** | 120 kB gzip core | **~94 kB gzip** |
| PDF chunk (`pdf-*.js`, lazy-loaded) | 398.70 kB raw (separate file, only fetched on print click) | excluded from core budget | n/a (already isolated) |
| React vendor chunk | 142.07 kB raw (~45 kB gzip) | counted within core | shared |

Measured with `npm run build` (esbuild minify, manualChunks in `vite.config.ts:30-34`). Every feature proposed below fits within the ~94 kB gzip headroom with no new runtime dependencies; the only "new dependency" widely considered (PWA) is a hand-rolled ~60-line service worker, not `workbox`.

---

## 2. PRIORITIZED FEATURE MATRIX

Complexity/risk assumed **additive-with-contract-tests** posture. Bundle deltas are gzip estimates of hand-written code, no new runtime deps.

| # | Feature | Workshop value | Footprint (web / fw) | Bundle delta (gzip) | Risk | Complexity |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | **Fluid Threshold Profiles** (DOT 3 / DOT 4 / Synthetic / Semi-Syn / Mineral) | Same physical reading graded per vehicle spec sheet; matches how shops actually quote fluid condition | UI: profile registry + evaluator + form selector. FW: none (advisory re-evaluation only) | ~4 kB | LOW (pure additive, does not touch firmware status) | LOW-MED |
| F2 | **Zero-Point Air Calibration Wizard** | Comp restores measurement trust after probe swap/cleaning; kills the biggest accuracy complaint in capacitive probes | UI: 3-step wizard. FW: tare global + NVS persist + one WS/HTTP command | ~5 kB UI, ~1.5 kB flash heap | MED (needs firmware command channel + graceful fallback) | MED |
| F3 | **Sensor Noise Index & Live Sparkline** | "Probe is dirty/unseated" alert *before* a wrong grade is issued; visible acquisition stability | FW: compute std-dev of the existing 20-sample loop. UI: SVG sparkline (zero deps) | ~3 kB | LOW (existing samples reused) | LOW |
| F4 | **IndexedDB Vehicle History & Trends** | Degradation across service intervals per vehicle - the core preventive-maintenance loop | UI only: storage lib + history drawer + trend strip | ~9 kB | LOW (browser-native API, no new deps) | MED |
| F5 | **CSV / JSON Session Export** | Fleet-maintenance-spreadsheet ingest; audit trails | UI only: Blob + `URL.createObjectURL` serializers | ~2 kB | LOW | LOW |
| F6 | **Technician Inspection Checklist & Notes in PDF** | Anchors sensor data to human observation (color/odor/level) - the two evidence streams expert mechanics rely on | UI: structured checklist model + form integration. PDF: `generateReport` extension | ~4 kB | MED (touches the protected PDF pipeline - extend, never rewrite) | MED |
| F7 | **PWA Offline Install Manifest** | Tablet/phone installs the service tool from the SoftAP page and keeps it pinned offline | UI: `manifest.webmanifest` + hand-rolled SW (precache app shell) | ~5 kB code (cached assets are flash, not heap) | LOW (must not break SoftAP hard-reload quirks) | LOW |
| F8 | **Device Vitals & Brake Resistance on the wire** | Field triage (uptime, VCC, fw version) + stop dropping the already-parsed brake resistance | FW: 3 additive JSON fields + ADC read. UI: tiny footer strip | <1 kB | LOW (additive fields appended at object end) | LOW |

**Priority order for implementation:** F8 -> F3 -> F1 -> F5 -> F4 -> F2 -> F6 -> F7. (F8 and F3 are near-free; F1/F5 are pure-UI quick wins; F4 is the flagship productivity feature; F2/F6 carry integration risk worth their own phases; F7 last because it interacts with caching/build mechanics.)

---

## 3. TECHNICAL DEEP-DIVE - TOP 3 RECOMMENDATIONS

### 3.1 F2 - Zero-Point Air Calibration Wizard (highest trust impact)

**Workshop flow:** "With the probe out of the fluid, press Calibrate Zero -> device captures 40 samples in air -> stores a tare offset -> all subsequent pF/dielectric math subtracts it." Optionally a second reference step in known-good new oil for a 2-point calibration later (v1 = air tare only).

**Firmware (main.ino additive):**

- New global + NVS persistence using `Preferences` (`nvs_flash` is already linked by the WiFi stack, zero extra flash cost):
  ```cpp
  #include <Preferences.h>
  Preferences calPrefs;                 // namespace "flowmetrics"
  double airTarePF   = 0.0;             // pF measured in air, subtracted from avgCapacitance
  double airTareEr   = 0.0;             // dielectric offset preferred (see formula shift below)
  bool   calValid    = false;           // false -> tare treated as 0, behavior identical to today
  ```
- Math placement decision: tare the **dielectric result**, not the capacitance, so the pF display stays physical:
  ```cpp
  double dielectricConstant = 1.0 + ((avgCapacitance - 3.65) / 0.875);
  if (calValid) dielectricConstant -= airTareEr;   // additive line after main.ino:247
  ```
  Rationale: in air the ideal dielectric is 1.000 by definition; a directly observed drift `deltaEr` is self-describing and survives the capacitance-to-dielectric formula being retuned later.
- Calibration routine (~40 samples, no `delay()` blocking of the loop):
  reuse the existing sampling block (main.ino:225-234) inside a small state machine `calState` (IDLE -> SAMPLING in air -> DONE), triggered by a WS/HTTP command; mid-calibration an operator can only watch progress via WS frames.
- Command channel (both surfaces, so the LCD-less headless bench also works):
  - WS text frame UI->device (the socket already accepts inbound frames and logs them at main.ino:332-341): `{"cmd":"cal_zero"}` / `{"cmd":"cal_cancel"}` - extend `handleWsEvent` with a tiny dispatcher (~15 lines).
  - HTTP: `POST /api/cal` with the same JSON body (AsyncWebServer already has body support in handler lambdas).
- Response frames device->UI (new `WsFrame` variant, additive to the union in types/fluid.ts:72-77):
  `{"kind":"cal_progress","samples":n,"total":40}` and `{"kind":"cal_done","airDielectric":1.023,"appliedEr":0.023}`.
- NVS commit happens **once** at DONE, never per-tick (LittleFS/NVS endurance), and `cal_valid=false` snapshots are retained for 5 minutes of "revert" capability.

**Web (additive):**

```ts
// web/src/types/calibration.ts (new file)
export interface CalibrationState {
  step: 'idle' | 'guide' | 'sampling' | 'done' | 'failed'
  samples: number
  total: number
  airDielectric: number | null
  appliedOffset: number | null
  lastCalibratedAt: number | null   // epoch ms; surfaced as "calibrated 2h ago"
  firmwareAware: boolean            // false if device never answered a cal frame (backward compat)
}
```

- `web/src/hooks/useFluidCalibration.ts`: thin state reducer over the same `WebSocket` owned by `useFluidStream` - to avoid coupling the two hooks, the **ws ref is lifted into a shallow context provider (`StreamSocketContext`)** created in App.tsx; `useFluidStream` keeps working unchanged (its internal ref simply comes from context with a fallback to local ownership, preserving the 154 tests).

- UI: `web/src/components/calibration-wizard.tsx` - a full-screen glass modal with 3 cards: "1. Remove probe from fluid, keep in open air" (illustrated with a plain Tailwind/SVG probe diagram), "2. Hold still - live noise bar", "3. Confirm or discard".<GATE>Every button gets a `data-cal-*` test id mirroring the existing `btn-*` convention.</GATE>

- Failure UX mirrors the fluid-card honest-data pattern: if the calibration SD > 0.02 the wizard refuses to apply and shows "Probe unstable - clean contacts and retry" (reuses the F3 noise index).

**Tests:** contract additions in `esp32-engine-firmware.test.ts` (frame schema), one hook test, one wizard integration test with a mocked WS reusing the `MockWebSocket` instances pattern from `app-integration.test.tsx`.

---

### 3.2 F1 - Fluid Threshold Profiles (highest product-surface impact, lowest risk)

**Design principle:** firmware keeps its LCD-grade statuses untouched (it must keep serving the $2 LCD when no browser is connected). The web layer re-derives an *advisory* grade from the raw wire values using a selected profile, displayed as a second pill: `FIRMWARE: GOOD/SVC DUE - PROFILE: DOT-4 CHEMICAL: DISCARD`. Single source of truth per surface; no contract versioning headache.

```ts
// web/src/lib/fluid-profiles.ts (new file)
export type ProfileFamily = 'brake' | 'engine' | 'coolant'
export interface Range { min: number; inclusive: boolean }   // null = unbounded

export interface DielectricBand {   // engine oil, evaluated per profile
  maxDielectric: number
  grade: 'EXCELLENT' | 'GOOD' | 'SVC DUE' | 'CRITICAL' | 'WATER DETECT'
}
export interface BrakeProfile {
  moistureWarningPct: number        // e.g. DOT3: 2, DOT4: 3, DOT5.1: 3
  moistureCriticalPct: number       // e.g. DOT3: 3, DOT4: 4, DOT5.1: 4
}
export interface FluidProfile {
  id: string                        // 'dot-3' | 'dot-4' | 'dot-5.1' | 'synth-5w30' | ...
  family: ProfileFamily
  label: string                     // 'DOT 4 (Cars/LCV)'
  brake?: BrakeProfile
  engineBands?: DielectricBand[]    // synthetic oils tolerate higher starting dielectric
  notes: string                     // shown as tooltip text in the UI
}
```

- Seeded defaults ship hardcoded (a ~1 kB literal array); no network, no storage needed for v1. Optional user-edited profiles persist in the same IndexedDB store introduced by F4 (`store: 'profiles'`), keeping both features on one storage layer.

- Evaluator is pure: `evaluateAgainstProfile(raw: FluidCardModel, profile: FluidProfile): ProfileGrade | null` living beside `status-colors.ts`; the existing closed enum is untouched - profile grades map to the SAME four colors, so `FluidResultCard` only gains one optional badge prop.
- Selector UI: a segmented control inside the existing `VehicleFormCard` glass card (below the vehicle fields) - `data-testid="profile-select"`. Default selection per session: DOT 4 + Semi-Synthetic (the workshop majority), remembered in localStorage.

**Firmware:** none. **Contract:** none. **Risk:** effectively zero; the 154 tests pass untouched because every existing component prop is optional.

---

### 3.3 F4 - IndexedDB Vehicle History & Degradation Trends (flagship)

```ts
// web/src/lib/history-db.ts (new file, ~150 lines, zero deps)
export interface DiagnosticRun {
  id?: number                       // auto-increment
  vehicleNumber: string             // primary query key (verbatim, NOT lowercased - plates are case-sensitive in some states)
  date: string                      // ISO YYYY-MM-DD (reused from VehicleForm)
  kmUsage: number                   // odometer at test time
  createdAt: number                 // epoch ms wall clock
  profileId: string | null          // F1 linkage, null = unprofiled legacy run
  firmwareRaw: FluidResultsResponse // verbatim wire snapshot (rawStatus preserved!)
  cards: FluidCardModel[]           // post-mapper view model for instant replay
  noiseIndex: number | null         // F3 linkage
  notes: string                     // free-text (technician notes, F6 synergy)
  checklist?: ChecklistRecord       // F6 linkage (schema sketched in 3.3.1)
}
export interface ChecklistRecord {
  oilColor?: 'amber' | 'dark' | 'milky' | 'very-dark'
  odor?: 'none' | 'burnt' | 'fuel' | 'rancid'
  fluidLevel?: 'low' | 'adequate' | 'high'
  extraNotes?: string
}

export interface HistoryHandle {
  saveRun(run: Omit<DiagnosticRun, 'id'>): Promise<number>
  listRunsByVehicle(vehicleNumber: string): Promise<DiagnosticRun[]>
  recentRuns(limit: number): Promise<DiagnosticRun[]>     // home-screen "last 10 tests" strip
  deleteRun(id: number): Promise<void>
  exportAll(): Promise<DiagnosticRun[]>                    // powers F5 CSV/JSON export
}
```

- DB bootstrap: `indexedDB.open('flowmetrics', 1)`; object stores `runs` (keyPath `id`, autoIncrement), indexes on `vehicleNumber` and `byDate` (compound `[vehicleNumber, createdAt]` for the trend query). A version-1-only design is intentionally minimal; a `profiles` store is added in the same v1 so F1 user profiles ride the same upgrade path if desired.

- Save trigger: the natural hook point is **when the stream stops with a frozen, valid session** (the same `frozen` state that already gates `btn-print`) - one automatic save per operator decision cycle, with a toast + "Saved to vehicle history" deep link instead of silent writes. No background daemons.

- Trend strip `web/src/components/history-strip.tsx`: for `vehicleNumber`, render regressions as pure hand-rolled SVG polylines (dielectric, moisture %, pH) over kmUsage - roughly 60 lines of `path d="M x1 y1 L x2 y2..."` math, ~3 kB gipped, no chart library, honoring the zero-formatting-library guardrail. Each run is a dot with the existing color semantics (`dotHex` from `status-colors.ts`).
- Storage sizing: a run is ~1.5 kB JSON (three sensors + metadata); 10 runs/vehicle-day, 200 vehicles, 5 years stays under ~5 MB uncompressed - IndexedDB quota on a tablet/phone workshop device is orders of magnitude above this; no pruning logic needed in v1 beyond a manual purge button.
- Offline durability: IndexedDB survives tab crash and SoftAP reconnects; it is NOT shared across different tablets (document as a limitation; cross-device sync is where a CSV/JSON round-trip via F5 covers air-gapped fleet servers).

---

## 4. PHASED IMPLEMENTATION ROADMAP

### Phase 1 - Immediate quick wins (1 engineer-week, zero contract risk)

| Item | Notes |
| --- | --- |
| **F8 Device vitals + brake resistance on the wire** | Append-only fields at the END of each fluid object (pinned field order in esp32-engine-firmware.test.ts is prefix-safe): `brake_oil.resistance: string|null` (already exists as `webBrakeResistance` at main.ino:583! simply emit it), `engine_oil.sampleCount`, `engine_oil.noisePf` (F3's std-dev over main.ino:222-234), top-level `device:{ uptimeMs, vcc, fwVersion }` via `String(millis())` and an ADS-style analogRead on an unused ADC pin (or 0 sentinel if unpopulated). UI: 3 tiny text spans in the header, hidden when absent. |
| **F3 Sensor noise index** (UI side of the wire field above) | Show "SNR: STABLE (SD 0.004 pF)" chip next to the engine card when sampling; reuses the fluid-card pattern for color bands (stable/warn/noisy). |
| **F5 CSV / JSON export** | Two download buttons beside `btn-print` on the frozen print bar (`btn-export-csv`, `btn-export-json`), serializers in `web/src/lib/export.ts`, blob download ~40 lines reusing filename convention `FlowMetrics_${vehicleNumber}_${date}.csv`. |
| **P0 knowledge capture** | Document in FULL_SYSTEM_AUDIT_REPORT.md that brake resistance was already parsed but never surfaced - factual note for the audit trail while touching firmware. |

**Exit criteria:** bundle delta under 5 kB gzip; 154 tests still green; contract tests extended additively (already size-compatible since field order is pinned only for the pre-existing keys).

### Phase 2 - Diagnostic enhancement layer (2-3 engineer-weeks)

| Item | Notes |
| --- | --- |
| **F1 Fluid Threshold Profiles** | Deep-dive 3.2. Ships before F4 so history rows can stamp `profileId` from day one. |
| **F4 IndexedDB vehicle history + trend strip** | Deep-dive 3.3; save-on-frozen trigger, home-screen "last 10 tests" chip strip above the fetch card. |
| **F2 Zero-point calibration wizard** | Deep-dive 3.1. Runs behind a feature-disabled-by-default wire flag on first firmware release to de-risk: UI detects `cal_ack` absence via a `setTimeout` and shows "device firmware does not support calibration yet" honestly. |

**Exit criteria:** every new component has a test file mirroring the `app-integration.test.tsx` pattern; graceful-degradation banners verify `firmwareAware=false` paths; PDF pipeline reports still pixel-identical (PDF must not change in this phase).

### Phase 3 - Fleet & workshop productivity (3-4 engineer-weeks)

| Item | Notes |
| --- | --- |
| **F6 Technician checklist & notes into PDF** | Schema from 3.3.1 (`ChecklistRecord`). Sticky rule: `generateReport` gains ONE new optional input (`notes?: ChecklistRecord & { notes: string }`) rendered as a final autoTable block after the fluid table; `canGenerateReport` signature stays backward-compatible via an optional 3rd param. All 14 existing pdf-report tests must demonstrate zero behavioral change when the input is omitted. |
| **F4 multi-run comparison view** | Extends history-strip: "Compare" mode picks 2-5 runs and renders delta columns vs. newest run (dielectric delta in pF, moisture delta in %) in the PDF as an annex table. |
| **F7 PWA offline install manifest** | Hand-rolled `web/public/sw.js` + `manifest.webmanifest`: cache-first for app shell assets (hashed names change per release - SW must serve index.html network-first to avoid stale-shell traps on SoftAP where there's no CDN to invalidate). Register via ~10 lines in `main.tsx` guarded against non-secure-context (SoftAP runs over http - Chrome allows SW on `192.168.4.1` only if `ignore_scheme` geolocal flag is hit; must be verified in Phase-3 spike and documented honestly if Safari/iOS blocks it). |

**Bundle budget verification for the whole roadmap:** 26 kB (today) + ~4 (F1) + 5 (F2) + 3 (F3) + 9 (F4) + 2 (F5) + 4 (F6) + 5 (F7) + 1 (F8) full-featured = **~59 kB gzip** worst case if everything ships as one bundle - still less than half the 120 kB core budget, and several features (F2's wizard, F6's checklist UI, F4's drawer) are candidates for the same manualChunk treatment the PDF already enjoys if we later want a sub-40 kB first paint.

---

## 5. ANTI-BLOAT & GUARDRAIL COMPLIANCE LEDGER

| Guardrail | How this roadmap complies |
| --- | --- |
| Read-only discovery | No source/config/test files were modified; only this document was created. |
| No cloud dependencies | IndexedDB + NVS (on-flash) only; exports are Blob downloads on the device; messages between UI and firmware travel over the existing LoC HTTP/WS on the SoftAP. No DB-as-a-service, no CDN, no telemetry beacons. |
| No framework bloat | Zero new runtime dependencies across all 8 features. Visualizations are hand-rolled SVG (`<polyline>`, `<path>`); PWA is a ~60-line vanilla service worker, not Workbox; IndexedDB is the browser-native API, not Dexie. |
| Protect tested functionality | All 8 features are additive layers: no `WsFrame` variant is removed, no existing field semantics change (F8 is append-only at object end, F1 is a parallel advisory layer, F2 adds a new optional offset, F4/F5/F6 are new modules/optional inputs, F7 is build-configuration). The PDF composition lock (`manualChunks` in vite.config.ts:30-34) and all protected files (`pdf-report.ts` semantics) are untouched - F6 is the only extension point into PDF and is specified as an optional-parameter-only additive contract with the existing 14 PDF tests as the regression gate. |
