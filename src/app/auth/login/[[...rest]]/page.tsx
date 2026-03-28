import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">PetShop POS</h1>
        <p className="text-sm text-gray-500 mt-1">Sistema de punto de venta</p>
      </div>
      <SignIn
        appearance={{
          elements: {
            rootBox: "w-full",
            card: "shadow-md border border-gray-100",
          },
        }}
      />
    </div>
  );
}
