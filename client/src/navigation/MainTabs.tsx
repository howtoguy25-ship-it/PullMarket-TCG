import React from "react";
import { Keyboard, Platform, View, StyleSheet } from "react-native";
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

// Each tab gets its own brand-palette accent instead of one flat color for
// all seven — matching the colored-barrier language used throughout Boost,
// Profile, Search, Favorites and Chat, so the tab bar reads as the same
// design system rather than a plain gray/red default.
const TAB_COLORS: Record<keyof MainTabsParamList, string> = {
  Home: Colors.primary,
  Search: Colors.pokemon,
  Sell: Colors.goldDark,
  Prices: Colors.success,
  Messages: Colors.secondary,
  Favorites: Colors.gold,
  Profile: "#7C3AED",
};

function TabIcon({ name, color, focused }: { name: keyof typeof Feather.glyphMap; color: string; focused: boolean }) {
  return (
    <View style={[tabIconStyles.wrap, focused && { backgroundColor: color + "1F" }]}>
      <Feather name={name} size={19} color={color} />
    </View>
  );
}

const tabIconStyles = StyleSheet.create({
  wrap: { width: 34, height: 22, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});

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
        screenOptions={({ route }) => {
          const color = TAB_COLORS[route.name as keyof MainTabsParamList];
          return {
            headerShown: false,
            tabBarActiveTintColor: color,
            tabBarInactiveTintColor: Colors.textMuted,
            tabBarIcon: ({ color: c, focused }) => <TabIcon name={ICONS[route.name as keyof MainTabsParamList]} color={c} focused={focused} />,
            // lineHeight is set explicitly (not left to "normal") so the
            // label's box is sized from a known value instead of whatever
            // the browser's font metrics happen to produce — on web that
            // ambiguity was exactly what let the label get squeezed into a
            // few-pixel-tall clipped box once the icon above it claimed most
            // of the available row height (see tabBarStyle comment below).
            tabBarLabelStyle: { fontFamily: Fonts.bodySemiBold, fontSize: 11, lineHeight: 13 },
            tabBarItemStyle: { paddingTop: 4, paddingBottom: 2 },
            // A hardcoded height wasn't reliably getting the home-indicator
            // safe-area inset added on top of it on real iOS devices — labels
            // ended up sliced off at the very bottom of the screen. Computing
            // the height and padding from the actual inset explicitly removes
            // any doubt about what the library does by default.
            //
            // Web has no safe-area inset to lean on (insets.bottom is always
            // 0). A first attempt just bumped tabBarStyle.height, but most of
            // that extra height went to its own paddingTop/paddingBottom —
            // the icon+label row itself barely grew, so the label was still
            // squeezed to a few-pixel clipped sliver. This version keeps the
            // bar's own padding modest and puts the real slack into the row,
            // giving icon (22px) + label comfortable room inside it.
            tabBarStyle:
              Platform.OS === "web"
                ? { borderTopColor: Colors.gold, borderTopWidth: 2, height: 80, paddingBottom: 14, paddingTop: 6 }
                : { borderTopColor: Colors.gold, borderTopWidth: 2, height: 56 + insets.bottom, paddingBottom: insets.bottom },
            tabBarBadge: route.name === "Messages" && unreadMessages > 0 ? (unreadMessages > 9 ? "9+" : unreadMessages) : undefined,
            tabBarBadgeStyle: { backgroundColor: Colors.primary, fontSize: 10, fontFamily: Fonts.bodyBold },
          };
        }}
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
