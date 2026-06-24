/**
 * Tests BC-01 a BC-05: BarcodeScanner — fallback ZXing en Chrome desktop
 * REGRESIÓN: antes del fix, el escáner mostraba "Tu navegador no soporta…" en
 * Chrome desktop estable porque BarcodeDetector no está disponible sin flags.
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks de UI ───────────────────────────────────────────────────────────────

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

// ── Mock @zxing/browser ───────────────────────────────────────────────────────

const mockStop = jest.fn();
const mockDecodeFromStream = jest.fn().mockResolvedValue({ stop: mockStop });
const MockBrowserMultiFormatReader = jest.fn().mockImplementation(() => ({
  decodeFromStream: mockDecodeFromStream,
}));

jest.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: MockBrowserMultiFormatReader,
}));

// ── Mock navigator.mediaDevices ───────────────────────────────────────────────

const mockTrackStop = jest.fn();
const mockStream = { getTracks: () => [{ stop: mockTrackStop }] } as unknown as MediaStream;

function setupMediaDevices(grant = true) {
  Object.defineProperty(global.navigator, "mediaDevices", {
    value: {
      getUserMedia: grant
        ? jest.fn().mockResolvedValue(mockStream)
        : jest.fn().mockRejectedValue(new Error("Permission denied")),
    },
    writable: true,
    configurable: true,
  });
}

// ── Mock HTMLVideoElement.play ────────────────────────────────────────────────

HTMLVideoElement.prototype.play = jest.fn().mockResolvedValue(undefined);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// ── Import después de mocks ───────────────────────────────────────────────────

import BarcodeScanner from "@/app/(app)/pos/components/BarcodeScanner";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BarcodeScanner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Por defecto: sin BarcodeDetector nativo (Chrome desktop estable)
    delete (window as Window & { BarcodeDetector?: unknown }).BarcodeDetector;
    setupMediaDevices(true);
    // Silenciar el requestAnimationFrame noise en jsdom
    jest.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // BC-01: REGRESIÓN — en Chrome desktop (sin BarcodeDetector) debe mostrar el
  // video, NO el mensaje de error de compatibilidad.
  it("BC-01: sin BarcodeDetector nativo muestra el video (no el error de compatibilidad)", async () => {
    render(
      <BarcodeScanner onDetected={jest.fn()} onClose={jest.fn()} />,
      { wrapper: makeWrapper() }
    );

    await waitFor(() => {
      expect(screen.queryByText(/no soporta/i)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Apunta la cámara/i)).toBeInTheDocument();
  });

  // BC-02: sin BarcodeDetector nativo, debe inicializar el lector ZXing como fallback.
  it("BC-02: sin BarcodeDetector nativo, inicializa BrowserMultiFormatReader como fallback", async () => {
    render(
      <BarcodeScanner onDetected={jest.fn()} onClose={jest.fn()} />,
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(MockBrowserMultiFormatReader).toHaveBeenCalled());
    expect(mockDecodeFromStream).toHaveBeenCalledWith(
      mockStream,
      expect.any(HTMLVideoElement),
      expect.any(Function)
    );
  });

  // BC-03: cuando ZXing detecta un código, llama onDetected con el valor.
  it("BC-03: onDetected se llama con el valor del código al detectarlo vía ZXing", async () => {
    const onDetected = jest.fn();
    let capturedCallback: ((result: { getText: () => string } | null) => void) | null = null;

    mockDecodeFromStream.mockImplementation(
      (_stream: MediaStream, _video: HTMLVideoElement, cb: (r: { getText: () => string } | null) => void) => {
        capturedCallback = cb;
        return Promise.resolve({ stop: mockStop });
      }
    );

    render(
      <BarcodeScanner onDetected={onDetected} onClose={jest.fn()} />,
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(capturedCallback).not.toBeNull());

    act(() => {
      capturedCallback!({ getText: () => "7501055300548" });
    });

    expect(onDetected).toHaveBeenCalledWith("7501055300548");
  });

  // BC-04: si getUserMedia falla (cámara denegada), muestra el error de cámara.
  it("BC-04: getUserMedia denegado muestra mensaje de error de cámara", async () => {
    setupMediaDevices(false);

    render(
      <BarcodeScanner onDetected={jest.fn()} onClose={jest.fn()} />,
      { wrapper: makeWrapper() }
    );

    await waitFor(() =>
      expect(screen.getByText("No se pudo acceder a la cámara.")).toBeInTheDocument()
    );
  });

  // BC-05: cuando BarcodeDetector nativo SÍ está disponible, se usa la ruta nativa
  // (ZXing no se inicializa).
  it("BC-05: con BarcodeDetector nativo disponible, no inicializa ZXing", async () => {
    const mockDetect = jest.fn().mockResolvedValue([]);
    (window as Window & { BarcodeDetector?: unknown }).BarcodeDetector = jest
      .fn()
      .mockImplementation(() => ({ detect: mockDetect }));

    render(
      <BarcodeScanner onDetected={jest.fn()} onClose={jest.fn()} />,
      { wrapper: makeWrapper() }
    );

    // Dar tiempo para que se ejecute el efecto
    await waitFor(() => expect(HTMLVideoElement.prototype.play).toHaveBeenCalled());

    expect(MockBrowserMultiFormatReader).not.toHaveBeenCalled();
  });
});
