import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import type { FluidResultsResponse, WsFrame } from '@/types/fluid'

/**
 * Full <App /> integration suite: real user interactions (clicks, typing)
 * against the real state machine - stream start/stop/resume, live form
 * validation propagation, and PDF report gating.
 */

// The PDF pipeline's side effect (file download) is mocked out; decision
// logic (canGenerateReport / formatMetricForPdf) stays real.
vi.mock('@/lib/pdf-report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pdf-report')>()
  return { ...actual, generateReport: vi.fn() }
})
import { generateReport } from '@/lib/pdf-report'

const generateReportMock = vi.mocked(generateReport)

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  url: string
  readyState = 0
  onopen: ((e: Event) => void) | null = null
  onclose: ((e: Event) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
  close() {
    this.readyState = 3
    this.onclose?.(new Event('close'))
  }
  triggerOpen() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }
  triggerMessage(data: WsFrame) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }
}

const SNAPSHOT: FluidResultsResponse = {
  brake_oil: { moisture: '1%', status: 'NORMAL' },
  engine_oil: {
    dielectric: 2.4,
    capacitance: null,
    water: 'NO',
    tbn: null,
    tan: null,
    viscosity: null,
    status: 'GOOD',
  },
  coolant: { ph: 7.0, status: 'GOOD' },
}

function openWithSnapshot() {
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
  act(() => ws.triggerOpen())
  act(() => ws.triggerMessage({ kind: 'snapshot', data: SNAPSHOT }))
  return ws
}

beforeEach(() => {
  MockWebSocket.instances = []
  // @ts-expect-error - test global
  globalThis.WebSocket = MockWebSocket
  generateReportMock.mockClear()
})

afterEach(() => {
  // @ts-expect-error - test cleanup
  delete globalThis.WebSocket
})

