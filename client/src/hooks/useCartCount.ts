import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

interface CartResponse {
  items: { quantity: number }[];
}

export function useCartCount(): number {
  const { user } = useAuth();
  const { data } = useQuery<CartResponse>({ queryKey: ["/api/cart"], enabled: !!user, refetchInterval: 15_000 });
  return (data?.items ?? []).reduce((sum, i) => sum + i.quantity, 0);
}
