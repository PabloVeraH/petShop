/** @jest-environment jsdom */
/**
 * Tests UI-01 a UI-09: StoreLocationPicker component
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// Mock next/dynamic to avoid loading Leaflet in tests
jest.mock("next/dynamic", () =>
  (_loader: unknown) => {
    const MockMap = ({
      lat,
      lon,
      onPinMoved,
    }: {
      lat: number;
      lon: number;
      onPinMoved: (lat: number, lon: number) => void;
    }) => (
      <div data-testid="mock-map" data-lat={lat} data-lon={lon}>
        <button
          data-testid="simulate-pin-drag"
          type="button"
          onClick={() => onPinMoved(lat + 0.01, lon + 0.01)}
        >
          Simulate drag
        </button>
      </div>
    );
    MockMap.displayName = "MockMapWithPin";
    return MockMap;
  }
);

import StoreLocationPicker, {
  buildDisplayAddress,
  extractCity,
} from "@/components/StoreLocationPicker";

const defaultProps = {
  direccion: "",
  ciudad: "",
  lat: null,
  lon: null,
  onChange: jest.fn(),
};

const mockPhotonResponse = {
  features: [
    {
      geometry: { coordinates: [-73.051, -36.827] },
      properties: {
        street: "Pinares",
        housenumber: "579",
        district: "Chiguayante",
        city: "Concepción",
        country: "Chile",
      },
    },
    {
      geometry: { coordinates: [-70.67, -33.45] },
      properties: {
        street: "Avenida Providencia",
        housenumber: "1234",
        city: "Santiago",
        country: "Chile",
      },
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({
    json: jest.fn().mockResolvedValue(mockPhotonResponse),
  } as unknown as Response);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// UI-01
it("UI-01: renderiza el campo de dirección, ciudad, lat, lon y botón de geolocalización", () => {
  render(<StoreLocationPicker {...defaultProps} />);
  expect(screen.getByPlaceholderText("Ej: Pinares 579, Chiguayante")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Se completa al seleccionar dirección")).toBeInTheDocument();
  expect(screen.getByText("Latitud")).toBeInTheDocument();
  expect(screen.getByText("Longitud")).toBeInTheDocument();
  expect(screen.getByText("Usar mi ubicación actual")).toBeInTheDocument();
});

// UI-02
it("UI-02: muestra valores iniciales en los campos cuando se pasan props", () => {
  render(
    <StoreLocationPicker
      {...defaultProps}
      direccion="Pinares 579"
      ciudad="Concepción"
      lat={-36.827}
      lon={-73.051}
    />
  );
  expect(screen.getByDisplayValue("Pinares 579")).toBeInTheDocument();
  expect(screen.getByDisplayValue("Concepción")).toBeInTheDocument();
  expect(screen.getByDisplayValue("-36.827")).toBeInTheDocument();
  expect(screen.getByDisplayValue("-73.051")).toBeInTheDocument();
});

// UI-03
it("UI-03: muestra el mapa con las coordenadas correctas", () => {
  render(
    <StoreLocationPicker
      {...defaultProps}
      lat={-36.827}
      lon={-73.051}
    />
  );
  const map = screen.getByTestId("mock-map");
  expect(map).toHaveAttribute("data-lat", "-36.827");
  expect(map).toHaveAttribute("data-lon", "-73.051");
});

// UI-04
it("UI-04: llama a Photon API al escribir más de 2 caracteres (debounced)", async () => {
  jest.useFakeTimers();
  render(<StoreLocationPicker {...defaultProps} />);
  const input = screen.getByPlaceholderText("Ej: Pinares 579, Chiguayante");

  fireEvent.change(input, { target: { value: "Pin" } });
  expect(global.fetch).not.toHaveBeenCalled();

  act(() => jest.advanceTimersByTime(400));
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("photon.komoot.io")
    );
  });
  jest.useRealTimers();
});

// UI-05
it("UI-05: muestra sugerencias de Photon y al seleccionar llama onChange con datos correctos", async () => {
  jest.useFakeTimers();
  const onChange = jest.fn();
  render(<StoreLocationPicker {...defaultProps} onChange={onChange} />);
  const input = screen.getByPlaceholderText("Ej: Pinares 579, Chiguayante");

  fireEvent.change(input, { target: { value: "Pinares" } });
  act(() => jest.advanceTimersByTime(400));

  await waitFor(() =>
    expect(screen.getByText(/Pinares 579/)).toBeInTheDocument()
  );

  fireEvent.mouseDown(screen.getByText(/Pinares 579/));

  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      ciudad: "Concepción",
      lat: -36.827,
      lon: -73.051,
    })
  );
  jest.useRealTimers();
});

// UI-06
it("UI-06: mover el pin muestra el diálogo de confirmación", async () => {
  render(<StoreLocationPicker {...defaultProps} lat={-36.827} lon={-73.051} />);

  fireEvent.click(screen.getByTestId("simulate-pin-drag"));

  await waitFor(() =>
    expect(
      screen.getByText(/Ha movido el pin de la posición original/)
    ).toBeInTheDocument()
  );
  expect(screen.getByText("Sí, modificar dirección")).toBeInTheDocument();
  expect(screen.getByText("No, mantener dirección")).toBeInTheDocument();
});

// UI-07
it("UI-07: responder Sí al diálogo limpia el campo de dirección", async () => {
  render(
    <StoreLocationPicker
      {...defaultProps}
      direccion="Dirección original"
      lat={-36.827}
      lon={-73.051}
    />
  );

  fireEvent.click(screen.getByTestId("simulate-pin-drag"));
  await waitFor(() => screen.getByText("Sí, modificar dirección"));
  fireEvent.click(screen.getByText("Sí, modificar dirección"));

  expect(screen.queryByDisplayValue("Dirección original")).not.toBeInTheDocument();
  expect(screen.queryByText(/Ha movido el pin/)).not.toBeInTheDocument();
});

// UI-08
it("UI-08: responder No al diálogo cierra el diálogo y conserva la dirección", async () => {
  render(
    <StoreLocationPicker
      {...defaultProps}
      direccion="Dirección original"
      lat={-36.827}
      lon={-73.051}
    />
  );

  fireEvent.click(screen.getByTestId("simulate-pin-drag"));
  await waitFor(() => screen.getByText("No, mantener dirección"));
  fireEvent.click(screen.getByText("No, mantener dirección"));

  expect(screen.getByDisplayValue("Dirección original")).toBeInTheDocument();
  expect(screen.queryByText(/Ha movido el pin/)).not.toBeInTheDocument();
});

// UI-09
it("UI-09: mover el pin llama a onChange con las nuevas coordenadas", async () => {
  const onChange = jest.fn();
  render(
    <StoreLocationPicker
      {...defaultProps}
      onChange={onChange}
      lat={-36.827}
      lon={-73.051}
    />
  );

  fireEvent.click(screen.getByTestId("simulate-pin-drag"));

  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      lat: expect.closeTo(-36.817, 2),
      lon: expect.closeTo(-73.041, 2),
    })
  );
});

// Unit tests for utility functions

describe("buildDisplayAddress", () => {
  it("construye dirección con calle, número, distrito y ciudad", () => {
    const result = buildDisplayAddress({
      street: "Pinares",
      housenumber: "579",
      district: "Chiguayante",
      city: "Concepción",
      country: "Chile",
    });
    expect(result).toBe("Pinares 579, Chiguayante, Concepción, Chile");
  });

  it("usa name si no hay street", () => {
    const result = buildDisplayAddress({ name: "Plaza de Armas", city: "Santiago" });
    expect(result).toBe("Plaza de Armas, Santiago");
  });

  it("no repite ciudad si district === city", () => {
    const result = buildDisplayAddress({ street: "Av. Test", city: "Iquique", district: "Iquique" });
    expect(result).toBe("Av. Test, Iquique");
  });
});

describe("extractCity", () => {
  it("extrae city cuando está disponible", () => {
    expect(extractCity({ city: "Concepción", state: "Biobío" })).toBe("Concepción");
  });

  it("usa locality si no hay city", () => {
    expect(extractCity({ locality: "Chiguayante" })).toBe("Chiguayante");
  });

  it("usa state como fallback", () => {
    expect(extractCity({ state: "Antofagasta" })).toBe("Antofagasta");
  });

  it("retorna string vacío si no hay datos", () => {
    expect(extractCity({})).toBe("");
  });
});
