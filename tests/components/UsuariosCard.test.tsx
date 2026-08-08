/**
 * Test C-41: UsuariosCard — CreateUserForm no debe exponer sus campos al
 * autocompletado de credenciales guardadas del navegador (otro contexto:
 * login del propio admin, u otro sitio).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UsuariosCard } from "@/components/admin/UsuariosCard";

const mockFetch = jest.fn();
global.fetch = mockFetch;

const DEFAULT_USERS = [
  {
    clerk_id: "user-1",
    email: "admin@test.com",
    nombre: "Admin",
    store_admin: true,
    store_worker: false,
    system_admin: true,
    updated_at: "2025-01-01T00:00:00Z",
  },
];

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function mockUsersResponse(users = DEFAULT_USERS) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/api/admin/users?storeId=")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(users) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  });
}

describe("UsuariosCard — autoComplete en formularios (C-41, C-44)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsersResponse();
  });

  // C-41 — REGRESIÓN: sin autoComplete, el navegador ofrecía autocompletar
  // email/contraseña del formulario "Crear usuario" con credenciales
  // guardadas del propio admin logueado (otro contexto), al crear la cuenta
  // de OTRA persona.
  it("C-41: REGRESIÓN — CreateUserForm: email tiene autoComplete=\"off\" y password tiene autoComplete=\"new-password\"", async () => {
    render(<UsuariosCard store={{ id: "store-1" }} role="storeAdmin" />, {
      wrapper: makeWrapper(),
    });

    fireEvent.click(screen.getByText("+ Crear usuario"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText("Email")).toHaveAttribute("autocomplete", "off");
    expect(screen.getByPlaceholderText("Contraseña")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByPlaceholderText("Nombre")).toHaveAttribute("autocomplete", "off");
    expect(screen.getByPlaceholderText("Apellido")).toHaveAttribute("autocomplete", "off");
  });

  // C-44 — REGRESIÓN: el inline edit (✏) para editar email/nombre de un
  // usuario existente también debe tener autoComplete="off" en sus inputs,
  // por el mismo motivo que C-41: los datos editados son de OTRA persona,
  // no del admin logueado.
  it("C-44: REGRESIÓN — inline edit: inputs email y nombre tienen autoComplete=\"off\"", async () => {
    render(<UsuariosCard store={{ id: "store-1" }} role="systemAdmin" />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText("admin@test.com")).toBeInTheDocument();
    });

    const editButton = screen.getByTitle("Editar rol");
    fireEvent.click(editButton);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    });

    const inlineEmail = screen.getByPlaceholderText("Email");
    expect(inlineEmail).toHaveAttribute("autocomplete", "off");

    const nombreInput = screen.getByPlaceholderText("Nombre completo");
    expect(nombreInput).toHaveAttribute("autocomplete", "off");
  });

  // C-54 — REGRESIÓN (ticket 6a76c861779de90209ed8ba3): el backend devolvía un
  // 409 con el mensaje técnico "El email ya existe en Clerk pero no se pudo
  // recuperar el usuario" y el formulario lo mostraba tal cual — exponiendo el
  // proveedor interno (Clerk) al usuario final. Ahora el backend responde con un
  // mensaje de negocio ("Ya existe un usuario con este email"); este test
  // verifica que ese mensaje del servidor llega a pantalla (la UI no lo silencia
  // ni lo transforma en un detalle técnico).
  it("C-54: REGRESIÓN — crear usuario con email duplicado muestra el mensaje claro del backend (no el técnico)", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/admin/users?storeId=")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(DEFAULT_USERS) });
      }
      if (url.includes("/api/admin/users/create")) {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ error: "Ya existe un usuario con este email" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    render(<UsuariosCard store={{ id: "store-1" }} role="storeAdmin" />, {
      wrapper: makeWrapper(),
    });

    fireEvent.click(screen.getByText("+ Crear usuario"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "admin@test.com" } });
    fireEvent.change(screen.getByPlaceholderText("Contraseña"), { target: { value: "ClaveSegura123!" } });
    fireEvent.change(screen.getByPlaceholderText("Nombre"), { target: { value: "Admin" } });
    fireEvent.change(screen.getByPlaceholderText("Apellido"), { target: { value: "Test" } });

    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));

    await waitFor(() => {
      expect(screen.getByText("Ya existe un usuario con este email")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Clerk/i)).not.toBeInTheDocument();
  });
});
