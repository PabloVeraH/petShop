/**
 * Test C-41: UsuariosCard — CreateUserForm no debe exponer sus campos al
 * autocompletado de credenciales guardadas del navegador (otro contexto:
 * login del propio admin, u otro sitio).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UsuariosCard } from "@/components/admin/UsuariosCard";

global.fetch = jest.fn().mockImplementation(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
);

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("UsuariosCard — CreateUserForm autoComplete (C-41)", () => {
  beforeEach(() => jest.clearAllMocks());

  // C-41 — REGRESIÓN: sin autoComplete, el navegador ofrecía autocompletar
  // email/contraseña del formulario "Crear usuario" con credenciales
  // guardadas del propio admin logueado (otro contexto), al crear la cuenta
  // de OTRA persona.
  it("C-41: REGRESIÓN — email tiene autoComplete=\"off\" y password tiene autoComplete=\"new-password\"", async () => {
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
});