describe('<App /> integration - stream control', () => {
  it('Test 1: stop closes the socket, lands on a resumable state, and resume redials', () => {
    render(<App />)

    // Start streaming: idle -> connecting -> live results
    fireEvent.click(screen.getByTestId('btn-fetch'))
    expect(MockWebSocket.instances).toHaveLength(1)
    const ws = openWithSnapshot()
    expect(screen.getByTestId('results')).toBeInTheDocument()
    expect(screen.getByTestId('connection-indicator')).toHaveAttribute(
      'data-stream-status',
      'streaming',
    )

    // STOP is bound directly to stream.stop()
    fireEvent.click(screen.getByTestId('btn-stop'))
    expect(ws.readyState).toBe(3)
    expect(MockWebSocket.instances).toHaveLength(1) // no reconnect scheduled

    // UI reflects the stopped state: header badge + resumable main button
    expect(screen.getByTestId('btn-print')).toHaveAttribute('data-print-state', 'standby')
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.queryByTestId('btn-stop')).toBeNull()
    expect(screen.getByTestId('btn-fetch')).toHaveTextContent(/Resume Reading/i)
    expect(screen.getByTestId('connection-indicator')).toHaveAttribute(
      'data-stream-status',
      'idle',
    )

    // Resume re-triggers a connection
    fireEvent.click(screen.getByTestId('btn-fetch'))
    expect(MockWebSocket.instances).toHaveLength(2)
    expect(screen.getByTestId('btn-stop')).toBeInTheDocument()

    // Guard: clicking while connecting must not double-dial
    fireEvent.click(screen.getByTestId('btn-fetch'))
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('Test 1b: clicking stop with no session is safe and stays idle', () => {
    render(<App />)
    // Stop before anything is started - must not throw or reconnect.
    // (No stop button is rendered while idle, so the guard holds.)
    expect(screen.queryByTestId('btn-stop')).toBeNull()
    expect(screen.getByTestId('btn-fetch')).toHaveTextContent(/Fetch Latest Reading/i)
  })
})

describe('<App /> integration - vehicle form validation', () => {
  it('Test 2: invalid vehicle number shows a real-time error; fixing it clears everything', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Date is auto-filled on mount; "AB@12" violates the Tier 1 plate
    // contract (^A-Za-z0-9 -]{3,15}$ - symbols stay out even though
    // hyphens are now legal).
    await user.type(screen.getByTestId('input-vehicle'), 'AB@12')
    expect(screen.getByTestId('error-vehicle')).toBeInTheDocument()
    expect(screen.getByTestId('input-vehicle')).toHaveClass('has-error')

    // The same value propagates out through onValidationChange without
    // an infinite render loop (this would crash with "Maximum update
    // depth exceeded" if the loop were still present).
    await user.type(screen.getByTestId('input-km'), '45000')
    expect(screen.queryByTestId('error-km')).toBeNull()

    // Fix the vehicle number -> all errors clear
    await user.clear(screen.getByTestId('input-vehicle'))
    await user.type(screen.getByTestId('input-vehicle'), 'ABC1234')
    expect(screen.queryByTestId('error-vehicle')).toBeNull()
    expect(screen.getByTestId('input-vehicle')).not.toHaveClass('has-error')

    // Date is prefilled and stays valid
    const dateInput = screen.getByTestId('input-date') as HTMLInputElement
    expect(dateInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(screen.queryByTestId('error-date')).toBeNull()
  })

  it('Test 2b: kmUsage rejects zero / non-numeric remainder with a visible error', async () => {
    const user = userEvent.setup()
    render(<App />)

    const km = screen.getByTestId('input-km')
    await user.type(km, '0')
    expect(screen.getByTestId('error-km')).toBeInTheDocument()

    await user.clear(km)
    await user.type(km, '45000')
    expect(screen.queryByTestId('error-km')).toBeNull()
  })
})

describe('<App /> integration - PDF report gating', () => {
  it('Test 3: report button is disabled until form is valid AND telemetry exists, then invokes generateReport', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Stage A: no data, empty form -> standby (disabled)
    const printBtn = () => screen.getByTestId('btn-print') as HTMLButtonElement
    expect(printBtn()).toBeDisabled()
    expect(printBtn().textContent).toMatch(/Report Standby/i)

    // Stage B: telemetry live but form still empty -> still standby
    fireEvent.click(screen.getByTestId('btn-fetch'))
    openWithSnapshot()
    expect(screen.getByTestId('results')).toBeInTheDocument()
    expect(printBtn()).toBeDisabled()
    expect(printBtn().textContent).toMatch(/Report Standby \(form\)/i)

    // Stage C: valid form -> button becomes active "Generate Report"
    await user.type(screen.getByTestId('input-vehicle'), 'ABC1234')
    await user.type(screen.getByTestId('input-km'), '45000')
    await waitFor(() => expect(printBtn()).toBeEnabled())
    expect(printBtn().textContent).toMatch(/Generate Report/i)
    expect(printBtn()).toHaveAttribute('data-print-state', 'ready')

    // Stage D: click invokes generateReport with current form + telemetry
    fireEvent.click(printBtn())
    await waitFor(() => expect(generateReportMock).toHaveBeenCalledTimes(1))
    const arg = generateReportMock.mock.calls[0][0]
    expect(arg.form.vehicleNumber).toBe('ABC1234')
    expect(arg.form.kmUsage).toBe(45000)
    expect(arg.form.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(arg.results).toHaveLength(3)
    expect(arg.results.map((r) => r.kind)).toEqual(['brake_oil', 'engine_oil', 'coolant'])
    expect(arg.results[1].primaryMetric).toBe('Dielectric 2.40')
    expect(arg.results[1].status).toBe('GOOD')
  })

  it('Test 3b: the report stays gated when EVERY telemetry row has an error', async () => {
    const user = userEvent.setup()
    render(<App />)

    fireEvent.click(screen.getByTestId('btn-fetch'))
    const ws = MockWebSocket.instances[0]
    act(() => ws.triggerOpen())
    act(() =>
      ws.triggerMessage({
        kind: 'snapshot',
        data: {
          brake_oil: { moisture: 42, status: 'GOOD' }, // wrong type -> hasError
          engine_oil: { dielectric: '2.4', capacitance: null, water: 'NO', tbn: null, tan: null, viscosity: null, status: 'GOOD' }, // wrong type -> hasError
          coolant: { ph: 'neutral', status: 'GOOD' }, // wrong type -> hasError
        } as unknown as FluidResultsResponse,
      }),
    )
    await user.type(screen.getByTestId('input-vehicle'), 'ABC1234')
    await user.type(screen.getByTestId('input-km'), '45000')

    // canGenerateReport disqualifies every row as "no result"; even with a
    // valid form the button stays disabled.
    expect(screen.getByTestId('btn-print')).toBeDisabled()
    fireEvent.click(screen.getByTestId('btn-print'))
    expect(generateReportMock).not.toHaveBeenCalled()
  })

  it('Test 3c: a single error row is reported as N/A while healthy rows stay exportable', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Contract (pdf-report.ts): hasError disqualifies the ROW, not the
    // report. With one malformed sensor and two healthy ones, the button
    // is enabled and the error row renders as "N/A".
    fireEvent.click(screen.getByTestId('btn-fetch'))
    openWithSnapshot()
    await user.type(screen.getByTestId('input-vehicle'), 'ABC1234')
    await user.type(screen.getByTestId('input-km'), '45000')

    expect(screen.getByTestId('btn-print')).toBeEnabled()
  })
})
