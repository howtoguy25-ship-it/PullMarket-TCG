import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export function useUnreadNotifications(): number {
  const { user } = useAuth();
  const { data } = useQuery<{ count: number }>({ queryKey: ["/api/notifications/unread-count"], enabled: !!user, refetchInterval: 20_000 });
  return data?.count ?? 0;
}
