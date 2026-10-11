/**
 * C-74: OnboardingPage — la tienda se crea con nombre, RUT y dirección.
 * Los `required` y la validación de RUT en el cliente son UX; el control real
 * está en POST /api/onboarding/complete (I-737).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import OnboardingPage from "@/app/auth/onboarding/page";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (global as Record<string, unknown>).fetch = fetchMock;
});

function llenar(datos: { nombre?: string; rut?: string; direccion?: string }) {
  if (datos.nombre !== undefined) fireEvent.change(screen.getByLabelText("Nombre de la tienda"), { target: { value: datos.nombre } });
  if (datos.rut !== undefined) fireEvent.change(screen.getByLabelText("RUT de la tienda"), { target: { value: datos.rut } });
  if (datos.direccion !== undefined) fireEvent.change(screen.getByLabelText("Dirección"), { target: { value: datos.direccion } });
}

describe("OnboardingPage (C-74)", () => {
  it("C-74: nombre, RUT y dirección son requeridos; sin ellos el botón está deshabilitado", () => {
    render(<OnboardingPage />);
    expect(screen.getByLabelText("Nombre de la tienda")).toBeRequired();
    expect(screen.getByLabelText("RUT de la tienda")).toBeRequired();
    expect(screen.getByLabelText("Dirección")).toBeRequired();
    llenar({ nombre: "Mi Tienda", rut: "76.123.456-0" });
    expect(screen.getByRole("button", { name: "Crear tienda" })).toBeDisabled();
  });

  it("C-74: RUT inválido muestra error y no llama a la API", () => {
    render(<OnboardingPage />);
    llenar({ nombre: "Mi Tienda", rut: "76.123.456-7", direccion: "Av. Ossa 123" });
    fireEvent.click(screen.getByRole("button", { name: "Crear tienda" }));
    expect(screen.getByText("RUT de la tienda inválido")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("C-74: datos válidos → POST /api/onboarding/complete con nombre, RUT y dirección y redirige", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ storeId: "s1" }) });
    render(<OnboardingPage />);
    llenar({ nombre: " Mi Tienda ", rut: " 76.123.456-0 ", direccion: " Av. Ossa 123 " });
    fireEvent.click(screen.getByRole("button", { name: "Crear tienda" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"));
    expect(fetchMock).toHaveBeenCalledWith("/api/onboarding/complete", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      storeName: "Mi Tienda", rut: "76.123.456-0", address: "Av. Ossa 123",
    });
  });

  it("C-74: error de la API se muestra en pantalla y no redirige", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "La dirección de la tienda es obligatoria" }) });
    render(<OnboardingPage />);
    llenar({ nombre: "Mi Tienda", rut: "76.123.456-0", direccion: "Av. Ossa 123" });
    fireEvent.click(screen.getByRole("button", { name: "Crear tienda" }));
    expect(await screen.findByText("La dirección de la tienda es obligatoria")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
