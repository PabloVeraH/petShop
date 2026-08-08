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
    const origCreateObjectURL = (global.URL as Record<string, unknown>).createObjectURL;
    (global.URL as Record<string, unknown>).createObjectURL = jest.fn(() => "blob:mock-url");
    const origRevokeObjectURL = (global.URL as Record<string, unknown>).revokeObjectURL;
    (global.URL as Record<string, unknown>).revokeObjectURL = jest.fn();

    render(<AuditoriaCard role="storeAdmin" />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.queryByText("Cargando...")).not.toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByText("Exportar CSV"));

    await waitFor(() => expect(mockClick).toHaveBeenCalled(), { timeout: 5000 });

    createElementSpy.mockRestore();
    (global.URL as Record<string, unknown>).createObjectURL = origCreateObjectURL;
    (global.URL as Record<string, unknown>).revokeObjectURL = origRevokeObjectURL;
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
});
