/**
 * Tests CC-09: Instagram editor page — autocomplete attributes
 *
 * CC-09: REGRESIÓN — datetime-local input para programar publicación tiene
 * autoComplete="off". Sin él, el navegador puede autocompletar el campo con
 * valores previos de otros formularios, o el gestor de contraseñas puede
 * interferir confundiendo el campo con uno de login.
 */
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";

const mockPush = jest.fn();
const mockSearchParamsGet = jest.fn(() => null);
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: (k: string) => mockSearchParamsGet(k) }),
}));

// Mock fetch: productos vacío, posts vacío
global.fetch = jest.fn().mockImplementation((url: string) => {
  if (url === "/api/productos") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  }
  if (url === "/api/canales/instagram/posts?status=draft") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
});

describe("InstagramEditor — autoComplete (CC-09)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("CC-09: REGRESIÓN — datetime-local input tiene autoComplete=\"off\"", async () => {
    const InstagramEditor = (await import("@/app/(app)/canales/instagram/posts/editor/page")).default;
    render(<InstagramEditor />);

    // Verificar que el datetime-local input tiene autoComplete="off"
    const datetimeInput = document.querySelector('input[type="datetime-local"]');
    expect(datetimeInput).not.toBeNull();
    expect(datetimeInput).toHaveAttribute("autocomplete", "off");
  });
});
