import React from "react";
import { Keyboard } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Colors, Fonts } from "@/constants/theme";
import { MainTabsParamList } from "./types";

import HomeScreen from "@/screens/HomeScreen";
import SearchScreen from "@/screens/SearchScreen";
import SellScreen from "@/screens/SellScreen";
import ChatListScreen from "@/screens/ChatListScreen";
import FavoritesScreen from "@/screens/FavoritesScreen";
import ProfileScreen from "@/screens/ProfileScreen";

const Tab = createBottomTabNavigator<MainTabsParamList>();

const ICONS: Record<keyof MainTabsParamList, keyof typeof Feather.glyphMap> = {
  Home: "home",
  Search: "search",
  Sell: "camera",
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

  return (
    <Tab.Navigator
      screenListeners={{
        tabPress: () => Keyboard.dismiss(),
      }}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarIcon: ({ color, size, focused }) => (
          <Feather name={ICONS[route.name as keyof MainTabsParamList]} size={focused ? size + 1 : size} color={color} />
        ),
        tabBarLabelStyle: { fontFamily: Fonts.bodySemiBold, fontSize: 11 },
        tabBarStyle: { borderTopColor: Colors.gold, borderTopWidth: 2 },
        tabBarBadge: route.name === "Messages" && unreadMessages > 0 ? (unreadMessages > 9 ? "9+" : unreadMessages) : undefined,
        tabBarBadgeStyle: { backgroundColor: Colors.primary, fontSize: 10, fontFamily: Fonts.bodyBold },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Sell" component={SellScreen} />
      <Tab.Screen name="Messages" component={ChatListScreen} />
      <Tab.Screen name="Favorites" component={FavoritesScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
