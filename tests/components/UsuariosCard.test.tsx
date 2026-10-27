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

  // C-68 — REGRESIÓN: la query no revisaba res.ok; una respuesta de error
  // ({ error }) llegaba al render como "lista" y rompía la página con
  // "(users ?? []).map is not a function".
  it.each([
    [403, { error: "Forbidden" }, "Forbidden"],
    [500, { error: "Error interno del servidor" }, "Error interno del servidor"],
  ])("C-68: REGRESIÓN — respuesta %i de /api/admin/users muestra el error sin romper", async (status, body, mensaje) => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) })
    );
    render(<UsuariosCard store={{ id: "store-1" }} role="systemAdmin" />, { wrapper: makeWrapper() });

    expect(await screen.findByRole("alert")).toHaveTextContent(mensaje);
    expect(screen.queryByText("Sin usuarios")).not.toBeInTheDocument();
  });

  it("C-68: REGRESIÓN — respuesta 200 que no es una lista se trata como error", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ foo: 1 }) })
    );
    render(<UsuariosCard store={{ id: "store-1" }} role="systemAdmin" />, { wrapper: makeWrapper() });

    expect(await screen.findByRole("alert")).toHaveTextContent("Error al cargar usuarios (200)");
  });
});

// C-92: botón "ojo" para ver/ocultar la contraseña al crear un usuario.
describe("UsuariosCard — ver/ocultar contraseña al crear (C-92)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/admin/users?storeId=")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(DEFAULT_USERS) });
      }
      if (url.includes("/api/admin/users/create")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
  });

  it("C-92: el ojo alterna la contraseña entre oculta y visible, con su texto accesible", async () => {
    render(<UsuariosCard store={{ id: "store-1" }} role="storeAdmin" />, { wrapper: makeWrapper() });
    fireEvent.click(screen.getByText("+ Crear usuario"));

    const password = await screen.findByPlaceholderText("Contraseña");
    fireEvent.change(password, { target: { value: "ClaveSegura123!" } });
    expect(password).toHaveAttribute("type", "password");

    const mostrar = screen.getByRole("button", { name: "Mostrar contraseña" });
    expect(mostrar).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(mostrar);

    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("ClaveSegura123!");
    const ocultar = screen.getByRole("button", { name: "Ocultar contraseña" });
    expect(ocultar).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(ocultar);
    expect(password).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Mostrar contraseña" })).toBeInTheDocument();
    // autoComplete se mantiene con la contraseña visible u oculta (C-41).
    expect(password).toHaveAttribute("autocomplete", "new-password");
  });

  it("C-92: apretar el ojo no envía el formulario; con la contraseña visible se crea el usuario con ella", async () => {
    render(<UsuariosCard store={{ id: "store-1" }} role="storeAdmin" />, { wrapper: makeWrapper() });
    fireEvent.click(screen.getByText("+ Crear usuario"));

    fireEvent.change(await screen.findByPlaceholderText("Email"), { target: { value: "nuevo@test.com" } });
    fireEvent.change(screen.getByPlaceholderText("Contraseña"), { target: { value: "ClaveSegura123!" } });
    fireEvent.change(screen.getByPlaceholderText("Nombre"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByPlaceholderText("Apellido"), { target: { value: "Pérez" } });

    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    const creates = () => mockFetch.mock.calls.filter(([u]) => String(u).includes("/api/admin/users/create"));
    expect(creates()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(JSON.parse(creates()[0][1].body)).toMatchObject({ email: "nuevo@test.com", password: "ClaveSegura123!" });

    // Tras crear, el formulario se limpia y la contraseña vuelve a quedar oculta.
    await screen.findByText("Usuario creado correctamente");
    expect(screen.getByPlaceholderText("Contraseña")).toHaveAttribute("type", "password");
  });
});

// C-93: cambiar la contraseña de un usuario — solo lo ve el systemAdmin. Es
// conveniencia de UX: el control real es el 403 de
// POST /api/admin/users/[id]/password (I-769, I-770).
describe("UsuariosCard — cambiar contraseña (C-93)", () => {
  function montar(respuesta: { ok: boolean; status: number; body: object }) {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/admin/users?storeId=")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(DEFAULT_USERS) });
      }
      if (url.includes("/password")) {
        return Promise.resolve({ ok: respuesta.ok, status: respuesta.status, json: () => Promise.resolve(respuesta.body) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
  }
  beforeEach(() => jest.clearAllMocks());

  it.each(["storeAdmin", "storeWorker"] as const)("C-93: %s no ve el botón de cambiar contraseña", async (rol) => {
    montar({ ok: true, status: 200, body: { ok: true } });
    render(<UsuariosCard store={{ id: "store-1" }} role={rol} />, { wrapper: makeWrapper() });
    await screen.findByText("admin@test.com");
    expect(screen.queryByRole("button", { name: /Cambiar contraseña/ })).not.toBeInTheDocument();
  });

  it("C-93: systemAdmin cambia la contraseña: POST a /api/admin/users/{id}/password con la nueva, y aviso de éxito", async () => {
    montar({ ok: true, status: 200, body: { ok: true } });
    render(<UsuariosCard store={{ id: "store-1" }} role="systemAdmin" />, { wrapper: makeWrapper() });

    fireEvent.click(await screen.findByRole("button", { name: "Cambiar contraseña de admin@test.com" }));
    const campo = screen.getByPlaceholderText("Nueva contraseña");
    expect(campo).toHaveAttribute("type", "password");
    fireEvent.change(campo, { target: { value: "NuevaClave2026!" } });
    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(campo).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Contraseña cambiada");
    const llamada = mockFetch.mock.calls.find(([u]) => String(u).includes("/password"));
    expect(llamada[0]).toBe("/api/admin/users/user-1/password");
    expect(llamada[1].method).toBe("POST");
    expect(JSON.parse(llamada[1].body)).toEqual({ password: "NuevaClave2026!" });
    // El campo se limpia y vuelve a quedar oculto.
    expect(screen.getByPlaceholderText("Nueva contraseña")).toHaveValue("");
    expect(screen.getByPlaceholderText("Nueva contraseña")).toHaveAttribute("type", "password");
  });

  it("C-93: el rechazo del servidor (contraseña filtrada) se muestra en pantalla", async () => {
    montar({ ok: false, status: 422, body: { error: "Password has been found in an online data breach." } });
    render(<UsuariosCard store={{ id: "store-1" }} role="systemAdmin" />, { wrapper: makeWrapper() });

    fireEvent.click(await screen.findByRole("button", { name: "Cambiar contraseña de admin@test.com" }));
    fireEvent.change(screen.getByPlaceholderText("Nueva contraseña"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Password has been found in an online data breach.");
  });

  it("C-93: Cerrar oculta el formulario sin llamar a la API", async () => {
    montar({ ok: true, status: 200, body: { ok: true } });
    render(<UsuariosCard store={{ id: "store-1" }} role="systemAdmin" />, { wrapper: makeWrapper() });

    fireEvent.click(await screen.findByRole("button", { name: "Cambiar contraseña de admin@test.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(screen.queryByPlaceholderText("Nueva contraseña")).not.toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes("/password"))).toBe(false);
  });
});
