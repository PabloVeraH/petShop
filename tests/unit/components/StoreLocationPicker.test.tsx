/** @jest-environment jsdom */
/**
 * Tests UI-01 a UI-14: StoreLocationPicker component
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
      onMapClick,
    }: {
      lat: number;
      lon: number;
      flyTarget?: unknown;
      onPinMoved: (lat: number, lon: number) => void;
      onMapClick: (lat: number, lon: number) => void;
    }) => (
      <div data-testid="mock-map" data-lat={lat} data-lon={lon}>
        <button
          data-testid="simulate-pin-drag"
          type="button"
          onClick={() => onPinMoved(lat + 0.01, lon + 0.01)}
        >
          Simulate drag
        </button>
        <button
          data-testid="simulate-map-click"
          type="button"
          onClick={() => onMapClick(lat + 0.02, lon + 0.02)}
        >
          Simulate click
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
it("UI-06: mover el pin muestra el diálogo de confirmación como popup modal", async () => {
  render(<StoreLocationPicker {...defaultProps} lat={-36.827} lon={-73.051} />);

  // Dialog must not exist before pin is moved
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId("simulate-pin-drag"));

  await waitFor(() => {
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });
  expect(screen.getByText(/Ha movido el pin de la posición original/)).toBeInTheDocument();
  expect(screen.getByText("Sí, actualizar")).toBeInTheDocument();
  expect(screen.getByText("No, mantener")).toBeInTheDocument();
});

// UI-07
it("UI-07: responder Sí activa reverse geocoding y rellena la dirección con la nueva ubicación", async () => {
  render(
    <StoreLocationPicker
      {...defaultProps}
      direccion="Dirección original"
      lat={-36.827}
      lon={-73.051}
    />
  );

  fireEvent.click(screen.getByTestId("simulate-pin-drag"));
  await waitFor(() => screen.getByText("Sí, actualizar"));
  fireEvent.click(screen.getByText("Sí, actualizar"));

  // Dialog must close immediately
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  );

  // Must call reverse geocoding
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("photon.komoot.io/reverse")
    )
  );

  // Address must NOT be the original, and must NOT be empty
  const input = screen.getByPlaceholderText("Ej: Pinares 579, Chiguayante");
  await waitFor(() => {
    expect(input).not.toHaveValue("Dirección original");
    expect(input).not.toHaveValue("");
  });
});

// UI-08
it("UI-08: responder No cierra el diálogo, conserva la dirección y no llama reverse geocoding", async () => {
  render(
    <StoreLocationPicker
      {...defaultProps}
      direccion="Dirección original"
      lat={-36.827}
      lon={-73.051}
    />
  );

  fireEvent.click(screen.getByTestId("simulate-pin-drag"));
  await waitFor(() => screen.getByText("No, mantener"));
  fireEvent.click(screen.getByText("No, mantener"));

  expect(screen.getByDisplayValue("Dirección original")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalledWith(
    expect.stringContaining("photon.komoot.io/reverse")
  );
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

// UI-10: click en mapa con dirección vacía → reverse geocoding → rellena dirección
it("UI-10: click en mapa con dirección vacía hace reverse geocoding y rellena la dirección", async () => {
  const onChange = jest.fn();
  render(<StoreLocationPicker {...defaultProps} onChange={onChange} lat={-36.827} lon={-73.051} />);

  fireEvent.click(screen.getByTestId("simulate-map-click"));

  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("photon.komoot.io/reverse")
    )
  );
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledTimes(2)
  );
  // Second call should have the geocoded address
  const secondCall = onChange.mock.calls[1][0];
  expect(secondCall).toHaveProperty("direccion");
  expect(secondCall.direccion.length).toBeGreaterThan(0);
});

// UI-11: click en mapa con dirección ya cargada → muestra diálogo de confirmación
it("UI-11: click en mapa con dirección existente muestra el diálogo de confirmación", async () => {
  render(
    <StoreLocationPicker
      {...defaultProps}
      direccion="Dirección existente"
      lat={-36.827}
      lon={-73.051}
    />
  );

  fireEvent.click(screen.getByTestId("simulate-map-click"));

  await waitFor(() =>
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  );
  // Should NOT call reverse geocoding before confirmation
  expect(global.fetch).not.toHaveBeenCalledWith(
    expect.stringContaining("photon.komoot.io/reverse")
  );
});

// UI-12: click en mapa actualiza lat/lon vía onChange
it("UI-12: click en mapa llama a onChange con las nuevas coordenadas", async () => {
  const onChange = jest.fn();
  render(
    <StoreLocationPicker
      {...defaultProps}
      onChange={onChange}
      lat={-36.827}
      lon={-73.051}
    />
  );

  fireEvent.click(screen.getByTestId("simulate-map-click"));

  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      lat: expect.closeTo(-36.807, 2),
      lon: expect.closeTo(-73.031, 2),
    })
  );
});

// UI-13: el popup tiene atributos de accesibilidad correctos
it("UI-13: el popup de confirmación tiene role=dialog y aria-modal=true", async () => {
  render(<StoreLocationPicker {...defaultProps} lat={-36.827} lon={-73.051} />);

  fireEvent.click(screen.getByTestId("simulate-pin-drag"));

  await waitFor(() => {
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "pin-moved-title");
  });
  expect(screen.getByText("Posición modificada")).toBeInTheDocument();
});

// UI-14: confirmar tras click en mapa también activa reverse geocoding
it("UI-14: confirmar diálogo tras click en mapa activa reverse geocoding y rellena la dirección", async () => {
  render(
    <StoreLocationPicker
      {...defaultProps}
      direccion="Dirección existente"
      lat={-36.827}
      lon={-73.051}
    />
  );

  fireEvent.click(screen.getByTestId("simulate-map-click"));
  await waitFor(() => screen.getByText("Sí, actualizar"));
  fireEvent.click(screen.getByText("Sí, actualizar"));

  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("photon.komoot.io/reverse")
    )
  );

  const input = screen.getByPlaceholderText("Ej: Pinares 579, Chiguayante");
  await waitFor(() => {
    expect(input).not.toHaveValue("Dirección existente");
    expect(input).not.toHaveValue("");
  });
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
