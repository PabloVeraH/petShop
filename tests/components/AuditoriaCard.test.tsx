/**
 * Tests C-25 a C-38: AuditoriaCard component
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mockLogs = [
  {
    id: "log-1",
    store_id: "store-abc",
    user_id: "user_abc123def456",
    action: "CREATE",
    entity_type: "producto",
    entity_id: "prod-1",
    old_values: null,
    new_values: { nombre: "Pro Plan", precio: 5000 },
    change_description: 'Producto "Pro Plan" creado',
    ip_address: "192.168.1.1",
    user_agent: "Mozilla/5.0",
    result: "success",
    error_message: null,
    created_at: "2026-05-20T10:00:00Z",
  },
  {
    id: "log-2",
    store_id: "store-abc",
    user_id: "user_xyz789ghi012",
    action: "DELETE",
    entity_type: "categoria",
    entity_id: "cat-1",
    old_values: { nombre: "Alimentos" },
    new_values: null,
    change_description: 'Categoría "Alimentos" eliminada (soft delete)',
    ip_address: "10.0.0.1",
    user_agent: "Chrome/120",
    result: "failure",
    error_message: "Constraint violation",
    created_at: "2026-05-19T15:30:00Z",
  },
];

const mockErrorLogs = [
  {
    id: "err-1",
    store_id: "store-abc",
    user_id: "user-1",
    error_code: "VENTA_FAILED",
    error_message: "Database timeout on insert",
    stack_trace: "Error at /api/ventas:42",
    context: { endpoint: "/api/ventas" },
    severity: "ERROR",
    endpoint: "/api/ventas",
    ip_address: "10.0.0.1",
    resolved: false,
    resolved_at: null,
    resolved_by: null,
    created_at: "2026-05-20T10:00:00Z",
  },
];

const mockSessions = [
  {
    id: "sess-1",
    store_id: "store-abc",
    user_id: "user_abc123",
    clerk_session_id: "sess_clerk_1",
    event_type: "session.created",
    ip_address: "192.168.1.1",
    user_agent: "Mozilla/5.0",
    created_at: "2026-05-20T10:00:00Z",
  },
];

const mockFetch = jest.fn();

jest.mock("@clerk/nextjs", () => ({
  useAuth: jest.fn(() => ({
    userId: "user_admin",
    sessionClaims: { publicMetadata: { storeAdmin: true, storeId: "store-abc" } },
  })),
}));

// Set fetch mock at module level
(global as Record<string, unknown>).fetch = mockFetch;

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

import { AuditoriaCard } from "@/components/admin/AuditoriaCard";

describe("AuditoriaCard component", () => {
  // C-25
  it("C-25: renderiza spinner mientras carga", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    expect(screen.getByText("Cargando...")).toBeInTheDocument();
  });

  // C-26
  it("C-26: renderiza tabla con filas de datos", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockLogs, count: 2 }),
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText(/Pro Plan/)).toBeInTheDocument();
  });

  // C-27
  it("C-27: badge de action DELETE tiene color rojo", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [mockLogs[1]], count: 1 }),
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });
    const badges = screen.getAllByText("DELETE");
    const badge = badges.find((b) => b.tagName === "SPAN")!;
    expect(badge.className).toContain("bg-red-100");
  });

  // C-28
  it("C-28: badge de result success es verde", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [mockLogs[0]], count: 1 }),
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });
    const badges = screen.getAllByText("success");
    const badge = badges.find((b) => b.tagName === "SPAN")!;
    expect(badge.className).toContain("bg-green-100");
  });

  // C-29
  it("C-29: badge de result failure es rojo", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [mockLogs[1]], count: 1 }),
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });
    const badges = screen.getAllByText("failure");
    const badge = badges.find((b) => b.tagName === "SPAN")!;
    expect(badge.className).toContain("bg-red-100");
  });

  // C-30
  it("C-30: click en fila expande old_values/new_values", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockLogs, count: 2 }),
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });

    const rows = screen.getAllByRole("row");
    fireEvent.click(rows[1]);

    await waitFor(() => {
      expect(screen.getByText(/old_values/)).toBeInTheDocument();
      expect(screen.getByText(/new_values/)).toBeInTheDocument();
    });
  });

  // C-81: REGRESIÓN — el detalle de un failure no mostraba error_message (la
  // causa de una venta fallida quedaba guardada pero invisible).
  it("C-81: REGRESIÓN — detalle de auditoría con failure muestra error_message; un success no lo muestra", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockLogs, count: 2 }),
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getAllByRole("row")[2]); // log-2: failure
    await waitFor(() => expect(screen.getByText("Constraint violation")).toBeInTheDocument());
    expect(screen.getByText("error_message")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Cerrar"));
    fireEvent.click(screen.getAllByRole("row")[1]); // log-1: success, error_message null
    await waitFor(() => expect(screen.getByText(/new_values/)).toBeInTheDocument());
    expect(screen.queryByText("error_message")).not.toBeInTheDocument();
  });

  // C-31
  it("C-31: filtro de acción dispara nueva query", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockLogs, count: 2 }),
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [mockLogs[1]], count: 1 }),
    });

    const select = screen.getByDisplayValue("Todas las acciones");
    fireEvent.change(select, { target: { value: "DELETE" } });

    await waitFor(() => {
      const calls = mockFetch.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall).toContain("action=DELETE");
    });
  });

  // C-32
  it("C-32: botón Siguiente incrementa página", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockLogs, count: 100 }),
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], count: 100 }),
    });

    fireEvent.click(screen.getByText("Siguiente"));

    await waitFor(() => {
      const calls = mockFetch.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall).toContain("offset=50");
    });
  });

  // C-33
  it("C-33: botón Anterior está disabled en página 1", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockLogs, count: 2 }),
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });

    expect(screen.getByText("Anterior")).toBeDisabled();
  });

  // C-34
  it("C-34: exportar CSV dispara download", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockLogs, count: 2 }),
    });

    const mockClick = jest.fn();
    const origCreateElement = document.createElement.bind(document);
    const createElementSpy = jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") return { href: "", download: "", click: mockClick } as unknown as HTMLAnchorElement;
      return origCreateElement(tag);
    });
    const origCreateObjectURL = (global.URL as unknown as Record<string, unknown>).createObjectURL;
    (global.URL as unknown as Record<string, unknown>).createObjectURL = jest.fn(() => "blob:mock-url");
    const origRevokeObjectURL = (global.URL as unknown as Record<string, unknown>).revokeObjectURL;
    (global.URL as unknown as Record<string, unknown>).revokeObjectURL = jest.fn();

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByText("Exportar CSV"));

    await waitFor(() => expect(mockClick).toHaveBeenCalled(), { timeout: 5000 });

    createElementSpy.mockRestore();
    (global.URL as unknown as Record<string, unknown>).createObjectURL = origCreateObjectURL;
    (global.URL as unknown as Record<string, unknown>).revokeObjectURL = origRevokeObjectURL;
  });

  // C-82: REGRESIÓN — el export pedía limit=500 y la API (limit <= 100) respondía
  // 400 "Demasiado grande"; el error se perdía y no se descargaba nada.
  it("C-82: REGRESIÓN — exportar CSV pagina de a 100 (nunca limit > 100) y respeta los filtros", async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ ...mockLogs[0], id: `log-${n}-${i}` }));
    mockFetch.mockImplementation((url: string) => {
      const p = new URL(url, "http://localhost").searchParams;
      if (p.get("limit") === "50") return Promise.resolve({ ok: true, json: async () => ({ data: mockLogs, count: 2 }) });
      const offset = Number(p.get("offset"));
      return Promise.resolve({ ok: true, json: async () => ({ data: page(offset === 0 ? 100 : 30) }) });
    });
    const mockClick = jest.fn();
    const origCreateElement = document.createElement.bind(document);
    const createElementSpy = jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") return { href: "", download: "", click: mockClick } as unknown as HTMLAnchorElement;
      return origCreateElement(tag);
    });
    const urlStatics = global.URL as unknown as Record<string, unknown>;
    const origCreate = urlStatics.createObjectURL;
    const origRevoke = urlStatics.revokeObjectURL;
    urlStatics.createObjectURL = jest.fn(() => "blob:mock-url");
    urlStatics.revokeObjectURL = jest.fn();

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });
    mockFetch.mockClear();

    fireEvent.click(screen.getByText("Exportar CSV"));
    await waitFor(() => expect(mockClick).toHaveBeenCalled(), { timeout: 5000 });

    const exportCalls = mockFetch.mock.calls.map((c) => new URL(c[0] as string, "http://localhost"));
    expect(exportCalls.map((u) => u.pathname)).toEqual(["/api/audit-logs", "/api/audit-logs"]);
    expect(exportCalls.map((u) => u.searchParams.get("offset"))).toEqual(["0", "100"]);
    expect(exportCalls.every((u) => Number(u.searchParams.get("limit")) <= 100)).toBe(true);

    createElementSpy.mockRestore();
    urlStatics.createObjectURL = origCreate;
    urlStatics.revokeObjectURL = origRevoke;
  });

  it("C-83: si la API rechaza el export, el mensaje de error se muestra (no se silencia)", async () => {
    mockFetch.mockImplementation((url: string) => {
      const p = new URL(url, "http://localhost").searchParams;
      if (p.get("limit") === "50") return Promise.resolve({ ok: true, json: async () => ({ data: mockLogs, count: 2 }) });
      return Promise.resolve({ ok: false, json: async () => ({ error: "Demasiado grande" }) });
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByText("Exportar CSV"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo exportar: Demasiado grande");
  });
});

describe("AuditoriaCard — extended tabs", () => {
  // C-35
  it("C-35: tab 'Errores' renderiza tabla de errores", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockErrorLogs, count: 1 }),
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByText("Errores de sistema"));

    await waitFor(() => {
      expect(screen.getByText("Database timeout on insert")).toBeInTheDocument();
    });
    const badges = screen.getAllByText("ERROR");
    expect(badges.length).toBeGreaterThan(0);
  });

  // C-36
  it("C-36: tab 'Sesiones' renderiza tabla de sesiones", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve({ ok: true, json: async () => ({ data: mockLogs, count: 2 }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: mockSessions, count: 1 }) });
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByText("Sesiones de usuarios"));

    await waitFor(() => {
      expect(screen.getByText("session.created")).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  // C-43
  it("C-43: tab 'Sesiones' muestra IP y User-Agent cuando están presentes", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("user-sessions")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: mockSessions, count: 1 }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [], count: 0 }) });
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByText("Sesiones de usuarios"));

    await waitFor(() => {
      expect(screen.getByText(mockSessions[0].ip_address)).toBeInTheDocument();
    }, { timeout: 5000 });
    expect(screen.getByText(mockSessions[0].user_agent)).toBeInTheDocument();
  });

  // C-37
  it("C-37: cards de resumen muestran stats", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("audit-logs/summary")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            total_last_30_days: 150,
            by_action: [{ action: "CREATE", count: 80 }],
            by_user: [{ user_id: "user-1", count: 60 }],
            failures_last_7_days: 5,
            critical_errors_last_24h: 2,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: mockLogs, count: 2 }) });
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText(/Pro Plan/)).toBeInTheDocument();
  });

  // C-38
  it("C-38: botón 'Marcar resuelto' llama a PATCH", async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes("error-logs") && url.includes("resolve")) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      if (url.includes("error-logs")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: mockErrorLogs, count: 1 }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [], count: 0 }) });
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByText("Errores de sistema"));

    await waitFor(() => {
      expect(screen.getByText("Database timeout on insert")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Marcar resuelto"));

    await waitFor(() => {
      const calls = mockFetch.mock.calls;
      const resolveCall = calls.find((c: [string, RequestInit?]) => c[0]?.includes("resolve"));
      expect(resolveCall).toBeDefined();
      expect(resolveCall[1]?.method).toBe("PATCH");
    });
  });

  // C-55
  it("C-55: REGRESIÓN (ticket 6a76c9994e8b17f267f71641) — dropdown de eventos NO ofrece session.ended", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("user-sessions")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: mockSessions, count: 1 }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [], count: 0 }) });
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByText("Sesiones de usuarios"));

    await waitFor(() => {
      const options = screen
        .getAllByRole("option")
        .map((o) => (o as HTMLOptionElement).value);
      expect(options).toContain("session.created");
      expect(options).toContain("session.removed");
      expect(options).not.toContain("session.ended");
    });
  });

  // C-59
  it("C-59: tab 'Errores de sistema' con 0 registros muestra la grilla vacía 'Mostrando 1-0 de 0 registros' (síntoma del ticket 6a77eec7a32c85d594ee7a62)", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("error-logs")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [], count: 0 }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [], count: 0 }) });
    });

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByText("Errores de sistema"));

    await waitFor(() => {
      expect(screen.getByText("Mostrando 1-0 de 0 registros")).toBeInTheDocument();
    }, { timeout: 5000 });
    // La tabla de errores renderiza sus columnas aunque no haya filas: una
    // vez que el backend registra 500 reales (con withErrorLogging), estos
    // aparecen como filas en esta grilla.
    expect(screen.getByText("Severidad")).toBeInTheDocument();
    expect(screen.getByText("Endpoint")).toBeInTheDocument();
  });
});

// C-77 a C-80: filtros de cada pestaña llegan a la query, modal de detalle de
// error y errores de carga. Fetch enrutado por URL.
describe("AuditoriaCard — filtros, detalle de error y fallas de carga", () => {
  function rutear(fallaEn?: string) {
    mockFetch.mockImplementation(async (url: string) => {
      if (fallaEn && url.startsWith(fallaEn)) return { ok: false, json: async () => ({}) };
      if (url.startsWith("/api/error-logs")) return { ok: true, json: async () => ({ data: mockErrorLogs, count: 1 }) };
      if (url.startsWith("/api/user-sessions")) return { ok: true, json: async () => ({ data: mockSessions, count: 1 }) };
      return { ok: true, json: async () => ({ data: mockLogs, count: 120 }) };
    });
  }
  const ultimaUrl = (prefijo: string) =>
    String([...mockFetch.mock.calls].reverse().find(([u]) => String(u).startsWith(prefijo))![0]);

  // Cada filtro o cambio de página crea una query nueva y la tarjeta muestra
  // "Cargando..." (desmonta los controles): se espera a que vuelvan a estar.
  async function cambiarCombo(idx: number, value: string) {
    fireEvent.change((await screen.findAllByRole("combobox"))[idx], { target: { value } });
  }
  async function cambiarFecha(idx: number, value: string) {
    await screen.findAllByRole("combobox");
    fireEvent.change(document.querySelectorAll('input[type="date"]')[idx], { target: { value } });
  }
  async function cambiarTexto(placeholder: string, value: string) {
    const el = await screen.findByPlaceholderText(placeholder);
    fireEvent.change(el, { target: { value } });
    fireEvent.blur(await screen.findByPlaceholderText(placeholder));
  }

  it("C-77: cada filtro de Actividad entra en la query y vuelve a la página 1; systemAdmin ve Store ID", async () => {
    rutear();
    render(<AuditoriaCard role="systemAdmin" />, { wrapper: makeWrapper() });
    await screen.findByText(/Pro Plan/);
    expect(screen.getByText("Store ID")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(ultimaUrl("/api/audit-logs")).toContain("offset=50"));
    fireEvent.click(await screen.findByRole("button", { name: "Anterior" }));
    await waitFor(() => expect(ultimaUrl("/api/audit-logs")).toContain("offset=0"));

    await cambiarCombo(0, "UPDATE");
    await cambiarCombo(1, "venta");
    await cambiarCombo(2, "partial");
    await cambiarFecha(0, "2026-05-01");
    await cambiarFecha(1, "2026-05-31");
    await cambiarTexto("User ID", "user_x");

    await waitFor(() => {
      const url = ultimaUrl("/api/audit-logs");
      for (const p of ["action=UPDATE", "entity_type=venta", "result=partial", "desde=2026-05-01", "hasta=2026-05-31", "user_id=user_x"]) {
        expect(url).toContain(p);
      }
    });
  });

  it("C-78: filtros de Errores y de Sesiones entran en sus queries", async () => {
    rutear();
    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });
    await screen.findByText(/Pro Plan/);

    fireEvent.click(screen.getByRole("button", { name: "Errores de sistema" }));
    await screen.findByText("Database timeout on insert");
    await cambiarCombo(0, "CRITICAL");
    await cambiarCombo(1, "false");
    fireEvent.change(await screen.findByPlaceholderText("Endpoint"), { target: { value: "/api/ventas" } });
    await cambiarFecha(0, "2026-05-01");
    await cambiarFecha(1, "2026-05-02");
    await waitFor(() => {
      const url = ultimaUrl("/api/error-logs");
      for (const p of ["severity=CRITICAL", "resolved=false", "endpoint=%2Fapi%2Fventas", "desde=2026-05-01", "hasta=2026-05-02"]) expect(url).toContain(p);
    });

    fireEvent.click(await screen.findByRole("button", { name: "Sesiones de usuarios" }));
    await screen.findByText("session.created", { selector: "span" });
    await cambiarCombo(0, "session.removed");
    await cambiarTexto("User ID", "user_s");
    await cambiarFecha(0, "2026-04-01");
    await cambiarFecha(1, "2026-04-30");
    await waitFor(() => {
      const url = ultimaUrl("/api/user-sessions");
      for (const p of ["event_type=session.removed", "user_id=user_s", "desde=2026-04-01", "hasta=2026-04-30"]) expect(url).toContain(p);
    });
  });

  it("C-79: click en un error abre su detalle (mensaje, stack, context); Cerrar y Escape lo cierran", async () => {
    rutear();
    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });
    await screen.findByText(/Pro Plan/);
    fireEvent.click(screen.getByRole("button", { name: "Errores de sistema" }));
    fireEvent.click(await screen.findByText("Database timeout on insert"));

    expect(screen.getByText("Error — ERROR")).toBeInTheDocument();
    expect(screen.getByText("Error at /api/ventas:42")).toBeInTheDocument();
    expect(screen.getByText(/"endpoint": "\/api\/ventas"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByText("Error — ERROR")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Database timeout on insert"));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Error — ERROR")).not.toBeInTheDocument());
  });

  it("C-80: si la API de errores o de sesiones falla, la grilla queda vacía (sin romper la página)", async () => {
    rutear("/api/error-logs");
    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });
    await screen.findByText(/Pro Plan/);
    fireEvent.click(screen.getByRole("button", { name: "Errores de sistema" }));
    expect(await screen.findByText("Mostrando 1-0 de 0 registros")).toBeInTheDocument();

    rutear("/api/user-sessions");
    fireEvent.click(screen.getByRole("button", { name: "Sesiones de usuarios" }));
    expect(await screen.findByText("Mostrando 1-0 de 0 registros")).toBeInTheDocument();
  });
});
