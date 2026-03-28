import { redirect } from "next/navigation";

// Root redirects to login; middleware handles role-based redirects after auth
export default function Home() {
  redirect("/auth/login");
}
