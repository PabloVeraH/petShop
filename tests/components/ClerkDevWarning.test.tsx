/**
 * Tests C-50 a C-52: ClerkDevWarning — detección de claves de desarrollo Clerk
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { ClerkDevWarning } from "@/components/admin/ClerkDevWarning";

// C-50
it("C-50: con clave pk_test_ muestra advertencia de modo desarrollo", () => {
  render(<ClerkDevWarning publishableKey="pk_test_d2VsY29tZS1mZWxpbmUtNDAuY2xlcmsuYWNjb3VudHMuZGV2JA" />);
  expect(screen.getByText("Clerk está en modo desarrollo")).toBeInTheDocument();
});

// C-51
it("C-51: con clave pk_live_ NO muestra advertencia", () => {
  render(<ClerkDevWarning publishableKey="pk_live_d2VsY29tZS1mZWxpbmUtNDAuY2xlcmsuYWNjb3VudHMuZGV2JA" />);
  expect(screen.queryByText("Clerk está en modo desarrollo")).not.toBeInTheDocument();
});

// C-52
it("C-52: con publishableKey vacío NO muestra advertencia", () => {
  render(<ClerkDevWarning publishableKey="" />);
  expect(screen.queryByText("Clerk está en modo desarrollo")).not.toBeInTheDocument();
});

// C-53: con clave test_ (legacy) muestra advertencia
it("C-53: con clave test_ (legacy) muestra advertencia de modo desarrollo", () => {
  render(<ClerkDevWarning publishableKey="test_d2VsY29tZS1mZWxpbmUtNDAuY2xlcmsuYWNjb3VudHMuZGV2JA" />);
  expect(screen.getByText("Clerk está en modo desarrollo")).toBeInTheDocument();
});
