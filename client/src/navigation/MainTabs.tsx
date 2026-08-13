import React from "react";
import { Keyboard, View } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Colors, Fonts } from "@/constants/theme";
import { BannerAdBar } from "@/components/BannerAdBar";
import { MainTabsParamList } from "./types";

import HomeScreen from "@/screens/HomeScreen";
import SearchScreen from "@/screens/SearchScreen";
import SellScreen from "@/screens/SellScreen";
import PricesScreen from "@/screens/PricesScreen";
import ChatListScreen from "@/screens/ChatListScreen";
import FavoritesScreen from "@/screens/FavoritesScreen";
import ProfileScreen from "@/screens/ProfileScreen";

const Tab = createBottomTabNavigator<MainTabsParamList>();

const ICONS: Record<keyof MainTabsParamList, keyof typeof Feather.glyphMap> = {
  Home: "home",
  Search: "search",
  Sell: "camera",
  Prices: "trending-up",
  Messages: "message-circle",
  Favorites: "star",
  Profile: "user",
};

function useUnreadMessageCount() {
  const { data } = useQuery<{ count: number }>({ queryKey: ["/api/chat/unread-count"], refetchInterval: 10000, meta: { silent401: true } });
  return data?.count ?? 0;
}

export function MainTabs() {
  const unreadMessages = useUnreadMessageCount();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1 }}>
      {/* Sits above the tab navigator (which includes both screen content
         and the tab bar) so it never overlays anything — see BannerAdBar,
         which renders nothing at all unless a real ad is eligible today. */}
      <BannerAdBar />
      <Tab.Navigator
        screenListeners={{
          tabPress: () => Keyboard.dismiss(),
        }}
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.textMuted,
          tabBarIcon: ({ color, size }) => <Feather name={ICONS[route.name as keyof MainTabsParamList]} size={size} color={color} />,
          tabBarLabelStyle: { fontFamily: Fonts.bodySemiBold, fontSize: 11, marginTop: 2 },
          tabBarItemStyle: { paddingTop: 4, paddingBottom: 2 },
          // A hardcoded height wasn't reliably getting the home-indicator
          // safe-area inset added on top of it on real iOS devices — labels
          // ended up sliced off at the very bottom of the screen. Computing
          // the height and padding from the actual inset explicitly removes
          // any doubt about what the library does by default.
          tabBarStyle: { borderTopColor: Colors.gold, borderTopWidth: 2, height: 56 + insets.bottom, paddingBottom: insets.bottom },
          tabBarBadge: route.name === "Messages" && unreadMessages > 0 ? (unreadMessages > 9 ? "9+" : unreadMessages) : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.primary, fontSize: 10, fontFamily: Fonts.bodyBold },
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Search" component={SearchScreen} />
        <Tab.Screen name="Sell" component={SellScreen} />
        <Tab.Screen name="Prices" component={PricesScreen} />
        {/* Label shortened to "Chat" — "Messages" was the one label long
           enough to get ellipsized/crowded in a 7-tab bar on web; the route
           name (used for navigation, badges, deep links) is unchanged. */}
        <Tab.Screen name="Messages" component={ChatListScreen} options={{ tabBarLabel: "Chat" }} />
        <Tab.Screen name="Favorites" component={FavoritesScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </View>
  );
}
